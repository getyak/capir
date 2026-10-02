import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { WorkspaceApp } from "@/components/workspace-app";
import {
  candidateMomentumFixtures,
  type WorkspaceDataSource,
} from "@/lib/candidateMomentum";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "边界案例",
  description:
    "用于 capri 证据审阅工作台的已认证合成边界案例。",
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

  const source: WorkspaceDataSource = {
    kind: "fixture-fallback",
    label: "冻结的示例案例",
    detail:
      "这八个合成案例只用于验证审阅界面；当前后端行为由运行时评测套件另行核验。",
  };
  return (
    <WorkspaceApp
      dataset={candidateMomentumFixtures}
      source={source}
      user={{
        email: session.user.email,
        name: session.user.name,
      }}
    />
  );
}
