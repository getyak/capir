import {readPrimaryBackendSessionClaims} from '@/lib/server/backendAuth';
import {AUTH_HEADERS, capirAuthRequest, openCapirForm, validateConsentParams} from '@/lib/server/capir-auth';
import type {CapirAuthAuthorizeRequest, CapirAuthAuthorizeResponse} from '@talent-signal/contracts';
export const runtime='nodejs';
export async function POST(request:Request) {
  try {
    const claims=await readPrimaryBackendSessionClaims(); if (!claims) throw new Error('Login required');
    const form=await request.formData();
    const consent=openCapirForm<CapirAuthAuthorizeRequest>(request,claims,String(form.get('sealed')??''));
    validateConsentParams(consent as unknown as Record<string,string>,consent.scopes);
    const callback=new URL(consent.redirect_uri);callback.searchParams.set('state',consent.state);
    if (form.get('decision')==='deny') callback.searchParams.set('error','access_denied');
    else if (form.get('decision')==='approve') {
      const result=await capirAuthRequest<CapirAuthAuthorizeResponse>('authorize',claims,consent);
      if (result.redirect_uri!==consent.redirect_uri || result.state!==consent.state || !/^[A-Za-z0-9_-]{43}$/.test(result.code)) throw new Error('Invalid response');
      callback.searchParams.set('code',result.code);
    } else throw new Error('Decision required');
    return Response.json({location:callback.toString()},{headers:AUTH_HEADERS});
  } catch {return new Response('授权未完成。请回到终端重新登录。',{status:403,headers:AUTH_HEADERS});}
}
