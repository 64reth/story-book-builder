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
                      notify("Publishing started");
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
                  {generating ? <Spinner /> : <Rocket size={17} />}Generate
                  Canva Draft
                </button>
              </div>
              <p className="form-note">
                Creates a new copy. Canva controls the final layout; your source
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
            <Badge>{active.status}</Badge>
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
                      {job.status}
                    </Badge>
                  </td>
                  <td className="job-message">
                    {job.message}
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
