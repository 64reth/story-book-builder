"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Check,
  ChevronLeft,
  ChevronRight,
  FileText,
  History,
  ImagePlus,
  Redo2,
  Save,
  Undo2,
  Upload,
  X,
} from "lucide-react";
import type { Book, Page, Workspace } from "@/lib/types";
import { distributeManuscript } from "@/lib/validation";
import { api, Badge, date, Modal, PagePreview, Spinner, words } from "./ui";
import type { Actions } from "./workspace";

export default function Editor({
  book,
  data,
  actions,
  onUnsaved,
}: {
  book: Book;
  data: Workspace;
  actions: Actions;
  onUnsaved: (value: boolean) => void;
}) {
  const [draft, setDraft] = useState(book),
    [selected, setSelected] = useState(0),
    [dirty, setDirty] = useState(false),
    [saving, setSaving] = useState(false),
    [saveError, setSaveError] = useState(""),
    [retry, setRetry] = useState(0);
  const [history, setHistory] = useState<Book[]>([]),
    [future, setFuture] = useState<Book[]>([]),
    [panel, setPanel] = useState("text"),
    [guides, setGuides] = useState(true),
    [importing, setImporting] = useState(false),
    [versionsOpen, setVersionsOpen] = useState(false),
    [metadata, setMetadata] = useState(false);
  const editSequence = useRef(0),
    draftRef = useRef(draft),
    historyTime = useRef(0);
  const { notify, refresh } = actions;
  const page = draft.pages[selected],
    asset = data.assets.find((a) => a.id === page.assetId);
  function change(next: Book, record = true) {
    if (record && Date.now() - historyTime.current > 900) {
      setHistory((h) => [...h.slice(-39), draft]);
      historyTime.current = Date.now();
    }
    setFuture([]);
    editSequence.current++;
    setDraft(next);
    draftRef.current = next;
    setDirty(true);
    setSaveError("");
  }
  function changePage(patch: Partial<Page>) {
    change({
      ...draft,
      pages: draft.pages.map((p, i) =>
        i === selected ? { ...p, ...patch } : p,
      ),
    });
  }
  useEffect(() => {
    onUnsaved(dirty || saving);
    return () => onUnsaved(false);
  }, [dirty, saving, onUnsaved]);
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirty || saving) e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty, saving]);
  useEffect(() => {
    if (!dirty || saving || saveError) return;
    const timer = setTimeout(async () => {
      const sequence = editSequence.current,
        payload = draftRef.current;
      setSaving(true);
      try {
        const saved = await api<Book>(`books/${book.id}`, "PUT", payload);
        if (sequence === editSequence.current) {
          setDraft(saved);
          draftRef.current = saved;
          setDirty(false);
        } else {
          setDraft((current) => {
            const next = { ...current, revision: saved.revision };
            draftRef.current = next;
            return next;
          });
        }
        await refresh();
      } catch (e) {
        setSaveError(e instanceof Error ? e.message : "Save failed.");
      } finally {
        setSaving(false);
      }
    }, 650);
    return () => clearTimeout(timer);
  }, [draft, dirty, saving, saveError, retry, book.id, refresh]);
  function undo() {
    const previous = history.at(-1);
    if (!previous) return;
    setFuture((f) => [draft, ...f]);
    setHistory((h) => h.slice(0, -1));
    editSequence.current++;
    const next = { ...previous, revision: draft.revision };
    draftRef.current = next;
    setDraft(next);
    setDirty(true);
    setSaveError("");
  }
  function redo() {
    const next = future[0];
    if (!next) return;
    setHistory((h) => [...h, draft]);
    setFuture((f) => f.slice(1));
    editSequence.current++;
    const value = { ...next, revision: draft.revision };
    draftRef.current = value;
    setDraft(value);
    setDirty(true);
    setSaveError("");
  }
  function move(direction: number) {
    const destination = selected + direction;
    if (destination < 0 || destination >= draft.pages.length) return;
    const pages = [...draft.pages];
    [pages[selected], pages[destination]] = [
      pages[destination],
      pages[selected],
    ];
    historyTime.current = 0;
    change({ ...draft, pages });
    setSelected(destination);
  }
  return (
    <>
      <div className="editor-heading">
        <div>
          <Link
            className="text-link"
            href="/books"
            onClick={(e) => {
              if (dirty || saving) {
                e.preventDefault();
                notify("Wait for the book to save before leaving.", true);
              }
            }}
          >
            <ArrowLeft size={15} />
            Book Library
          </Link>
          <h1>{draft.title}</h1>
          <div className="editor-subtitle">
            <Badge>{draft.status}</Badge>
            <span>{draft.pages.length} pages</span>
            <span>
              {draft.width} × {draft.height} in
            </span>
            <button className="text-link" onClick={() => setMetadata(true)}>
              Book settings
            </button>
          </div>
        </div>
        <div className="editor-actions">
          <span
            className={`save-status ${saveError ? "error" : ""}`}
            role="status"
          >
            {saving ? (
              <Spinner />
            ) : dirty ? (
              <Save size={16} />
            ) : (
              <Check size={16} />
            )}{" "}
            {saveError
              ? "Save failed"
              : saving
                ? "Saving…"
                : dirty
                  ? "Unsaved changes"
                  : "All changes saved"}
          </span>
          <button
            className="icon-button"
            title="Undo"
            aria-label="Undo"
            disabled={!history.length}
            onClick={undo}
          >
            <Undo2 size={18} />
          </button>
          <button
            className="icon-button"
            title="Redo"
            aria-label="Redo"
            disabled={!future.length}
            onClick={redo}
          >
            <Redo2 size={18} />
          </button>
          <button onClick={() => setImporting(true)}>
            <Upload size={17} />
            Import manuscript
          </button>
          <button
            aria-label="Draft versions"
            onClick={() => setVersionsOpen(true)}
            disabled={dirty || saving}
          >
            <History size={18} />
          </button>
          <Link
            className={`button primary ${dirty || saving ? "disabled" : ""}`}
            href={`/publishing?book=${book.id}`}
            aria-disabled={dirty || saving}
            onClick={(e) => {
              if (dirty || saving) e.preventDefault();
            }}
          >
            Validate book
            <ChevronRight size={17} />
          </Link>
        </div>
      </div>
      {saveError && (
        <div className="notice error">
          <span>{saveError}</span>
          <button
            onClick={() => {
              setSaveError("");
              setRetry((n) => n + 1);
            }}
          >
            Retry save
          </button>
          <button onClick={() => window.location.reload()}>
            Reload saved book
          </button>
        </div>
      )}
      <div className="editor-layout">
        <aside className="page-strip">
          <div className="strip-title">
            <strong>Pages</strong>
            <span>{draft.pages.length}</span>
          </div>
          <div className="thumbnails">
            {draft.pages.map((p, i) => (
              <button
                key={p.id}
                className={`thumbnail ${i === selected ? "selected" : ""}`}
                onClick={() => setSelected(i)}
                aria-label={`Select page ${i + 1}`}
                aria-current={i === selected ? "page" : undefined}
              >
                <PagePreview
                  page={p}
                  asset={data.assets.find((a) => a.id === p.assetId)}
                  book={draft}
                  small
                />
                <span>
                  <strong>{String(i + 1).padStart(2, "0")}</strong>
                  <span
                    className={`page-dot ${p.assetId && p.text.trim() ? "complete" : ""}`}
                  />
                </span>
              </button>
            ))}
          </div>
        </aside>
        <section className="canvas-workspace">
          <div className="canvas-toolbar">
            <div>
              <Badge>Page {selected + 1}</Badge>
              <span>
                {page.assetId && page.text.trim() ? "Complete" : "In progress"}
              </span>
            </div>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={guides}
                onChange={(e) => setGuides(e.target.checked)}
              />
              Safe margin
            </label>
          </div>
          <div className="canvas-stage">
            <PagePreview
              page={page}
              asset={asset}
              book={draft}
              guides={guides}
            />
          </div>
          <div className="canvas-footer">
            <span>Local preview · {draft.margin} in safe margin</span>
            <div>
              <button
                className="icon-button"
                disabled={selected === 0}
                aria-label="Previous page"
                onClick={() => setSelected((i) => i - 1)}
              >
                <ChevronLeft size={19} />
              </button>
              <span>
                {selected + 1} / {draft.pages.length}
              </span>
              <button
                className="icon-button"
                disabled={selected === draft.pages.length - 1}
                aria-label="Next page"
                onClick={() => setSelected((i) => i + 1)}
              >
                <ChevronRight size={19} />
              </button>
            </div>
          </div>
        </section>
        <aside className="inspector">
          <div className="inspector-tabs">
            {[
              { id: "text", label: "Manuscript", icon: FileText },
              { id: "image", label: "Illustration", icon: ImagePlus },
            ].map((tab) => (
              <button
                className={panel === tab.id ? "active" : ""}
                onClick={() => setPanel(tab.id)}
                key={tab.id}
              >
                <tab.icon size={16} />
                {tab.label}
              </button>
            ))}
          </div>
          <div className="inspector-body">
            <div className="section-head">
              <h2>Page {selected + 1}</h2>
              <Badge
                tone={page.assetId && page.text.trim() ? "green" : "neutral"}
              >
                {page.assetId && page.text.trim() ? "Complete" : "Draft"}
              </Badge>
            </div>
            {panel === "text" ? (
              <>
                <label>
                  Manuscript text
                  <textarea
                    className="manuscript"
                    value={page.text}
                    onChange={(e) => changePage({ text: e.target.value })}
                    placeholder="Write or paste the text for this page…"
                  />
                </label>
                <div className="text-counter">
                  <span>{words(page.text)} words</span>
                  <span>{page.text.length} characters</span>
                </div>
                <hr />
                <h3>Text overlay preview</h3>
                <p className="form-note">
                  These controls affect the local preview. The Canva template
                  owns the final layout.
                </p>
                <label>
                  Position
                  <select
                    value={page.textPosition}
                    onChange={(e) =>
                      changePage({
                        textPosition: e.target.value as Page["textPosition"],
                      })
                    }
                  >
                    <option value="top">Top</option>
                    <option value="center">Centre</option>
                    <option value="bottom">Bottom</option>
                  </select>
                </label>
                <div className="field-row">
                  <label>
                    Bubble colour
                    <input
                      type="color"
                      value={page.bubbleColor}
                      onChange={(e) =>
                        changePage({ bubbleColor: e.target.value })
                      }
                    />
                  </label>
                  <label>
                    Text colour
                    <input
                      type="color"
                      value={page.textColor}
                      onChange={(e) =>
                        changePage({ textColor: e.target.value })
                      }
                    />
                  </label>
                </div>
                <label>
                  Bubble opacity{" "}
                  <span>{Math.round(page.bubbleOpacity * 100)}%</span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={page.bubbleOpacity * 100}
                    onChange={(e) =>
                      changePage({
                        bubbleOpacity: Number(e.target.value) / 100,
                      })
                    }
                  />
                </label>
                <label>
                  Preview font size
                  <input
                    type="number"
                    min={12}
                    max={80}
                    value={page.fontSize}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      if (n >= 12 && n <= 80) changePage({ fontSize: n });
                    }}
                  />
                </label>
                <p className="form-note">
                  Typeface: {draft.font}. Install this font locally for a closer
                  preview.
                </p>
              </>
            ) : (
              <>
                <label>
                  Assigned illustration
                  <select
                    value={page.assetId || ""}
                    onChange={(e) =>
                      changePage({ assetId: e.target.value || null })
                    }
                  >
                    <option value="">Choose an illustration</option>
                    {data.assets.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name} · {a.width} × {a.height}
                      </option>
                    ))}
                  </select>
                </label>
                {asset ? (
                  <div className="assigned-image">
                    <img
                      src={`/api/assets/${asset.id}?v=${asset.filename}`}
                      alt={asset.name}
                    />
                    <span>
                      {asset.width} × {asset.height} px
                    </span>
                    <button onClick={() => changePage({ assetId: null })}>
                      <X size={16} />
                      Unassign
                    </button>
                  </div>
                ) : (
                  <div className="mini-empty">
                    Upload artwork in the Asset Library, then assign it here.
                  </div>
                )}
                <label>
                  Image placement
                  <select
                    value={page.placement}
                    onChange={(e) =>
                      changePage({
                        placement: e.target.value as Page["placement"],
                      })
                    }
                  >
                    <option value="cover">Fill page (crop to fit)</option>
                    <option value="contain">Fit whole image</option>
                  </select>
                </label>
                <div className="asset-picker">
                  {data.assets.map((a) => (
                    <button
                      key={a.id}
                      aria-label={`Assign ${a.name}`}
                      className={page.assetId === a.id ? "chosen" : ""}
                      onClick={() => changePage({ assetId: a.id })}
                    >
                      <img
                        src={`/api/assets/${a.id}?v=${a.filename}`}
                        alt={a.name}
                      />
                    </button>
                  ))}
                </div>
              </>
            )}
            <hr />
            <h3>Page order</h3>
            <div className="field-row">
              <button disabled={selected === 0} onClick={() => move(-1)}>
                <ArrowUp size={16} />
                Move earlier
              </button>
              <button
                disabled={selected === draft.pages.length - 1}
                onClick={() => move(1)}
              >
                <ArrowDown size={16} />
                Move later
              </button>
            </div>
          </div>
        </aside>
      </div>
      {importing && (
        <ImportManuscript
          book={draft}
          onClose={() => setImporting(false)}
          onApply={(texts) => {
            historyTime.current = 0;
            change({
              ...draft,
              pages: draft.pages.map((p, i) => ({ ...p, text: texts[i] })),
            });
            setImporting(false);
            notify("Manuscript applied. Review each page before publishing.");
          }}
        />
      )}
      {versionsOpen && (
        <Versions
          book={draft}
          actions={actions}
          onClose={() => setVersionsOpen(false)}
          onRestore={(saved) => {
            setDraft(saved);
            draftRef.current = saved;
            setDirty(false);
            setHistory([]);
            setFuture([]);
            setVersionsOpen(false);
          }}
        />
      )}
      {metadata && (
        <Modal title="Book settings" onClose={() => setMetadata(false)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setMetadata(false);
            }}
          >
            <label>
              Book title
              <input
                required
                value={draft.title}
                maxLength={255}
                onChange={(e) => change({ ...draft, title: e.target.value })}
              />
            </label>
            <label>
              Author
              <input
                value={draft.author}
                onChange={(e) => change({ ...draft, author: e.target.value })}
              />
            </label>
            <label>
              Canva template
              <select
                value={draft.templateId || ""}
                onChange={(e) =>
                  change({ ...draft, templateId: e.target.value || null })
                }
              >
                <option value="">Select a template</option>
                {data.templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} · {t.pageCount ?? "unverified"} pages
                  </option>
                ))}
              </select>
            </label>
            <label>
              Status
              <select
                value={draft.status}
                onChange={(e) =>
                  change({ ...draft, status: e.target.value as Book["status"] })
                }
              >
                <option value="draft">Draft</option>
                <option value="review">In review</option>
                <option value="archived">Archived</option>
              </select>
            </label>
            <div className="field-row">
              {(["width", "height", "margin"] as const).map((field) => (
                <label key={field}>
                  {field} (in)
                  <input
                    type="number"
                    min={field === "margin" ? 0 : 1}
                    max={field === "margin" ? 2 : 30}
                    step="0.001"
                    value={draft[field]}
                    onChange={(e) =>
                      change({ ...draft, [field]: Number(e.target.value) })
                    }
                  />
                </label>
              ))}
            </div>
            <label>
              Preview typeface
              <input
                value={draft.font}
                maxLength={100}
                onChange={(e) => change({ ...draft, font: e.target.value })}
              />
            </label>
            <p className="form-note">
              The final dimensions and typeface are defined by the Canva
              template. Page count is fixed for this book; create a matching
              book for a different length.
            </p>
            <div className="form-actions">
              <button className="primary">Done</button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
function ImportManuscript({
  book,
  onClose,
  onApply,
}: {
  book: Book;
  onClose: () => void;
  onApply: (texts: string[]) => void;
}) {
  const [text, setText] = useState(""),
    [mode, setMode] = useState<"manual" | "paragraphs">("manual"),
    [proposed, setProposed] = useState<string[] | null>(null),
    [error, setError] = useState("");
  return (
    <Modal title="Import manuscript" onClose={onClose}>
      <p className="form-note">
        Review and edit the page distribution before applying. This replaces the
        current manuscript and preserves illustrations.
      </p>
      {!proposed ? (
        <>
          <label>
            Distribution method
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as typeof mode)}
            >
              <option value="manual">
                Manual page breaks (--- on its own line)
              </option>
              <option value="paragraphs">
                Propose pages at paragraph boundaries
              </option>
            </select>
          </label>
          <label>
            Manuscript
            <textarea
              className="import-text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={"Page one text…\n\n---\n\nPage two text…"}
            />
          </label>
          <label className="file-button">
            Read a .txt file
            <input
              type="file"
              accept=".txt,text/plain"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (file) {
                  if (file.size > 1000000) {
                    setError("Choose a text file under 1 MB.");
                    return;
                  }
                  setText(await file.text());
                }
              }}
            />
          </label>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <div className="form-actions">
            <button onClick={onClose}>Cancel</button>
            <button
              className="primary"
              disabled={!text.trim()}
              onClick={() => {
                try {
                  setProposed(
                    distributeManuscript(text, book.pages.length, mode),
                  );
                  setError("");
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              Review {book.pages.length} pages
              <ChevronRight size={17} />
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="distribution-review">
            {proposed.map((copy, i) => (
              <label key={i}>
                Page {i + 1} · {words(copy)} words
                <textarea
                  value={copy}
                  onChange={(e) =>
                    setProposed((p) =>
                      p!.map((s, n) => (n === i ? e.target.value : s)),
                    )
                  }
                />
              </label>
            ))}
          </div>
          <div className="form-actions">
            <button onClick={() => setProposed(null)}>Back</button>
            <button className="primary" onClick={() => onApply(proposed)}>
              Apply manuscript
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
function Versions({
  book,
  actions,
  onClose,
  onRestore,
}: {
  book: Book;
  actions: Actions;
  onClose: () => void;
  onRestore: (b: Book) => void;
}) {
  const [items, setItems] = useState<
      { id: string; createdAt: string; book: Book }[] | null
    >(null),
    [error, setError] = useState("");
  useEffect(() => {
    void api<typeof items>(`books/${book.id}/versions`)
      .then(setItems)
      .catch((e) => setError(e.message));
  }, [book.id]);
  return (
    <Modal title="Draft versions" onClose={onClose}>
      <p className="form-note">
        Save a checkpoint before major edits. Publishing also saves a
        checkpoint. Restoring saves your current draft first.
      </p>
      <button
        onClick={() =>
          void actions
            .run(
              () => api(`books/${book.id}/versions`, "POST"),
              "Draft version saved",
            )
            .then(() =>
              api<typeof items>(`books/${book.id}/versions`).then(setItems),
            )
        }
      >
        <Save size={16} />
        Save current version
      </button>
      {error && <p className="error">{error}</p>}
      <div className="version-list">
        {items === null ? (
          <Spinner />
        ) : items.length ? (
          items.map((v) => (
            <div key={v.id}>
              <div>
                <strong>
                  {date(v.createdAt)} ·{" "}
                  {new Date(v.createdAt).toLocaleTimeString()}
                </strong>
                <span>
                  {v.book.pages.reduce((n, p) => n + words(p.text), 0)} words ·
                  revision {v.book.revision}
                </span>
              </div>
              <button
                onClick={() => {
                  if (
                    window.confirm(
                      "Restore this saved version? Your current draft will be saved as a checkpoint.",
                    )
                  )
                    void actions
                      .run(
                        () =>
                          api<Book>(`books/${book.id}/restore`, "POST", {
                            versionId: v.id,
                          }),
                        "Draft restored",
                      )
                      .then((b) => {
                        if (b) onRestore(b);
                      });
                }}
              >
                Restore
              </button>
            </div>
          ))
        ) : (
          <p className="muted">No saved versions yet.</p>
        )}
      </div>
    </Modal>
  );
}
