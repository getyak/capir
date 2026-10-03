import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { WorkspaceApp } from "@/components/workspace-app";
import { loadCandidateWorkspace } from "@/lib/server/candidateWorkspace";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "边界案例",
  description:
    "用于 capri 证据审阅工作台的已认证评测边界案例。",
  robots: {
    follow: false,
    index: false,
  },
};

export default async function WorkspaceBoundariesPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/login?callbackUrl=/workspace/boundaries");
  }

  const { dataset, source } = await loadCandidateWorkspace();
  return (
    <WorkspaceApp
      dataset={dataset}
      source={source}
      user={{
        email: session.user.email,
        name: session.user.name,
      }}
    />
  );
}
