import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cli, setup, fixture, openai, anthropic, binary } from './model-helpers.mjs';
const respond=(res,text,sse=false)=>{res.writeHead(200,{'content-type':sse?'text/event-stream':'application/json'});res.end(text);};
for(const protocol of ['openai-compatible','anthropic']) for(const stream of [true,false]) {
  test(`${protocol} ${stream?'stream':'buffered'} emits exact Unicode and real nullable usage`,async t=>{
    const build=protocol==='anthropic'?anthropic:openai;
    const f=await setup(t,async(req,res,body)=>{
      const data=Buffer.from('\ufeff'+build('你好🙂',protocol==='anthropic'?'end_turn':'stop',body.stream));
      res.writeHead(200,{'content-type':body.stream?'text/event-stream':'application/json'});
      if(body.stream)for(let i=0;i<data.length;i++)res.write(data.subarray(i,i+1));else res.write(data.subarray(3));res.end();
    },protocol);
    const r=await cli(['ask','Explain','--system','brief',...(stream?[]:['--no-stream']),'--json'],f.env,'context');
    assert.equal(r.code,0);assert.equal(r.stderr,'');const doc=JSON.parse(r.stdout);
    assert.equal(doc.response.text,'你好🙂');assert.equal(doc.response.complete,true);assert.equal(doc.usage.input_tokens,0);assert.equal(doc.usage.output_tokens,2);assert.equal(doc.usage.total_tokens,protocol==='anthropic'?null:2);
    assert.equal(f.requests.length,1);assert.equal(f.requests[0].path,protocol==='anthropic'?'/prefix/v1/messages':'/prefix/v1/chat/completions');
    assert.equal(f.requests[0].body.messages.at(-1).content,'context\n\nExplain');
    if(protocol==='anthropic'){assert.equal(f.requests[0].body.system,'brief');assert.equal(f.requests[0].headers['anthropic-version'],'2023-06-01');}
    else {assert.equal(f.requests[0].body.max_completion_tokens,1024);assert.equal(f.requests[0].body.stream_options,undefined);}
  });
}
test('plain shorthand and pipes use the selected model without JSON wrapping',async t=>{
  const f=await setup(t,(_,res,b)=>respond(res,openai('answer','stop',b.stream),b.stream));
  for(const [args,input] of [[['请解释'],''],[[],'pipe'],[['--profile','work'],'pipe'],[['ask','--','--literal'],'']]) {
    const r=await cli(args,f.env,input);assert.equal(r.code,0);assert.equal(r.stdout,'answer\n');
  }
  for(const args of [['asq'],['ask','x','--open','web'],['ask','x','--timeout','1','--timeout','2'],['ask','x','--json','--human']])assert.equal((await cli(args,f.env)).code,2);
  assert.equal(f.requests.length,4);
});
test('exact credential and terminal controls are scrubbed across chunks without corrupting generated identifiers',async t=>{
  const identifier='z'.repeat(70);
  const f=await setup(t,(_,res)=>{res.writeHead(200,{'content-type':'text/event-stream'});
    for(const text of ['prefix synthetic-only-','\u001b[31msecret-12345','\u001b[0m '+identifier])res.write(`data: ${JSON.stringify({choices:[{index:0,delta:{content:text},finish_reason:null}]})}\r\n\r\n`);
    res.end('data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\r\n\r\ndata: [DONE]\r\n\r\n');
  });
  for(const flags of [[],['--json']]){const r=await cli(['ask','x',...flags],f.env);assert.equal(r.code,0);assert.equal(r.stdout.includes(f.env.CAPIR_SYNTHETIC_KEY),false);assert.equal(r.stdout.includes(identifier),true);assert.equal(r.stdout.includes('\u001b'),false);assert.equal(r.stdout.includes('[REDACTED]'),true);}
});
test('terminal reasons never promote truncation, refusal or tools into success',async t=>{
  const f=await setup(t,(_,res,b)=>respond(res,openai('partial',b.messages.at(-1).content,b.stream),b.stream));
  for(const [reason,code]of [['length',5],['content_filter',1],['tool_calls',3],['mystery',3]]) {
    const r=await cli(['ask',reason,'--json'],f.env);assert.equal(r.code,code);assert.equal(JSON.parse(r.stdout).response.complete,false);
  }
});
test('malformed and unfinished streaming responses fail with sanitized partial JSON',async t=>{
  const f=await setup(t,(_,res,b)=>{
    const which=b.messages.at(-1).content;res.writeHead(200,{'content-type':'text/event-stream'});
    if(which==='missing')res.end(openai('partial','stop',true).replace('data: [DONE]\n\n',''));
    else if(which==='pending')res.end('data: {"choices":[{"index":0,"delta":{"content":"not-dispatched"},"finish_reason":"stop"}]}');
    else if(which==='utf8')res.end(Buffer.from([0xff]));
    else if(which==='huge')res.end('data: '+'x'.repeat(256*1024+1)+'\n\n');
    else res.end('data: {broken}\n\n');
  });
  for(const which of ['missing','pending','utf8','huge','json']){const r=await cli(['ask',which,'--json'],f.env);assert.equal(r.code,3);const doc=JSON.parse(r.stdout);assert.equal(doc.response.complete,false);if(which==='pending')assert.equal(doc.response.text,'');}
});
test('HTTP failures, redirects and a hung body are bounded and never retried',async t=>{
  const f=await setup(t,(_,res,b)=>{const which=b.messages.at(-1).content;if(which==='hang'){res.writeHead(200,{'content-type':'text/event-stream'});res.flushHeaders();return;}res.writeHead(Number(which),{location:'http://127.0.0.1:1/steal'});res.end('synthetic-only-secret-12345');});
  for(const [status,code]of [['401',4],['403',4],['429',5],['500',3],['302',3],['hang',3]]){const r=await cli(['ask',status,'--timeout','1','--json'],f.env);assert.equal(r.code,code);assert.equal(r.stdout.includes(f.env.CAPIR_SYNTHETIC_KEY),false);}
  assert.equal(f.requests.length,6);
});
test('missing keys, empty input and oversized stdin do not dispatch',async t=>{
  const f=await setup(t,(_,res,b)=>respond(res,openai('ok','stop',b.stream),b.stream));
  assert.equal((await cli(['ask','x'],{...f.env,CAPIR_SYNTHETIC_KEY:''})).code,4);
  assert.equal((await cli(['ask'],f.env)).code,2);
  assert.equal((await cli(['ask','x'],f.env,'字'.repeat(45000))).code,2);
  assert.equal((await cli(['ask','x'],f.env,Buffer.from([0xff]))).code,2);
  assert.equal(f.requests.length,0);
});
test('remote discovery reports only the first bounded page and no paid generation',async t=>{
  const f=await setup(t,(req,res)=>respond(res,JSON.stringify({data:[{id:'one',display_name:'One'}],has_more:true,last_id:'cursor'})),'anthropic');
  const r=await cli(['models','list','--remote'],f.env);assert.equal(r.code,0);const doc=JSON.parse(r.stdout);assert.equal(doc.has_more,true);assert.equal(doc.cursor,'cursor');assert.equal(doc.models[0].id,'one');assert.equal(f.requests[0].path,'/prefix/v1/models');assert.equal(f.requests[0].body,null);
});
test('SIGINT cancels hung generation and closes the process with 130',{timeout:15000},async t=>{
  let started;const ready=new Promise(r=>started=r);
  const f=await setup(t,(_,res)=>{res.writeHead(200,{'content-type':'text/event-stream'});res.flushHeaders();started();});
  const child=spawn(process.execPath,[binary,'ask','x','--json'],{env:f.env,stdio:['pipe','pipe','pipe']});t.after(()=>child.kill());child.stdin.end();let out='';child.stdout.on('data',x=>out+=x);child.stderr.resume();await ready;const closed=new Promise(r=>child.once('close',r));child.kill('SIGINT');assert.equal(await closed,130);assert.equal(JSON.parse(out).response.complete,false);
});
test('explicit gateway options are honored once without inference or paid probing',async t=>{
  const f=await setup(t,(_,res,b)=>respond(res,openai('ok','stop',b.stream),b.stream),'openai-compatible',['--token-limit-field','max_tokens','--system-role','developer','--stream-usage']);
  const r=await cli(['ask','x','--system','brief','--model','override','--max-tokens','17'],f.env);assert.equal(r.code,0);
  const body=f.requests[0].body;assert.equal(body.model,'override');assert.equal(body.max_tokens,17);assert.equal(body.max_completion_tokens,undefined);assert.equal(body.messages[0].role,'developer');assert.deepEqual(body.stream_options,{include_usage:true});assert.equal(body.tools,undefined);assert.equal(body.temperature,undefined);
});
test('CR-only multiline SSE, usage-only records and missing usage remain honest',async t=>{
  const f=await setup(t,(_,res,b)=>{
    const text=b.messages.at(-1).content;
    if(text==='none'){respond(res,JSON.stringify({choices:[{index:0,message:{content:' '},finish_reason:'stop'}]}));return;}
    res.writeHead(200,{'content-type':'text/event-stream'});
    res.end(': comment\r\rdata: {"choices":[\rdata: {"index":0,"delta":{"content":"ok"},"finish_reason":null}]}\r\rdata: {"choices":[],"usage":{"prompt_tokens":0,"completion_tokens":0,"total_tokens":0}}\r\rdata: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\r\rdata: [DONE]\r\r');
  });
  const r=await cli(['ask','cr','--json'],f.env);assert.equal(r.code,0);assert.equal(JSON.parse(r.stdout).response.text,'ok');assert.deepEqual(JSON.parse(r.stdout).usage,{input_tokens:0,output_tokens:0,total_tokens:0});
  const n=await cli(['ask','none','--no-stream','--json'],f.env);assert.equal(n.code,0);assert.deepEqual(JSON.parse(n.stdout).usage,{input_tokens:null,output_tokens:null,total_tokens:null});
});
test('Anthropic in-band errors, tool blocks and missing message_stop are incomplete',async t=>{
  const f=await setup(t,(_,res,b)=>{
    const which=b.messages.at(-1).content;let data=anthropic('partial','end_turn',true);
    if(which==='missing')data=data.replace('event: message_stop\ndata: {"type":"message_stop"}\n\n','');
    if(which==='error')data='event: error\ndata: {"type":"error","error":{"message":"synthetic-only-secret-12345"}}\n\n';
    if(which==='tools')data=data.replace('"type":"text","text":""','"type":"tool_use","name":"shell"');
    respond(res,data,true);
  },'anthropic');
  for(const which of ['missing','error','tools']){const r=await cli(['ask',which,'--json'],f.env);assert.equal(r.code,3);assert.equal(JSON.parse(r.stdout).response.complete,false);assert.equal(r.stdout.includes(f.env.CAPIR_SYNTHETIC_KEY),false);}
});
test('oversized response text stops generation and labels the partial result',async t=>{
  const f=await setup(t,(_,res)=>{
    res.writeHead(200,{'content-type':'text/event-stream'});
    for(let i=0;i<34;i++)res.write(`data: ${JSON.stringify({choices:[{index:0,delta:{content:'x'.repeat(65536)},finish_reason:null}]})}\n\n`);
    res.end('data: [DONE]\n\n');
  });
  const r=await cli(['ask','x','--json'],f.env);assert.equal(r.code,5);const doc=JSON.parse(r.stdout);assert.equal(doc.response.complete,false);assert.equal(Buffer.byteLength(doc.response.text),2*1024*1024);
});
test('deadline covers hanging stdin and headers without unbounded processes',async t=>{
  const f=await setup(t,()=>{});
  assert.equal((await cli(['ask','headers','--timeout','1','--json'],f.env)).code,3);
  const child=spawn(process.execPath,[binary,'ask','x','--timeout','1','--json'],{env:f.env,stdio:['pipe','pipe','pipe']});t.after(()=>child.kill());let out='';child.stdout.on('data',x=>out+=x);child.stderr.resume();
  const code=await new Promise(r=>child.once('close',r));assert.equal(code,3);assert.equal(JSON.parse(out).error.code,'CAPIR_MODEL_TIMEOUT');assert.equal(f.requests.length,1);
});
test('closed stdout aborts the owned stream with exit zero and no stack trace',async t=>{
  let disconnected;const gone=new Promise(r=>disconnected=r);
  const f=await setup(t,(_,res)=>{res.writeHead(200,{'content-type':'text/event-stream'});const timer=setInterval(()=>res.write(`data: ${JSON.stringify({choices:[{index:0,delta:{content:'x'.repeat(4096)},finish_reason:null}]})}\n\n`),10);res.once('close',()=>{clearInterval(timer);disconnected();});});
  const child=spawn(process.execPath,[binary,'ask','x'],{env:f.env,stdio:['pipe','pipe','pipe']});t.after(()=>child.kill());child.stdin.end();let err='';child.stderr.on('data',x=>err+=x);child.stdout.once('data',()=>child.stdout.destroy());
  assert.equal(await new Promise(r=>child.once('close',r)),0);await gone;assert.equal(err,'');
});
test('stream sanitizer never writes a lone Unicode surrogate at its secret lookbehind boundary',async t=>{
  const text='🙂'+'a'.repeat('synthetic-only-secret-12345'.length-2);
  const f=await setup(t,(_,res)=>{res.writeHead(200,{'content-type':'text/event-stream'});res.write(`data: ${JSON.stringify({choices:[{index:0,delta:{content:text},finish_reason:null}]})}\n\n`);setTimeout(()=>res.end('data: {"choices":[{"index":0,"delta":{"content":"end"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'),20);});
  const r=await cli(['ask','x'],f.env);assert.equal(r.code,0);assert.equal(r.stdout,text+'end\n');
});
test('request deadline also terminates a child blocked on stdout backpressure', {timeout:15000}, async t=>{
  let started;const ready=new Promise(r=>started=r);
  const f=await setup(t,(_,res)=>{started();res.writeHead(200,{'content-type':'text/event-stream'});for(let i=0;i<20;i++)res.write(`data: ${JSON.stringify({choices:[{index:0,delta:{content:'x'.repeat(65536)},finish_reason:null}]})}\n\n`);res.end('data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');});
  const child=spawn(process.execPath,[binary,'ask','x','--timeout','1'],{env:f.env,stdio:['pipe','pipe','pipe']});t.after(()=>{child.kill('SIGKILL');child.stdout.destroy();});child.stdin.end();child.stderr.resume();
  const finished=new Promise(r=>child.once('exit',r));await ready;
  const code=await Promise.race([finished,new Promise(r=>setTimeout(()=>r('hung'),4000))]);assert.equal(code,3);
});
test('ask response limit also bounds expansion introduced by exact-key redaction',async t=>{
  const f=await setup(t,(_,res)=>{res.writeHead(200,{'content-type':'text/event-stream'});for(let i=0;i<5;i++)res.write(`data: ${JSON.stringify({choices:[{index:0,delta:{content:'x'.repeat(65536)},finish_reason:null}]})}\n\n`);res.end('data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');});
  const r=await cli(['ask','q','--json'],{...f.env,CAPIR_SYNTHETIC_KEY:'x'});assert.equal(r.code,5);assert.equal(JSON.parse(r.stdout).response.complete,false);assert.ok(Buffer.byteLength(JSON.parse(r.stdout).response.text)<=2*1024*1024);
});
test('unknown SSE metadata is harmless but recognized Anthropic event types must match',async t=>{
  const o=await setup(t,(_,res)=>respond(res,'event: ping\ndata: alive\n\n'+openai('ok','stop',true),true));
  assert.equal((await cli(['ask','q','--json'],o.env)).code,0);
  const a=await setup(t,(_,res)=>respond(res,anthropic('ok','end_turn',true).replace('data: {"type":"message_stop"}','data: {"type":"ping"}'),true),'anthropic');
  assert.equal((await cli(['ask','q','--json'],a.env)).code,3);
});
for(const [name,control] of [['ESC charset designation','\u001b(B'],['C1 OSC string','\u009dtitle\u009c']])test(`renderer strips ${name} before cross-chunk exact-key redaction`,async t=>{
  const f=await setup(t,(_,res)=>{res.writeHead(200,{'content-type':'text/event-stream'});for(const content of ['synthetic-only-',control+'secret-12345',' end'])res.write(`data: ${JSON.stringify({choices:[{index:0,delta:{content},finish_reason:null}]})}\n\n`);res.end('data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');});
  const r=await cli(['ask','q'],f.env);assert.equal(r.code,0);assert.equal(r.stdout,'[REDACTED] end\n');
});
test('leading model flags preserve reserved commands and human pipe mode without typo-paid requests',async t=>{
  const f=await setup(t,(_,res,b)=>{respond(res,openai('ok','stop',b.stream),b.stream);});
  for(const [args,input]of [[['--human'],'pipe'],[['--profile','work','ask','question'],''],[['--human','请解释'],'']]){const r=await cli(args,f.env,input);assert.equal(r.code,0);assert.equal(r.stdout,'ok\n');}
  for(const args of [['--profile','work','auth','status'],['--profile','work','asq'],['--human','auth','status','--open','ios']])assert.equal((await cli(args,f.env)).code,2);
  assert.equal(f.requests.length,3);
});
test('invalid ask JSON flags still return one failed ask envelope before I/O',async t=>{
  const f=await setup(t,(_,res,b)=>respond(res,openai('ok','stop',b.stream),b.stream));
  const r=await cli(['ask','question','--json','--open','web'],f.env);assert.equal(r.code,2);const doc=JSON.parse(r.stdout);assert.equal(doc.command,'ask');assert.equal(doc.response.complete,false);assert.equal(doc.response.text,'');assert.equal(f.requests.length,0);
});
for(const protocol of ['openai-compatible','anthropic'])test(`${protocol} conflicting terminal records cannot promote a truncated response`,async t=>{
  const f=await setup(t,(_,res)=>{
    const body=protocol==='anthropic'?anthropic('partial','max_tokens',true).replace('event: message_stop', 'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}\n\nevent: message_stop'):openai('partial','length',true).replace('data: [DONE]', 'data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]');
    respond(res,body,true);
  },protocol);
  const r=await cli(['ask','q','--json'],f.env);assert.equal(r.code,3);assert.equal(JSON.parse(r.stdout).response.complete,false);assert.equal(JSON.parse(r.stdout).ok,false);
});
test('failed JSON output keeps the request deadline while stdout is blocked', {timeout:15000}, async t=>{
  let started;const ready=new Promise(r=>started=r);
  const f=await setup(t,(_,res)=>{started();res.writeHead(200,{'content-type':'text/event-stream'});for(let i=0;i<20;i++)res.write(`data: ${JSON.stringify({choices:[{index:0,delta:{content:'x'.repeat(65536)},finish_reason:null}]})}\n\n`);res.end('data: {"choices":[{"index":0,"delta":{},"finish_reason":"length"}]}\n\ndata: [DONE]\n\n');});
  const child=spawn(process.execPath,[binary,'ask','q','--json','--timeout','1'],{env:f.env,stdio:['pipe','pipe','pipe']});t.after(()=>{child.kill('SIGKILL');child.stdout.destroy();});child.stdin.end();child.stderr.resume();const done=new Promise(r=>child.once('exit',r));await ready;assert.equal(await Promise.race([done,new Promise(r=>setTimeout(()=>r('hung'),4000))]),3);
});
test('failed ask JSON and offline profile output tolerate a preclosed stdout without stacks',async t=>{
  const f=await fixture(t);
  for(const args of [['ask','q','--json'],['models','list'],['doctor']]) {
    const child=spawn(process.execPath,[binary,...args],{env:f.env,stdio:['pipe','pipe','pipe']});t.after(()=>child.kill());child.stdout.destroy();child.stdin.end();let err='';child.stderr.on('data',x=>err+=x);assert.equal(await new Promise(r=>child.once('close',r)),0);assert.equal(err,'');
  }
});
