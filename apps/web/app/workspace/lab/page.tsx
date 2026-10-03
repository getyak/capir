import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { TalentSignalLabWorkspace } from "@/components/talent-signal-lab/lab-workspace";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "capri Lab",
  description: "隔离场景、Signal Lens、可比较重放与 Reality Receipt。",
  robots: { follow: false, index: false },
};

export default async function TalentSignalLabPage() {
  if (!(await auth())?.user) redirect("/login?callbackUrl=%2Fworkspace%2Flab");
  return <TalentSignalLabWorkspace />;
}
