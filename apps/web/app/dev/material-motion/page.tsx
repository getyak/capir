import { notFound } from "next/navigation";

import { MaterialMotionPreview } from "./preview";

export default async function MaterialMotionPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  if (process.env.NODE_ENV !== "development") notFound();
  const { view } = await searchParams;
  return <MaterialMotionPreview view={view === "second" ? "second" : "first"} />;
}
