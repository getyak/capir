import { NextResponse } from "next/server";
import { isAllowedMutationOrigin } from "@/lib/request-origin";
import { browserBackend, browserCaptureInput, browserClaims, browserReceipt } from "@/lib/server/browser-capture";
export const dynamic="force-dynamic";
export async function POST(request:Request){
  if(!isAllowedMutationOrigin(request.headers,true))return NextResponse.json({message:"请求来源不受支持。"},{status:403});
  let claims:Awaited<ReturnType<typeof browserClaims>>;
  try{claims=await browserClaims();}
  catch{return NextResponse.json({code:"backend_unavailable"},{status:503});}
  if(!claims)return NextResponse.json({code:"session_stale"},{status:401});
  let input:unknown;
  try{
    const reader=request.body?.getReader();const chunks:Uint8Array[]=[];let size=0;
    if(reader)while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>14_000_000){await reader.cancel();return NextResponse.json({message:"截取内容过大，请裁剪后重试。"},{status:413});}chunks.push(part.value);}
    // Origin has already been checked against Host. Next's internal request URL
    // can use localhost behind a proxy even when the browser uses another host.
    input=browserCaptureInput(JSON.parse(Buffer.concat(chunks).toString("utf8")),request.headers,claims,new URL(request.headers.get("origin")!).origin);
  }catch{return NextResponse.json({message:"提交内容、保留方式或会话已变化，请重新检查来源并连接。"},{status:422});}
  try{
    const result=await browserBackend(claims,"tasks",input);const body=await result.json();
    if(!result.ok)return NextResponse.json(body,{status:result.status});
    return NextResponse.json(browserReceipt(body),{status:202,headers:{"cache-control":"no-store"}});
  }catch{return NextResponse.json({code:"receipt_unknown",message:"尚未确认收到，请核对本次采集回执后重试。"},{status:503});}
}
