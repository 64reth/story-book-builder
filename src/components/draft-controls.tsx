"use client";
import { useEffect, useState } from "react";
import { api, Spinner } from "./ui";
import type { Actions } from "./workspace";
import type { AutofillField, Book, JobSummary, Workspace } from "@/lib/types";
type Drafts = {
  active?: string;
  candidates: { designId: string; url?: string; publishedAt: string }[];
};
type Plan = {
  designId: string;
  fields: AutofillField[];
  revision: number;
  warning: string;
  skipped: { field: string; reason: string }[];
};
export default function DraftControls({
  book,
  data,
  actions,
  disabled = false,
}: {
  book: Book;
  data: Workspace;
  actions: Actions;
  disabled?: boolean;
}) {
  const [drafts, setDrafts] = useState<Drafts>({ candidates: [] });
  const [plan, setPlan] = useState<Plan | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const activeJob = data.jobs.find(
    (j) => !["success", "failed"].includes(j.status),
  );
  const latest = data.jobs.find(
    (j) => j.bookId === book.id && j.status === "success",
  );
  const { refresh } = actions;
  useEffect(() => {
    let cancelled = false;
    void api<Drafts>(`books/${book.id}/drafts`)
      .then((value) => {
        if (!cancelled) setDrafts(value);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [book.id, latest?.id, latest?.updatedAt]);
  useEffect(() => {
    if (!activeJob) return;
    const timer = setTimeout(
      () => {
        void api(`jobs/${activeJob.id}/advance`, "POST")
          .then(() => refresh())
          .catch((e) => setError(e.message));
      },
      Math.min(60000, Math.max(1000, activeJob.nextAt - Date.now())),
    );
    return () => clearTimeout(timer);
  }, [activeJob, refresh]);
  async function run(operation: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await operation();
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function submit(update: boolean) {
    await run(async () => {
      const job = await api<JobSummary>(`books/${book.id}/publish`, "POST", {
        operation: update ? "update_design" : "create_from_design",
        approved:
          update && plan
            ? {
                fields: plan.fields.map((f) => f.field),
                revision: plan.revision,
                designId: plan.designId,
              }
            : undefined,
      });
      setPlan(null);
      actions.notify(job.message);
    });
  }
  return (
    <div className="draft-controls">
      {!!drafts.candidates.length && (
        <label>
          Active Canva draft
          <select
            aria-label="Active Canva draft"
            value={drafts.active ?? ""}
            disabled={busy || !!activeJob}
            onChange={(e) =>
              void run(async () => {
                await api(`books/${book.id}/drafts`, "POST", {
                  designId: e.target.value,
                });
                setDrafts({ ...drafts, active: e.target.value });
                setPlan(null);
              })
            }
          >
            <option value="" disabled>
              Select a generated draft
            </option>
            {drafts.candidates.map((d) => (
              <option key={d.designId} value={d.designId}>
                {d.designId} · {new Date(d.publishedAt).toLocaleString()}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="draft-actions">
        {drafts.active && (
          <button
            className="primary"
            disabled={
              disabled || busy || !!activeJob || !data.connection.connected
            }
            onClick={() =>
              void run(async () => {
                setPlan(
                  await api<Plan>(`books/${book.id}/refinement-plan`, "POST"),
                );
              })
            }
          >
            Refine Canva Draft
          </button>
        )}
        <button
          className={drafts.active ? "" : "primary"}
          disabled={
            disabled || busy || !!activeJob || !data.connection.connected
          }
          onClick={() => void submit(false)}
        >
          Create New Canva Draft
        </button>
        {latest?.designUrl && (
          <a
            className="button"
            href={latest.designUrl}
            target="_blank"
            rel="noreferrer"
          >
            Open in Canva
          </a>
        )}
        {busy && <Spinner />}
      </div>
      {plan && (
        <div
          className="refinement-review"
          role="region"
          aria-label="Refinement review"
        >
          <strong>
            {plan.fields.length
              ? `${plan.fields.length} changed fields → ${plan.designId}`
              : "No changes to submit"}
          </strong>
          <p>{plan.warning}</p>
          <ul>
            {plan.fields.map((f) => (
              <li key={f.field}>
                {f.field} · {f.kind} · page {f.page}
              </li>
            ))}
          </ul>
          {!!plan.skipped.length && (
            <details>
              <summary>{plan.skipped.length} skipped fields</summary>
              {plan.skipped.map((f) => (
                <p key={f.field}>
                  {f.field}: {f.reason}
                </p>
              ))}
            </details>
          )}
          <button
            disabled={
              !plan.fields.length ||
              busy ||
              disabled ||
              plan.revision !== book.revision
            }
            onClick={() => void submit(true)}
          >
            Refine {plan.fields.length} reviewed fields
          </button>
          <button onClick={() => setPlan(null)}>Close review</button>
        </div>
      )}
      {activeJob && (
        <div role="status">
          <progress value={activeJob.progress} max={100} />
          <span>
            {activeJob.status}: {activeJob.message}
          </span>
        </div>
      )}
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
