import { describe, expect, it, vi } from 'vitest';
import { performMcpHandshake } from './mcpClient.js';
import type { McpExchangeInput } from './mcpHttp.js';

const target={address:'93.184.216.34',family:4,origin:'https://synthetic.example.test',trustedLocal:false,url:new URL('https://synthetic.example.test/mcp')};
async function discover(list: unknown, envelope?: (value: Record<string,unknown>)=>unknown, bearerSecret?: string){
 return performMcpHandshake({target,...(bearerSecret ? {bearerSecret} : {}),exchange:async(input:McpExchangeInput)=>{
  const request=JSON.parse(input.body!);
  const value={jsonrpc:'2.0',id:request.id,result:request.method==='initialize'?{protocolVersion:'2025-11-25',capabilities:{tools:{}},serverInfo:{name:'synthetic',version:'1'}}:list};
  return {body:request.method==='notifications/initialized'?'':JSON.stringify(envelope?envelope(value):value),contentType:'application/json',headers:{},status:request.method==='notifications/initialized'?202:200};
 }});
}

describe('untrusted discovery boundary',()=>{
 it('redacts full credentials before truncating remote descriptions',async()=>{
  const secret='synthetic-credential-keep-private';
  const result=await discover({tools:[{name:'lookup',description:'x'.repeat(1990)+secret}]},undefined,secret);
  expect(result.tools[0]?.description).not.toContain('synthetic');
 });
 it('enforces one deadline across handshake legs',async()=>{
  const clock=vi.spyOn(Date,'now'); let now=0; clock.mockImplementation(()=>now);
  const budgets:number[]=[];
  try {
   const result=await performMcpHandshake({target,timeoutMs:100,exchange:async(input)=>{
    budgets.push(input.timeoutMs ?? 0); now+=60;
    const req=JSON.parse(input.body!);
    return {status:200,headers:{},contentType:'application/json',body:JSON.stringify({jsonrpc:'2.0',id:req.id,result:{protocolVersion:'2025-11-25'}})};
   }});
   expect(budgets).toEqual([100,40]); expect(result.errorCode).toBe('MCP_TIMEOUT');
  } finally { clock.mockRestore(); }
 });
 it('does not verify a response without the matching JSON-RPC envelope',async()=>{
  for(const mutate of [(v:Record<string,unknown>)=>({...v,id:undefined}),(v:Record<string,unknown>)=>({...v,jsonrpc:'1.0'}),(v:Record<string,unknown>)=>({...v,id:String(v.id)})]){
   expect((await discover({tools:[]},mutate)).status).toBe('failed');
  }
 });
 it('does not verify a missing tool-list payload',async()=>{
  expect((await discover({})).status).toBe('failed');
 });
 it('does not report a truncated paginated directory as verified',async()=>{
  expect((await discover({tools:[],nextCursor:'more'})).status).toBe('failed');
 });
 it.each([42, {}, null])('does not treat an invalid continuation cursor as complete: %j',async nextCursor=>{
  expect((await discover({tools:[],nextCursor}))).toMatchObject({status:'failed',errorCode:'MCP_RESPONSE_INVALID'});
 });
 it('bounds multilingual discovery before database persistence',async()=>{
  const result=await discover({tools:Array.from({length:100},(_,i)=>({name:`tool_${i}`,description:'汉'.repeat(2000)}))});
  expect(result.status).toBe('failed');
  expect(result.errorCode).toBe('MCP_RESPONSE_TOO_LARGE');
 });
 it('normalizes text that PostgreSQL cannot represent and redacts echoed credentials',async()=>{
  const result=await discover({tools:[{name:'lookup',description:'hello\u0000\ud800 synthetic-credential'},{name:'synthetic-credential',description:'echo'}]},undefined,'synthetic-credential');
  expect(result.status).toBe('verified');
  expect(JSON.stringify(result.tools)).not.toContain('synthetic-credential');
  expect(result.tools[0]?.description).not.toContain('\u0000');
  expect(result.tools[0]?.description).not.toContain('\ud800');
 });
});
