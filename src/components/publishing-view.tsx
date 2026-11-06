"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import {
  CheckCircle2,
  ExternalLink,
  Play,
  Rocket,
  ShieldCheck,
} from "lucide-react";
import type { Book, JobSummary, Validation, Workspace } from "@/lib/types";
import { api, Badge, date, Empty, Issues, Spinner } from "./ui";
import { PageHeading, type Actions } from "./workspace";
import { validateBook } from "@/lib/validation";
const stage = (status: JobSummary["status"]) =>
  ({
    queued: "Preparing",
    uploading: "Uploading",
    generating: "Generating",
    success: "Complete",
    failed: "Failed",
  })[status];
export default function Publishing({
  data,
  actions,
}: {
  data: Workspace;
  actions: Actions;
}) {
  const [selected, setSelected] = useState(() =>
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("book") ||
        data.books.find((b) => b.status !== "archived")?.id ||
        ""
      : "",
  );
  const [validation, setValidation] = useState<Validation | null>(null),
    [checking, setChecking] = useState(false),
    [generating, setGenerating] = useState(false),
    [paused, setPaused] = useState(false);
  const [technicalError, setTechnicalError] = useState("");
  const [rechecking, setRechecking] = useState<string | null>(null);
  const [recheckErrors, setRecheckErrors] = useState<Record<string, string>>(
    {},
  );
  const [checkedRevision, setCheckedRevision] = useState<number | null>(null);
  const book = data.books.find((b) => b.id === selected),
    template = data.templates.find((t) => t.id === book?.templateId);
  const active = data.jobs.find(
    (j) => !["failed", "success"].includes(j.status),
  );
  const { refresh, notify } = actions;
  const readiness =
    validation && checkedRevision === book?.revision
      ? validation
      : book
        ? validateBook(
            book,
            template,
            data.assets,
            data.connection.connected,
            data.preferences.dpi,
          )
        : null;
  // Progress is persisted server-side. Keeping this view open drives bounded polling.
  useEffect(() => {
    if (!active || paused) return;
    let disposed = false;
    const timer = setTimeout(
      async () => {
        try {
          await api(`jobs/${active.id}/advance`, "POST");
          if (!disposed) await refresh();
        } catch (e) {
          if (!disposed) {
            setPaused(true);
            notify((e as Error).message, true);
          }
        }
      },
      Math.min(60000, Math.max(1000, active.nextAt - Date.now())),
    );
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [active, paused, refresh, notify]);
  async function check() {
    if (!book) return;
    setChecking(true);
    setTechnicalError("");
    try {
      setValidation(await api<Validation>(`books/${book.id}/validate`, "POST"));
      setCheckedRevision(book.revision);
      await refresh();
    } catch (e) {
      notify((e as Error).message, true);
      setTechnicalError((e as Error).message);
      setValidation(null);
    } finally {
      setChecking(false);
    }
  }
  async function recheck(id: string) {
    setRechecking(id);
    setRecheckErrors((previous) => ({ ...previous, [id]: "" }));
    try {
      const result = await api<JobSummary>(`jobs/${id}/recheck`, "POST");
      await refresh();
      setPaused(false);
      notify(
        result.status === "success"
          ? `Canva confirmed CREATED design ${result.designId}. Link refreshed.`
          : result.message,
      );
    } catch (error) {
      setRecheckErrors((previous) => ({
        ...previous,
        [id]: (error as Error).message,
      }));
    } finally {
      setRechecking(null);
    }
  }
  return (
    <>
      <PageHeading
        title="Publishing"
        description="Validate your book and generate an editable Canva draft."
      />
      <div className="publishing-layout">
        <section className="panel publishing-form">
          <div className="section-head">
            <h2>Generate Canva Draft</h2>
            <Rocket size={20} />
          </div>
          <label>
            Book project
            <select
              value={selected}
              onChange={(e) => {
                setSelected(e.target.value);
                setValidation(null);
                setTechnicalError("");
              }}
            >
              <option value="">Select a book</option>
              {data.books
                .filter((b) => b.status !== "archived")
                .map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.title}
                  </option>
                ))}
            </select>
          </label>
          {book && (
            <>
              <div className="publish-book-info">
                <BookSummary book={book} />
              </div>
              <label>
                Canva source template
                <select
                  value={book.templateId || ""}
                  onChange={(e) => {
                    setValidation(null);
                    setTechnicalError("");
                    void actions.run(
                      () =>
                        api(`books/${book.id}`, "PUT", {
                          ...book,
                          templateId: e.target.value || null,
                        }),
                      "Template selected",
                    );
                  }}
                >
                  <option value="">Choose a registered design</option>
                  {data.templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} · {t.pageCount ?? "unverified"} pages
                    </option>
                  ))}
                </select>
              </label>
              <div className="publish-summary">
                <span>Canva account</span>
                <Badge tone={data.connection.connected ? "green" : "neutral"}>
                  {data.connection.connected ? "Connected" : "Not connected"}
                </Badge>
                <span>Page count</span>
                <strong>
                  {book.pages.length} book / {template?.pageCount ?? "?"}{" "}
                  template
                </strong>
                <span>Print target</span>
                <strong>{data.preferences.dpi} DPI</strong>
                <span>Output</span>
                <strong>Editable Canva design</strong>
              </div>
              <div className="publish-buttons">
                <button
                  disabled={checking || !!active}
                  onClick={() => void check()}
                >
                  {checking ? <Spinner /> : <ShieldCheck size={17} />}Validate
                  readiness
                </button>
                <button
                  className="primary"
                  disabled={
                    generating ||
                    checking ||
                    !!active ||
                    !!technicalError ||
                    !readiness ||
                    readiness.errors.length > 0
                  }
                  onClick={async () => {
                    setGenerating(true);
                    setTechnicalError("");
                    try {
                      const job = await api<JobSummary>(
                        `books/${book.id}/publish`,
                        "POST",
                      );
                      if (job.validation) {
                        setValidation(job.validation);
                        setCheckedRevision(book.revision);
                      }
                      await refresh();
                      setPaused(false);
                      notify(
                        "Draft creation queued. Canva completion has not yet been confirmed.",
                      );
                    } catch (error) {
                      const message =
                        error instanceof Error
                          ? error.message
                          : "Canva could not generate a draft. Validate and retry.";
                      setTechnicalError(message);
                      notify(message, true);
                    } finally {
                      setGenerating(false);
                    }
                  }}
                >
                  {generating ? <Spinner /> : <Rocket size={17} />}Create New
                  Canva Draft
                </button>
              </div>
              <p className="form-note">
                Creates a separate Canva design every time. Existing Canva books
                are not updated. Local saves do not change Canva. Your source
                design stays unchanged.
              </p>
            </>
          )}
        </section>
        <section
          className="panel validation-panel"
          aria-label="Draft readiness"
        >
          <div className="section-head">
            <h2>Draft readiness</h2>
            <Badge
              tone={
                readiness && !readiness.errors.length && !technicalError
                  ? "green"
                  : "neutral"
              }
            >
              {checking
                ? "Checking…"
                : technicalError
                  ? "Needs retry"
                  : readiness
                    ? readiness.errors.length
                      ? "Unavailable"
                      : "Available"
                    : "Select a book"}
            </Badge>
          </div>
          {technicalError && (
            <div role="alert" className="notice error">
              <span>{technicalError}</span>
              <button disabled={checking} onClick={() => void check()}>
                Retry validation
              </button>
            </div>
          )}
          {checking ? (
            <div className="loading">
              <Spinner />
              Checking live template access and book content…
            </div>
          ) : readiness ? (
            <Issues value={readiness} />
          ) : (
            <Empty icon={ShieldCheck} title="Validate before generating">
              <p>
                Choose a book to see compatible fields and draft advisories.
                Live Canva access is checked again when generating.
              </p>
            </Empty>
          )}
        </section>
      </div>
      {active && (
        <section className="panel active-job">
          <div className="section-head">
            <h2>
              <Spinner />
              {active.title}
            </h2>
            <Badge>{stage(active.status)}</Badge>
          </div>
          <p role="status">{active.message}</p>
          {!!active.validation?.skipped?.filter((field) => field.populated)
            .length && (
            <p className="warning">
              Populated fields skipped:{" "}
              {
                active.validation.skipped.filter((field) => field.populated)
                  .length
              }
              . Review the submission report below; that content was not sent to
              Canva.
            </p>
          )}
          <div className="progress-track">
            <span style={{ width: `${active.progress}%` }} />
          </div>
          <div className="section-head">
            <span className="muted">
              {active.progress}% ·{" "}
              {paused
                ? "Polling paused"
                : "Polling Canva for confirmed progress"}
            </span>
            {paused && (
              <button onClick={() => setPaused(false)}>
                <Play size={17} />
                Resume status checks
              </button>
            )}
          </div>
          <p className="form-note">
            Keep Publishing open to continue. Returning here resumes this job
            after an app restart.
          </p>
          {active.validation && (
            <details className="validation-details">
              <summary>Submission report</summary>
              <Issues value={active.validation} />
            </details>
          )}
        </section>
      )}
      <div className="section-head">
        <h2>
          Publishing history <span className="count">{data.jobs.length}</span>
        </h2>
      </div>
      <div className="panel history-table">
        {data.jobs.length ? (
          <table>
            <thead>
              <tr>
                <th>BOOK / CREATED</th>
                <th>STATUS</th>
                <th>DETAILS</th>
                <th>CANVA DESIGN</th>
              </tr>
            </thead>
            <tbody>
              {data.jobs.map((job) => (
                <tr key={job.id}>
                  <td>
                    <strong>{job.title}</strong>
                    <span>{date(job.createdAt)}</span>
                  </td>
                  <td>
                    <Badge
                      tone={
                        job.status === "success"
                          ? "green"
                          : job.status === "failed"
                            ? "red"
                            : "neutral"
                      }
                    >
                      {stage(job.status)}
                    </Badge>
                  </td>
                  <td className="job-message">
                    {job.message}
                    {job.status === "success" && (
                      <p>
                        <strong>CREATED a separate design</strong> · Existing
                        Canva books were not updated.
                      </p>
                    )}
                    {job.remoteId && job.remoteId !== "uncertain" && (
                      <p>
                        Canva job ID: <code>{job.remoteId}</code>
                      </p>
                    )}
                    {job.resultType && (
                      <p>
                        API result: <code>{job.resultType}</code>
                      </p>
                    )}
                    {job.confirmedAt && (
                      <p>Confirmed: {date(job.confirmedAt)}</p>
                    )}
                    {job.remoteId && job.remoteId !== "uncertain" && (
                      <button
                        disabled={rechecking !== null || !!active}
                        onClick={() => void recheck(job.id)}
                      >
                        {rechecking === job.id ? <Spinner /> : null}Check Canva
                        status / refresh link
                      </button>
                    )}
                    {recheckErrors[job.id] && (
                      <p role="alert" className="warning">
                        {recheckErrors[job.id]} Previous publishing records are
                        preserved. Check the authorised Canva account in
                        Settings before creating another draft.
                      </p>
                    )}
                    {!!job.validation?.skipped?.filter(
                      (field) => field.populated,
                    ).length && (
                      <p className="warning">
                        Populated fields skipped:{" "}
                        {
                          job.validation.skipped.filter(
                            (field) => field.populated,
                          ).length
                        }{" "}
                        · see report
                      </p>
                    )}
                    {job.validation && (
                      <details className="validation-details">
                        <summary>Submission report</summary>
                        <Issues value={job.validation} />
                      </details>
                    )}
                  </td>
                  <td>
                    {job.designId && (
                      <p>
                        Design ID: <code>{job.designId}</code>
                      </p>
                    )}
                    {job.designUrl ? (
                      <a
                        className="button"
                        href={job.designUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Open in Canva
                        <ExternalLink size={15} />
                      </a>
                    ) : job.designId ? (
                      <span>{job.designId}</span>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <Empty icon={Rocket} title="No publishing history">
            <p>Your jobs and generated designs will be kept here.</p>
          </Empty>
        )}
      </div>
      <div className="notice">
        <CheckCircle2 size={18} />
        <span>
          Finish and review the generated design in Canva.{" "}
          <Link href="/templates">Manage templates</Link>
        </span>
      </div>
    </>
  );
}
function BookSummary({ book }: { book: Book }) {
  return (
    <>
      <strong>{book.title}</strong>
      <span>
        {book.pages.length} pages ·{" "}
        {book.pages.filter((p) => p.text.trim()).length} with text ·{" "}
        {book.pages.filter((p) => p.assetId).length} illustrated
      </span>
      <Link className="text-link" href={`/books/${book.id}`}>
        Open editor
        <ExternalLink size={14} />
      </Link>
    </>
  );
}
