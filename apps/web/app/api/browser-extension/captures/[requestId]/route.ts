import { NextResponse } from "next/server";
import { browserBackend, browserClaims, browserReceipt } from "@/lib/server/browser-capture";
export const dynamic="force-dynamic";
export async function GET(_request:Request,context:{params:Promise<{requestId:string}>}){
  let claims:Awaited<ReturnType<typeof browserClaims>>;
  try{claims=await browserClaims();}
  catch{return NextResponse.json({code:"backend_unavailable"},{status:503});}
  if(!claims)return NextResponse.json({code:"session_stale"},{status:401});
  const {requestId}=await context.params;
  if(!/^[a-zA-Z0-9-]{8,80}$/.test(requestId))return NextResponse.json({code:"receipt_not_found"},{status:404});
  try{const response=await browserBackend(claims,`browser-captures/${requestId}`);const body=await response.json();
    if(!response.ok)return NextResponse.json(body,{status:response.status});
    const receipt=browserReceipt(body);return NextResponse.json(receipt,{status:receipt.status==="deleted"?410:200,headers:{"cache-control":"no-store"}});
  }catch{return NextResponse.json({code:"receipt_unknown"},{status:503});}
}
