import { redirect,notFound } from "next/navigation";
import { browserClaims } from "@/lib/server/browser-capture";
import { ContactAgentWorkspace } from "@/components/contact-agent/contact-agent-workspace";
export const dynamic="force-dynamic";
export const metadata={title:"人物来源 · capri",robots:{index:false,follow:false}};
export default async function Page({params,searchParams}:{params:Promise<{id:string}>;searchParams:Promise<{context?:string}>}){
  const {id}=await params;const {context}=await searchParams;
  if(!/^[0-9a-f-]{36}$/i.test(id)||!context||!/^[0-9a-f-]{36}$/i.test(context))notFound();
  if(!await browserClaims())redirect(`/login?callbackUrl=${encodeURIComponent(`/workspace/captures/people/${id}?context=${context}`)}`);
  return <ContactAgentWorkspace embedded personID={id} contextID={context}/>;
}
