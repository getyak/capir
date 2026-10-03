import { redirect } from "next/navigation";
import { browserClaims } from "@/lib/server/browser-capture";
import { ContactAgentWorkspace } from "@/components/contact-agent/contact-agent-workspace";
export const dynamic="force-dynamic";
export const metadata={title:"来源 · capri",robots:{index:false,follow:false}};
export default async function Page({searchParams}:{searchParams:Promise<{task?:string}>}){
  const {task}=await searchParams;
  const taskID=task&&/^[0-9a-f-]{36}$/i.test(task)?task:undefined;
  if(!await browserClaims())redirect(`/login?callbackUrl=${encodeURIComponent(`/workspace/captures${taskID?`?task=${taskID}`:""}`)}`);
  return <ContactAgentWorkspace embedded initialTaskID={taskID}/>;
}
