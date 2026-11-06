"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  ArrowUpRight,
  BookOpen,
  Check,
  ChevronRight,
  CircleHelp,
  FolderOpen,
  Images,
  LayoutDashboard,
  LayoutTemplate,
  Moon,
  Plus,
  Rocket,
  Settings2,
  Sun,
  X,
  PanelLeftClose,
} from "lucide-react";
import type { Book, Workspace } from "@/lib/types";
import { loadWorkspace } from "@/lib/workspace-client";
import { api, Badge, date, Empty, Modal, PagePreview, Spinner } from "./ui";
import Editor from "./editor";
import Assets from "./assets-view";
import Templates from "./templates-view";
import Publishing from "./publishing-view";
import Settings from "./settings-view";

export type Actions = {
  refresh: () => Promise<void>;
  notify: (message: string, error?: boolean) => void;
  run: <T>(fn: () => Promise<T>, success?: string) => Promise<T | undefined>;
};
const navigation = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/books", label: "Book Library", icon: BookOpen },
  { href: "/assets", label: "Asset Library", icon: Images },
  { href: "/templates", label: "Templates", icon: LayoutTemplate },
  { href: "/publishing", label: "Publishing", icon: Rocket },
  { href: "/settings", label: "Settings", icon: Settings2 },
];
export default function WorkspaceApp() {
  const pathname = usePathname();
  const [data, setData] = useState<Workspace | null>(null),
    [error, setError] = useState(""),
    [loadAttempt, setLoadAttempt] = useState(0),
    [toast, setToast] = useState<{ message: string; error: boolean } | null>(
      null,
    ),
    [newBook, setNewBook] = useState(false),
    [busy, setBusy] = useState(0),
    [unsaved, setUnsaved] = useState(false),
    [mobileMenu, setMobileMenu] = useState(false);
  const refresh = useCallback(async () => {
    const value = await loadWorkspace();
    setData(value);
    document.documentElement.dataset.theme = value.preferences.theme;
  }, []);
  const notify = useCallback(
    (message: string, error = false) => setToast({ message, error }),
    [],
  );
  const run = useCallback(
    async <T,>(fn: () => Promise<T>, success?: string) => {
      setBusy((n) => n + 1);
      try {
        const result = await fn();
        await refresh();
        if (success) notify(success);
        return result;
      } catch (e) {
        notify(e instanceof Error ? e.message : "Something went wrong.", true);
      } finally {
        setBusy((n) => n - 1);
      }
    },
    [refresh, notify],
  );
  useEffect(() => {
    const controller = new AbortController();
    void loadWorkspace({ signal: controller.signal })
      .then((value) => {
        if (controller.signal.aborted) return;
        setData(value);
        document.documentElement.dataset.theme = value.preferences.theme;
        const params = new URLSearchParams(window.location.search);
        if (params.get("error")) notify(params.get("error")!, true);
        else if (params.has("connected"))
          notify("Canva connected. Inspect your template’s live dataset next.");
      })
      .catch((e: unknown) => {
        if (!controller.signal.aborted)
          setError(
            e instanceof Error && e.message.trim()
              ? e.message
              : "The workspace could not be loaded. Retry loading the workspace.",
          );
      });
    return () => controller.abort();
  }, [notify, loadAttempt]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), toast.error ? 14000 : 6000);
    return () => clearTimeout(timer);
  }, [toast]);
  const editorId = pathname.startsWith("/books/")
    ? pathname.split("/")[2]
    : null;
  const book = data?.books.find((b) => b.id === editorId);
  const section =
    navigation.find((n) => n.href !== "/" && pathname.startsWith(n.href)) ||
    navigation[0];
  const actions: Actions = { refresh, notify, run };
  function guard(e: React.MouseEvent) {
    if (unsaved) {
      e.preventDefault();
      notify(
        "Wait for the editor to save, or retry the failed save before leaving.",
        true,
      );
    } else setMobileMenu(false);
  }
  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileMenu ? "mobile-open" : ""}`}>
        <Link className="brand" href="/" onClick={guard}>
          <span className="brand-icon">
            <BookOpen size={22} />
          </span>
          <span>
            Story Book<span className="brand-sub">Builder</span>
          </span>
        </Link>
        <div className="workspace-label">WORKSPACE</div>
        <nav aria-label="Main navigation">
          {navigation.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={guard}
              className={
                section.href === item.href ? "nav-item active" : "nav-item"
              }
            >
              <item.icon size={19} />
              <span>{item.label}</span>
              {section.href === item.href && <span className="nav-dot" />}
            </Link>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="local-mode">
            <span className="status-dot" />
            Local workspace<Badge>001</Badge>
          </div>
          <div className="owner">
            <span className="avatar">S</span>
            <div>
              <strong>Single owner</strong>
              <span>Stored on this device</span>
            </div>
            <button
              className="icon-button"
              aria-label="Toggle theme"
              onClick={() => {
                if (data)
                  void run(() =>
                    api("settings", "PUT", {
                      ...data.preferences,
                      theme:
                        data.preferences.theme === "light" ? "dark" : "light",
                    }),
                  );
              }}
            >
              {data?.preferences.theme === "dark" ? (
                <Sun size={18} />
              ) : (
                <Moon size={18} />
              )}
            </button>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button menu-toggle"
              aria-label="Toggle navigation"
              onClick={() => setMobileMenu((v) => !v)}
            >
              <PanelLeftClose size={20} />
            </button>
            <span>Workspace</span>
            <ChevronRight size={14} />
            <strong>{editorId ? "Book Editor" : section.label}</strong>
            {book && (
              <>
                <ChevronRight size={14} />
                <span className="crumb-title">{book.title}</span>
              </>
            )}
          </div>
          <div className="topbar-actions">
            {busy > 0 && <Spinner />}
            <Link href="/settings" onClick={guard} className="connection-pill">
              <span
                className={`status-dot ${data?.connection.connected ? "" : "off"}`}
              />
              <span>
                Canva{" "}
                {data?.connection.connected ? "connected" : "not connected"}
              </span>
              <ArrowUpRight size={14} />
            </Link>
            <button
              className="icon-button"
              aria-label="Workspace help"
              onClick={() =>
                notify(
                  "Create a book, import your manuscript, assign illustrations, inspect a matching Canva template, then validate in Publishing.",
                )
              }
            >
              <CircleHelp size={19} />
            </button>
          </div>
        </header>
        <main
          className={editorId ? "main-content editor-content" : "main-content"}
        >
          {error ? (
            <div className="notice error" role="alert">
              <div>
                <strong>Workspace could not be loaded</strong>
                <p>{error}</p>
              </div>
              <button
                onClick={() => {
                  setError("");
                  setLoadAttempt((attempt) => attempt + 1);
                }}
              >
                Retry loading workspace
              </button>
            </div>
          ) : !data ? (
            <div
              className="loading"
              role="status"
              aria-live="polite"
              aria-busy="true"
            >
              <Spinner />
              Opening your workspace…
            </div>
          ) : editorId ? (
            book ? (
              <Editor
                key={book.id}
                book={book}
                data={data}
                actions={actions}
                onUnsaved={setUnsaved}
              />
            ) : (
              <Empty title="Book not found">
                <Link className="button" href="/books">
                  Back to library
                </Link>
              </Empty>
            )
          ) : pathname === "/" ? (
            <Dashboard data={data} onCreate={() => setNewBook(true)} />
          ) : pathname === "/books" ? (
            <Library
              data={data}
              actions={actions}
              onCreate={() => setNewBook(true)}
            />
          ) : pathname === "/assets" ? (
            <Assets data={data} actions={actions} />
          ) : pathname === "/templates" ? (
            <Templates data={data} actions={actions} />
          ) : pathname === "/publishing" ? (
            <Publishing data={data} actions={actions} />
          ) : pathname === "/settings" ? (
            <Settings data={data} actions={actions} />
          ) : (
            <Empty title="Page not found">
              <Link href="/">Return to dashboard</Link>
            </Empty>
          )}
        </main>
        <footer className="footer">
          <span>Story Book Builder</span>
          <span>
            <span className="status-dot" />
            Data stored on this device
          </span>
        </footer>
      </div>
      {toast && (
        <div
          role={toast.error ? "alert" : "status"}
          className={`toast ${toast.error ? "error" : ""}`}
        >
          <span>{toast.message}</span>
          <button
            aria-label="Dismiss notification"
            onClick={() => setToast(null)}
            className="icon-button"
          >
            <X size={18} />
          </button>
        </div>
      )}
      {newBook && (
        <CreateBook onClose={() => setNewBook(false)} actions={actions} />
      )}
    </div>
  );
}
export function PageHeading({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      <div className="heading-actions">{children}</div>
    </div>
  );
}
function Dashboard({
  data,
  onCreate,
}: {
  data: Workspace;
  onCreate: () => void;
}) {
  const active = data.books.filter((b) => b.status !== "archived"),
    pages = active.flatMap((b) => b.pages),
    illustrated = pages.filter((p) => p.assetId).length;
  return (
    <>
      <PageHeading
        eyebrow="YOUR PUBLISHING DESK"
        title="Dashboard"
        description="Your books, artwork and publishing activity."
      >
        <button className="primary" onClick={onCreate}>
          <Plus size={18} />
          Create New Book
        </button>
      </PageHeading>
      <div className="stats-grid">
        {[
          {
            label: "Active books",
            value: String(active.length),
            icon: BookOpen,
            note: "In your library",
          },
          {
            label: "Total pages",
            value: String(pages.length),
            icon: FolderOpen,
            note: "Across active projects",
          },
          {
            label: "Illustrations assigned",
            value: `${illustrated} / ${pages.length}`,
            icon: Images,
            note: pages.length
              ? `${Math.round((illustrated / pages.length) * 100)}% of pages illustrated`
              : "Upload your first illustration",
          },
          {
            label: "Canva drafts",
            value: String(
              data.jobs.filter((j) => j.status === "success").length,
            ),
            icon: Rocket,
            note: data.connection.connected
              ? "Canva is connected"
              : "Connect Canva to publish",
          },
        ].map((s) => (
          <div className="stat-card" key={s.label}>
            <div>
              <span>{s.label}</span>
              <s.icon size={19} />
            </div>
            <strong>{s.value}</strong>
            <p>{s.note}</p>
          </div>
        ))}
      </div>
      <div className="section-head">
        <h2>
          Recent projects <span className="count">{active.length}</span>
        </h2>
        <Link href="/books">
          View library <ChevronRight size={16} />
        </Link>
      </div>
      <div className="book-grid">
        {active.slice(0, 3).map((book) => (
          <BookCard key={book.id} book={book} data={data} />
        ))}
        <button className="new-book-card" onClick={onCreate}>
          <span>
            <Plus size={26} />
          </span>
          <strong>Create a new book</strong>
          <p>Start with a blank manuscript</p>
        </button>
      </div>
      <div className="dashboard-bottom">
        <section className="panel">
          <div className="section-head inset">
            <h2>Publishing activity</h2>
            <Link href="/publishing">
              View all <ChevronRight size={15} />
            </Link>
          </div>
          {data.jobs.length ? (
            <div className="activity-list">
              {data.jobs.slice(0, 4).map((job) => (
                <div className="activity" key={job.id}>
                  <span className="activity-icon">
                    <Rocket size={18} />
                  </span>
                  <div>
                    <strong>{job.title}</strong>
                    <span>{job.message}</span>
                  </div>
                  <Badge tone={job.status === "success" ? "green" : "neutral"}>
                    {job.status}
                  </Badge>
                </div>
              ))}
            </div>
          ) : (
            <Empty icon={Rocket} title="No publishing jobs yet">
              <p>Generated Canva drafts and job progress will appear here.</p>
              <Link href="/publishing" className="text-link">
                Go to Publishing <ChevronRight size={15} />
              </Link>
            </Empty>
          )}
        </section>
        <section className="panel checklist">
          <div className="section-head inset">
            <h2>Workspace setup</h2>
            <Badge tone="green">
              {
                [
                  !!active.length,
                  !!data.assets.length,
                  data.connection.connected,
                  data.templates.some((t) => !!t.checkedAt && !t.error),
                ].filter(Boolean).length
              }{" "}
              / 4
            </Badge>
          </div>
          {[
            {
              done: !!active.length,
              label: "Create your first book",
              href: "/books",
            },
            {
              done: !!data.assets.length,
              label: "Upload your illustrations",
              href: "/assets",
            },
            {
              done: data.connection.connected,
              label: "Connect your Canva account",
              href: "/settings",
            },
            {
              done: data.templates.some((t) => !!t.checkedAt && !t.error),
              label: "Inspect your template dataset",
              href: "/templates",
            },
          ].map((step, i) => (
            <Link key={step.label} href={step.href}>
              <span className={`step-number ${step.done ? "done" : ""}`}>
                {step.done ? <Check size={15} /> : i + 1}
              </span>
              <span>{step.label}</span>
              <ChevronRight size={15} />
            </Link>
          ))}
        </section>
      </div>
    </>
  );
}
export function BookCard({
  book,
  data,
  children,
}: {
  book: Book;
  data: Workspace;
  children?: ReactNode;
}) {
  const complete = book.pages.filter((p) => p.assetId && p.text.trim()).length,
    cover = book.pages.find((p) => p.assetId),
    asset = data.assets.find((a) => a.id === cover?.assetId);
  return (
    <article className="book-card">
      <Link
        href={`/books/${book.id}`}
        className="book-cover"
        aria-label={`Open ${book.title}`}
      >
        {cover && asset ? (
          <PagePreview page={cover} asset={asset} book={book} small />
        ) : (
          <div className="typographic-cover">
            <div className="cover-corner">
              STORY BOOK
              <br />
              {String(book.pages.length).padStart(2, "0")} PAGES
            </div>
            <BookOpen size={32} strokeWidth={1.2} />
            <h3>{book.title}</h3>
            <span>{book.author || "Untitled author"}</span>
          </div>
        )}
        <span className="cover-open">
          Open book <ArrowUpRight size={15} />
        </span>
      </Link>
      <div className="book-details">
        <div className="book-title">
          <Link href={`/books/${book.id}`}>
            <h3>{book.title}</h3>
          </Link>
          <Badge tone={book.status === "review" ? "green" : "neutral"}>
            {book.status}
          </Badge>
        </div>
        <p>
          {book.pages.length} pages <span>·</span> {book.width} × {book.height}{" "}
          in
        </p>
        <div className="completion">
          <span>
            {complete} of {book.pages.length} pages complete
          </span>
          <span>{Math.round((complete / book.pages.length) * 100)}%</span>
        </div>
        <div className="progress-track">
          <span style={{ width: `${(complete / book.pages.length) * 100}%` }} />
        </div>
        <div className="book-meta">
          <span>Edited {date(book.updatedAt)}</span>
          {children}
        </div>
      </div>
    </article>
  );
}
function Library({
  data,
  actions,
  onCreate,
}: {
  data: Workspace;
  actions: Actions;
  onCreate: () => void;
}) {
  const [search, setSearch] = useState(""),
    [filter, setFilter] = useState("active"),
    [edit, setEdit] = useState<Book | null>(null);
  const found = data.books.filter(
    (b) =>
      `${b.title} ${b.author}`.toLowerCase().includes(search.toLowerCase()) &&
      (filter === "all" ||
        (filter === "active" && b.status !== "archived") ||
        b.status === filter),
  );
  return (
    <>
      <PageHeading
        title="Book Library"
        description="Manage manuscripts and illustrated book projects."
      >
        <button className="primary" onClick={onCreate}>
          <Plus size={18} />
          Create New Book
        </button>
      </PageHeading>
      <div className="toolbar">
        <input
          aria-label="Search books"
          type="search"
          placeholder="Search books or authors…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          aria-label="Filter books"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        >
          <option value="active">Active books</option>
          <option value="draft">Drafts</option>
          <option value="review">In review</option>
          <option value="archived">Archived</option>
          <option value="all">All books</option>
        </select>
        <span className="muted">
          {found.length} {found.length === 1 ? "book" : "books"}
        </span>
      </div>
      <div className="book-grid">
        {found.map((book) => (
          <BookCard key={book.id} book={book} data={data}>
            <button className="text-link" onClick={() => setEdit(book)}>
              Manage
            </button>
          </BookCard>
        ))}
      </div>
      {!found.length && (
        <Empty icon={BookOpen} title="No books found">
          <p>Create a book or adjust your search.</p>
        </Empty>
      )}
      {edit && (
        <Modal title="Manage book" onClose={() => setEdit(null)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void actions
                .run(() => api(`books/${edit.id}`, "PUT", edit), "Book updated")
                .then((v) => {
                  if (v) setEdit(null);
                });
            }}
          >
            <label>
              Book title
              <input
                value={edit.title}
                required
                onChange={(e) => setEdit({ ...edit, title: e.target.value })}
              />
            </label>
            <label>
              Author
              <input
                value={edit.author}
                onChange={(e) => setEdit({ ...edit, author: e.target.value })}
              />
            </label>
            <label>
              Status
              <select
                value={edit.status}
                onChange={(e) =>
                  setEdit({ ...edit, status: e.target.value as Book["status"] })
                }
              >
                <option value="draft">Draft</option>
                <option value="review">In review</option>
                <option value="archived">Archived</option>
              </select>
            </label>
            <div className="form-actions">
              <button
                type="button"
                onClick={() =>
                  void actions
                    .run(
                      () => api(`books/${edit.id}/duplicate`, "POST"),
                      "Book duplicated",
                    )
                    .then((v) => {
                      if (v) setEdit(null);
                    })
                }
              >
                Duplicate book
              </button>
              <button className="primary" type="submit">
                Save changes
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
function CreateBook({
  onClose,
  actions,
}: {
  onClose: () => void;
  actions: Actions;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  return (
    <Modal title="Create a new book" onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          setPending(true);
          const result = await actions.run(
            () =>
              api<Book>("books", "POST", {
                title: f.get("title"),
                author: f.get("author"),
                pageCount: Number(f.get("pages")),
              }),
            "Book created",
          );
          setPending(false);
          if (result) {
            onClose();
            router.push(`/books/${result.id}`);
          }
        }}
      >
        <label>
          Book title
          <input
            autoFocus
            required
            name="title"
            maxLength={255}
            placeholder="Enter a title"
          />
        </label>
        <label>
          Author
          <input name="author" maxLength={200} placeholder="Author name" />
        </label>
        <label>
          Page count
          <select name="pages" defaultValue="33">
            {[24, 28, 32, 33].map((n) => (
              <option key={n} value={n}>
                {n} pages
              </option>
            ))}
          </select>
        </label>
        <p className="form-note">
          Choose a page count that matches your Canva template. Every page
          starts blank.
        </p>
        <div className="form-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" disabled={pending}>
            {pending ? <Spinner /> : <Plus size={17} />}Create book
          </button>
        </div>
      </form>
    </Modal>
  );
}
