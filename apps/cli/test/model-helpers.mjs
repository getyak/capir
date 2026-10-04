import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
export const binary = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
export async function fixture(t) {
  const root = await mkdtemp(join(process.env.CAPIR_MODEL_TEST_ROOT || tmpdir(), 'capir-model-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, env: { ...process.env, CAPIR_CONFIG_DIR: root } };
}
export function cli(args, env, input = '') {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [binary, ...args], { env, stdio: ['pipe','pipe','pipe'] });
    let stdout = '', stderr = '';
    child.stdout.setEncoding('utf8').on('data', x => { stdout += x; });
    child.stderr.setEncoding('utf8').on('data', x => { stderr += x; });
    child.once('error', reject);
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('CLI exceeded test deadline')); }, 45000);
    child.once('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, stdout, stderr }); });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}
import { createServer } from 'node:http';
export async function provider(t, handle) {
  const requests=[];
  const server=createServer(async(req,res)=>{
    let raw='';for await(const chunk of req)raw+=chunk;
    const body=raw?JSON.parse(raw):null;requests.push({path:req.url,headers:req.headers,body});
    try{await handle(req,res,body);}catch{res.destroy();}
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  t.after(()=>{server.closeAllConnections();return new Promise(r=>server.close(r));});
  return {url:`http://127.0.0.1:${server.address().port}/prefix/v1`,requests};
}
export async function setup(t, handle, protocol='openai-compatible', options=[]) {
  const f=await fixture(t);const p=await provider(t,handle);
  const result=await cli(['models','add','work','--provider',protocol,'--base-url',p.url,'--model','fixture','--api-key-env','CAPIR_SYNTHETIC_KEY','--default',...options],f.env);
  if(result.code!==0)throw new Error('Fixture model profile could not be configured');
  return {...f,...p,env:{...f.env,CAPIR_SYNTHETIC_KEY:'synthetic-only-secret-12345'}};
}
export function openai(text='你好🙂',reason='stop',stream=false) {
  if(!stream)return JSON.stringify({choices:[{index:0,message:{role:'assistant',content:text},finish_reason:reason}],usage:{prompt_tokens:0,completion_tokens:2,total_tokens:2}});
  return `data: ${JSON.stringify({choices:[{index:0,delta:{content:text},finish_reason:null}]})}\n\ndata: ${JSON.stringify({choices:[{index:0,delta:{},finish_reason:reason}],usage:{prompt_tokens:0,completion_tokens:2,total_tokens:2}})}\n\ndata: [DONE]\n\n`;
}
export function anthropic(text='你好🙂',reason='end_turn',stream=false) {
  if(!stream)return JSON.stringify({type:'message',role:'assistant',content:[{type:'text',text}],stop_reason:reason,usage:{input_tokens:0,output_tokens:2}});
  return `event: message_start\ndata: ${JSON.stringify({type:'message_start',message:{usage:{input_tokens:0,output_tokens:0}}})}\n\nevent: content_block_start\ndata: ${JSON.stringify({type:'content_block_start',index:0,content_block:{type:'text',text:''}})}\n\nevent: content_block_delta\ndata: ${JSON.stringify({type:'content_block_delta',index:0,delta:{type:'text_delta',text}})}\n\nevent: message_delta\ndata: ${JSON.stringify({type:'message_delta',delta:{stop_reason:reason},usage:{output_tokens:2}})}\n\nevent: message_stop\ndata: {"type":"message_stop"}\n\n`;
}
