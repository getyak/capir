import {readPrimaryBackendSessionClaims} from '@/lib/server/backendAuth';
import {AUTH_HEADERS,capirAuthRequest,openCapirForm} from '@/lib/server/capir-auth';
export async function POST(request:Request) {
 try {const claims=await readPrimaryBackendSessionClaims();if(!claims)throw new Error('Login required');
 const form=await request.formData(); const value=openCapirForm<{grant_id:string}>(request,claims,String(form.get('sealed')??''));
 await capirAuthRequest('grants/revoke',claims,{schema_version:'capir-auth.v2',grant_id:value.grant_id});
 return Response.json({location:'/workspace/settings/cli'},{headers:AUTH_HEADERS});
 } catch {return new Response('撤销未完成，请重试。',{status:403,headers:AUTH_HEADERS});}
}
