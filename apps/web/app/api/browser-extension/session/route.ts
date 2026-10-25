import { NextResponse } from "next/server";
import { TalentSignalClient } from "@talent-signal/contracts";
import { backendAuthBaseUrl } from "@/lib/server/backendAuth";
import { browserClaims, browserSessionVersion } from "@/lib/server/browser-capture";
import { isBackendSessionExpiredError } from "@/lib/backend-session";
export const dynamic="force-dynamic";
export async function GET(){
  try{
    const claims=await browserClaims();
    if(!claims)return NextResponse.json({status:"not_ready",code:"session_stale"},{status:401});
    await new TalentSignalClient(backendAuthBaseUrl(),claims.backendAccessToken).currentSession();
    return NextResponse.json({status:"ready",contact_agent:true,workspace_label:claims.backendAccountName,session_version:browserSessionVersion(claims)},{headers:{"cache-control":"no-store"}});
  }catch(error){
    if(isBackendSessionExpiredError(error))return NextResponse.json({status:"not_ready",code:"session_stale"},{status:401});
    return NextResponse.json({status:"not_ready",code:"backend_unavailable"},{status:503});
  }
}
