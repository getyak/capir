import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { binary, setup, cli, openai } from './model-helpers.mjs';
function pty(env,actions,args=[]) {
  return new Promise((resolve,reject)=>{
    const child=spawn('python3',[fileURLToPath(new URL('./model-pty.py',import.meta.url))],{env,stdio:['pipe','pipe','pipe']});let out='',err='';child.stdout.on('data',x=>out+=x);child.stderr.on('data',x=>err+=x);child.once('error',reject);child.once('close',code=>{if(code!==0)reject(new Error(err));else resolve(JSON.parse(out));});child.stdin.end(JSON.stringify({node:process.execPath,binary,actions,args}));
  });
}
test('chat rejects pipes and inappropriate flags before model dispatch',async t=>{
  const f=await setup(t,(_,res)=>res.end());
  for(const args of [['chat'],['chat','--json'],['chat','--stdin']])assert.equal((await cli(args,f.env,'hello')).code,2);
  assert.equal(f.requests.length,0);
});
test('PTY chat serializes pasted turns, keeps successful history and resets explicitly',async t=>{
  let inFlight=0,maximum=0;
  const f=await setup(t,async(_,res,b)=>{inFlight++;maximum=Math.max(maximum,inFlight);await new Promise(r=>setTimeout(r,80));res.writeHead(200,{'content-type':'text/event-stream'});res.end(openai(`answer-${b.messages.at(-1).content}`,'stop',true));inFlight--;});
  const r=await pty(f.env,[{wait:'capir> '},{write:'first\nsecond\n/model\n/help\n/reset\nthird\n/exit\n'}]);
  assert.equal(r.code,0);assert.match(r.stdout,/answer-first/);assert.match(r.stdout,/answer-second/);assert.match(r.stdout,/answer-third/);assert.equal(r.stdout.includes('capir>'),false);assert.equal(maximum,1);
  assert.deepEqual(f.requests.map(x=>x.body.messages.map(m=>m.content)),[['first'],['first','answer-first','second'],['third']]);assert.match(r.stderr,/work/);
});
test('failed PTY turns do not contaminate history and ordinary failures recover',async t=>{
  const f=await setup(t,(_,res,b)=>{res.writeHead(200,{'content-type':'text/event-stream'});res.end(openai(b.messages.at(-1).content==='bad'?'partial':'good',b.messages.at(-1).content==='bad'?'length':'stop',true));});
  const r=await pty(f.env,[{wait:'capir> '},{write:'bad\nok\n/exit\n'}]);assert.equal(r.code,0);assert.match(r.stderr,/CAPIR_MODEL_TOKEN_LIMIT/);assert.deepEqual(f.requests[1].body.messages,[{role:'user',content:'ok'}]);
});
test('PTY EOF closes cleanly and SIGINT cancels generation',async t=>{
  const f=await setup(t,(_,res)=>{res.writeHead(200,{'content-type':'text/event-stream'});res.write('data: {"choices":[{"index":0,"delta":{"content":"started........................................................"},"finish_reason":null}]}\n\n');});
  const eof=await pty(f.env,[{wait:'capir> '},{write:'\u0004'}]);assert.equal(eof.code,0);
  const interrupt=await pty(f.env,[{wait:'capir> '},{write:'hello\n'},{wait:'started'},{write:'\u0003'}]);assert.equal(interrupt.code,130);
});
test('PTY authentication denial exits four rather than repeatedly offering an unusable turn',async t=>{
  const f=await setup(t,(_,res)=>{res.writeHead(401);res.end('no');});
  const r=await pty(f.env,[{wait:'capir> '},{write:'hello\n'}]);assert.equal(r.code,4);assert.equal(f.requests.length,1);
});
test('PTY pasted input arriving during generation remains queued and ordered',async t=>{
  let active=0,maximum=0;
  const f=await setup(t,async(_,res,b)=>{active++;maximum=Math.max(maximum,active);res.writeHead(200,{'content-type':'text/event-stream'});res.write(`data: ${JSON.stringify({choices:[{index:0,delta:{content:'stream-started........................................'},finish_reason:null}]})}\n\n`);await new Promise(r=>setTimeout(r,200));res.end('data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');active--;});
  const r=await pty(f.env,[{wait:'capir> '},{write:'first\n'},{wait:'stream-started'},{write:'second\n/exit\n'}]);assert.equal(r.code,0);assert.equal(maximum,1);assert.equal(f.requests.length,2);assert.deepEqual(f.requests[1].body.messages.map(x=>x.role),['user','assistant','user']);assert.equal(f.requests[1].body.messages.at(-1).content,'second');
});
test('PTY pending-line budget rejects excess paste before an unbounded queue forms',async t=>{
  const f=await setup(t,(_,res,b)=>{res.writeHead(200,{'content-type':'text/event-stream'});res.end(openai('ok','stop',true));});
  const r=await pty(f.env,[{wait:'capir> '},{write:'x\n'.repeat(66)}]);assert.equal(r.code,2);assert.match(r.stderr,/CAPIR_MODEL_INPUT_LIMIT/);
});
test('PTY context budget counts sanitized response expansion and preserves prior history on overflow',async t=>{
  const f=await setup(t,(_,res,b)=>{res.writeHead(200,{'content-type':'text/event-stream'});res.end(openai(b.messages.at(-1).content==='explode'?'x'.repeat(50000):'fine','stop',true));});
  const r=await pty({...f.env,CAPIR_SYNTHETIC_KEY:'x'},[{wait:'capir> '},{write:'explode\nok\n/exit\n'}]);assert.equal(r.code,0);assert.match(r.stderr,/CAPIR_MODEL_RESPONSE_LIMIT/);assert.deepEqual(f.requests[1].body.messages,[{role:'user',content:'ok'}]);
});
