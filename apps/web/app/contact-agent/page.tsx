import { ContactAgentWorkspace } from "@/components/contact-agent/contact-agent-workspace";
export const dynamic="force-dynamic";
export const metadata={title:"截图归档 · capri",robots:{index:false,follow:false}};
export default async function Page({searchParams}:{searchParams:Promise<{task?:string}>}){
  const task = (await searchParams).task;
  return <ContactAgentWorkspace initialTaskID={task && /^[0-9a-f-]{36}$/iu.test(task) ? task : undefined}/>;
}
