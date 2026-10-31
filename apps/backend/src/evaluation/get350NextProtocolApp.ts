/** Test-only temporary Next project. Never creates a production app route. */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AccountSettings, CredentialChangeAttempt } from "@talent-signal/contracts";

export type ProtocolClaims = {
  backendSessionId:string; backendAccessToken:string; backendAccountId:string; backendAccountName:string;
  backendAccountSlug:string; backendExpiresAt:string; backendRole:"admin"|"member";
  backendUserId:string; backendUsername:string|null;
};
export type ProtocolSetup = {
  ref:string; handle:string; createdAt:string; claims:ProtocolClaims; grant:CredentialChangeAttempt; settings:AccountSettings;
  // Controlled upstream envelope metadata only, never a claimed SDK/provider proof.
  upstreamReauth:{provider:"google";challengeId:string;nonce:string;step:"awaiting-reauth"};
};

export const PASSWORD_PATH = "/workspace/settings/link-complete/password";
export const SESSION_COOKIE = "get350.fixture-session";

export async function writeProtocolApp(dir: string, repo: string) {
  const web = join(repo, "apps/web");
  const production = (path: string) => JSON.stringify(join(web, path));
  const files: Record<string, string> = {
    "package.json": JSON.stringify({ name: "get350-owned-next-protocol", private: true, type: "module" }),
    "tsconfig.json": JSON.stringify({ compilerOptions: {
      target: "ES2022", lib: ["dom", "dom.iterable", "esnext"], strict: true,
      skipLibCheck: true, noEmit: true, allowImportingTsExtensions: true, esModuleInterop: true, module: "esnext",
      moduleResolution: "bundler", resolveJsonModule: true, isolatedModules: true,
      jsx: "preserve", plugins: [{ name: "next" }],
      paths: { "@/auth": ["./unavailable-auth.ts"],
        "@/lib/server/backendAuth": ["./backend-auth.ts"], "@/*": ["../*"] },
    }, include: ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"], exclude: ["node_modules"] }),
    "next.config.mjs": `export default { poweredByHeader:false, reactStrictMode:true,
      experimental:{useTypeScriptCli:false}, turbopack:{root:${JSON.stringify(repo)},resolveAlias:{
        "@/auth":${JSON.stringify(join(dir,"unavailable-auth.ts"))},
        "@/lib/server/backendAuth":${JSON.stringify(join(dir,"backend-auth.ts"))}
      }} };`,
    "unavailable-auth.ts": `import type NextAuth from "next-auth";
      type AuthResult = ReturnType<typeof NextAuth>;
      const unavailable = async () => { throw new Error("OAuth/Auth.js is outside this owned protocol fixture"); };
      export const auth = unavailable as AuthResult["auth"];
      export const signIn = unavailable as AuthResult["signIn"];
      export const signOut = unavailable as AuthResult["signOut"];
      export const handlers = {GET:unavailable,POST:unavailable} as AuthResult["handlers"];`,
    "backend-auth.ts": `import "server-only";
      import {cache} from "react";
      import {cookies,headers} from "next/headers";
      import {TalentSignalClient} from "@talent-signal/contracts";
      import type {BackendSessionClaims} from ${production("lib/server/backendAuth.ts")};
      export type {BackendSessionClaims};
      export function authSecret(){
        const secret=process.env.AUTH_SECRET;
        if(!secret || secret.length<32) throw new Error("Missing synthetic fixture secret");
        return secret;
      }
      const lookup=cache(async():Promise<BackendSessionClaims|null>=>{
        const handle=(await cookies()).get(${JSON.stringify(SESSION_COOKIE)})?.value;
        if(!handle) return null;
        const response=await fetch(process.env.GET350_CONTROL_URL+"/session",{
          method:"POST",cache:"no-store",redirect:"error",
          headers:{"content-type":"application/json","x-get350-control":process.env.GET350_CONTROL_KEY!},
          body:JSON.stringify({handle}),signal:AbortSignal.timeout(5000)});
        if(!response.ok) return null;
        return await response.json() as BackendSessionClaims;
      });
      export const readPrimaryBackendSessionClaims=lookup;
      export async function readBackendSessionClaims(){
        const claims=await lookup();
        const expected=(await headers()).get("x-talent-signal-workspace");
        if(expected && claims?.backendAccountId!==expected) throw new Error("Fixture workspace mismatch");
        return claims;
      }
      export async function authenticatedBackendClient(){
        const claims=await readBackendSessionClaims();
        if(!claims || Date.parse(claims.backendExpiresAt)<=Date.now()) return null;
        // Match the real Web wrapper: no browser Origin is added here.
        return new TalentSignalClient(process.env.TALENT_SIGNAL_BACKEND_URL!,claims.backendAccessToken);
      }`,
    "app/layout.tsx": `import {LocaleProvider} from ${production("components/locale-provider.tsx")};
      import Bridge from "./bridge";
      export default function Layout({children}:{children:React.ReactNode}){
        return <html lang="zh-CN"><body><LocaleProvider locale="zh-CN"><Bridge/>{children}</LocaleProvider></body></html>;
      }`,
    "app/bridge.tsx": `"use client";
      import Link from "next/link"; import {useEffect} from "react";
      export default function Bridge(){useEffect(()=>{document.documentElement.dataset.get350Ready="true";},[]);
        return <Link id="fixture-next-navigation" prefetch={false} href=${JSON.stringify(PASSWORD_PATH)}>Fixture Next navigation</Link>;
      }`,
    "app/page.tsx": "export default function Home(){return <p>Owned GET350 protocol fixture</p>;}",
    "app/workspace/settings/page.tsx": "export default function Settings(){return <p>Fixture settings boundary</p>;}",
    "app/workspace/settings/link-complete/password/page.tsx": `export const dynamic="force-dynamic";
      export {default,metadata} from ${production("app/workspace/settings/link-complete/password/page.tsx")};`,
    "app/workspace/settings/link-complete/password/error.tsx": `"use client";
      export {default} from ${production("app/workspace/settings/link-complete/password/error.tsx")};`,
    "app/__get350/setup/route.ts": `import {cookies} from "next/headers";
      import {NextResponse} from "next/server";
      import {sealAuthOperation,sessionFingerprint,type AuthOperation} from ${production("lib/server/stagedAuth.ts")};
      import type {ProtocolSetup} from ${JSON.stringify(join(repo,"apps/backend/src/evaluation/get350NextProtocolApp.ts"))};
      export async function POST(request:Request){
        if(request.headers.get("x-get350-control")!==process.env.GET350_CONTROL_KEY) return new Response(null,{status:403});
        const {slot}=await request.json();
        const response=await fetch(process.env.GET350_CONTROL_URL+"/setup",{
          method:"POST",cache:"no-store",redirect:"error",signal:AbortSignal.timeout(5000),
          headers:{"content-type":"application/json","x-get350-control":process.env.GET350_CONTROL_KEY!},
          body:JSON.stringify({slot})});
        if(!response.ok) return new Response(null,{status:409});
        const f=await response.json() as ProtocolSetup;
        if(f.grant.provider_challenge!==null || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(f.upstreamReauth.challengeId) ||
          !/^[A-Za-z0-9_-]{32,}$/.test(f.upstreamReauth.nonce)) throw new Error("Malformed controlled reauth envelope");
        (await cookies()).set(${JSON.stringify(SESSION_COOKIE)},f.handle,{httpOnly:true,sameSite:"lax",secure:false,path:"/"});
        // Match83cd link-complete/route.ts128-149: password retains awaiting-reauth
        // and projects provider_challenge=null to empty challenge fields, never undefined.
        const operation:AuthOperation={ref:f.ref,intent:"change_password",reauthProvider:f.upstreamReauth.provider,
          reauthChallengeId:f.upstreamReauth.challengeId,clientLabel:"talent-signal-web",
          accountId:f.claims.backendAccountId,userId:f.claims.backendUserId,
          sessionFingerprint:sessionFingerprint(f.claims),
          accountRevision:f.settings.workspace.revision,userRevision:f.settings.user.revision,
          step:f.upstreamReauth.step,attempt:{attempt_id:f.grant.attempt_id,attempt_secret:f.grant.attempt_secret,
            challenge_id:"",challenge_nonce:""},createdAt:f.createdAt};
        await sealAuthOperation(operation,false);
        return NextResponse.json({ready:true},{headers:{"cache-control":"no-store"}});
      }`,
    "app/__get350/inspect/route.ts": `import {NextResponse} from "next/server";
      import {cookies} from "next/headers";import {createHash} from "node:crypto";
      import {readAuthOperation,flowIsLive,AUTH_OPERATION_COOKIE} from ${production("lib/server/stagedAuth.ts")};
      export async function POST(request:Request){
        if(request.headers.get("x-get350-control")!==process.env.GET350_CONTROL_KEY) return new Response(null,{status:403});
        const {ref}=await request.json();const op=await readAuthOperation();
        const jwt=op as (NonNullable<typeof op>&{exp?:unknown;iat?:unknown;jti?:unknown})|null;
        const sealed=(await cookies()).get(AUTH_OPERATION_COOKIE)?.value;
        const digest=(value:unknown)=>createHash("sha256").update(JSON.stringify(value??null)).digest("hex");
        const validEnvelope=Boolean(sealed&&op&&Number.isFinite(Date.parse(op.createdAt))&&typeof jwt?.exp==="number");
        return NextResponse.json({matches:op?.ref===ref,live:flowIsLive(op),hasAttempt:Boolean(op?.attempt),validEnvelope,
          createdAtHash:digest(op?.createdAt),expHash:digest(jwt?.exp),iatHash:digest(jwt?.iat),jtiHash:digest(jwt?.jti),
          envelopeHash:digest(sealed)}, {headers:{"cache-control":"no-store"}});
      }`,
  };
  for (const [name, body] of Object.entries(files)) {
    const file = join(dir, name);
    await mkdir(join(file, ".."), { recursive: true, mode: 0o700 });
    await writeFile(file, body, { mode: 0o600, flag: "wx" });
  }
}
