import WorkspaceApp from "@/components/workspace";
import { Suspense } from "react";
export default function Page() {
  return (
    <Suspense
      fallback={<div className="loading">Opening Story Book Builder…</div>}
    >
      <WorkspaceApp />
    </Suspense>
  );
}
