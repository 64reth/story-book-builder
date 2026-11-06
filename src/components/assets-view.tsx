"use client";
import { useRef, useState } from "react";
import {
  ImagePlus,
  Pencil,
  RefreshCw,
  Search,
  Trash2,
  Upload,
} from "lucide-react";
import type { Asset, Book, Workspace } from "@/lib/types";
import { api, Badge, Empty, formatBytes, Modal, Spinner } from "./ui";
import { PageHeading, type Actions } from "./workspace";
export default function Assets({
  data,
  actions,
}: {
  data: Workspace;
  actions: Actions;
}) {
  const [search, setSearch] = useState(""),
    [dragging, setDragging] = useState(false),
    [uploading, setUploading] = useState(false),
    [progress, setProgress] = useState(""),
    [selected, setSelected] = useState<Asset | null>(null),
    [assignBook, setAssignBook] = useState(""),
    [assignPage, setAssignPage] = useState(0),
    [name, setName] = useState("");
  const input = useRef<HTMLInputElement>(null),
    replacement = useRef<HTMLInputElement>(null);
  const found = data.assets.filter((a) =>
    a.name.toLowerCase().includes(search.toLowerCase()),
  );
  async function uploadFiles(files: FileList | File[], replaceId?: string) {
    setUploading(true);
    let succeeded = 0;
    for (const [index, file] of Array.from(files).entries()) {
      setProgress(`Uploading ${index + 1} of ${files.length}: ${file.name}`);
      try {
        const form = new FormData();
        form.set("file", file);
        const asset = await api<Asset>(
          replaceId ? `assets/${replaceId}` : "assets",
          replaceId ? "PUT" : "POST",
          form,
        );
        succeeded++;
        if (replaceId) setSelected(asset);
      } catch (e) {
        actions.notify(`${file.name}: ${(e as Error).message}`, true);
      }
    }
    await actions.refresh();
    setUploading(false);
    setProgress("");
    if (succeeded)
      actions.notify(
        `${succeeded} ${succeeded === 1 ? "illustration" : "illustrations"} ${replaceId ? "replaced" : "uploaded"}.`,
      );
    if (input.current) input.current.value = "";
    if (replacement.current) replacement.current.value = "";
  }
  return (
    <>
      <PageHeading
        title="Asset Library"
        description="Upload and organise your book illustrations."
      >
        <button
          className="primary"
          disabled={uploading}
          onClick={() => input.current?.click()}
        >
          {uploading ? <Spinner /> : <Upload size={18} />}Upload illustrations
        </button>
      </PageHeading>
      <input
        ref={input}
        className="sr-only"
        type="file"
        multiple
        accept="image/png,image/jpeg,image/webp"
        aria-label="Upload illustrations"
        onChange={(e) => {
          if (e.target.files) void uploadFiles(e.target.files);
        }}
      />
      <div
        className={`upload-drop ${dragging ? "dragging" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (!uploading) void uploadFiles(e.dataTransfer.files);
        }}
      >
        <span className="upload-icon">
          <ImagePlus size={26} />
        </span>
        <div>
          <h2>{uploading ? progress : "Drop your illustrations here"}</h2>
          <p>
            PNG, JPEG or WebP · Up to 25 MB per image · Multiple files supported
          </p>
        </div>
        <button disabled={uploading} onClick={() => input.current?.click()}>
          Browse files
        </button>
      </div>
      <div className="toolbar">
        <div className="search-field">
          <Search size={17} />
          <input
            type="search"
            aria-label="Search illustrations"
            placeholder="Search illustrations…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <span className="muted">
          {found.length} illustrations ·{" "}
          {formatBytes(data.assets.reduce((n, a) => n + a.size, 0))}
        </span>
      </div>
      <div className="asset-grid">
        {found.map((asset) => {
          const references = data.books.filter((b) =>
            b.pages.some((p) => p.assetId === asset.id),
          ).length;
          return (
            <button
              className="asset-card"
              key={asset.id}
              onClick={() => {
                setSelected(asset);
                setName(asset.name);
              }}
            >
              <div className="asset-image">
                <img
                  src={`/api/assets/${asset.id}?v=${asset.filename}`}
                  alt={asset.name}
                />
                {!!references && (
                  <Badge tone="green">
                    In {references} {references === 1 ? "book" : "books"}
                  </Badge>
                )}
              </div>
              <div>
                <h3>{asset.name}</h3>
                <p>
                  {asset.width} × {asset.height} px
                </p>
                <span>
                  {asset.mime.split("/")[1].toUpperCase()} <span>·</span>{" "}
                  {formatBytes(asset.size)}
                </span>
              </div>
            </button>
          );
        })}
      </div>
      {!found.length && (
        <Empty
          title={
            search
              ? "No matching illustrations"
              : "Your illustration library is empty"
          }
        >
          <p>Upload artwork to start illustrating your pages.</p>
        </Empty>
      )}
      {selected && (
        <Modal title="Illustration details" onClose={() => setSelected(null)}>
          <div className="asset-detail-image">
            <img
              src={`/api/assets/${selected.id}?v=${selected.filename}`}
              alt={selected.name}
            />
          </div>
          <p className="form-note">
            {selected.width} × {selected.height} px · {selected.mime} ·{" "}
            {formatBytes(selected.size)}
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void actions
                .run(
                  () => api<Asset>(`assets/${selected.id}`, "PATCH", { name }),
                  "Illustration renamed",
                )
                .then((a) => {
                  if (a) setSelected(a);
                });
            }}
          >
            <label>
              Illustration name
              <input
                value={name}
                required
                maxLength={150}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <button type="submit">
              <Pencil size={16} />
              Save name
            </button>
          </form>
          <hr />
          <h3>Assign to a page</h3>
          <div className="field-row">
            <label>
              Book
              <select
                value={assignBook}
                onChange={(e) => {
                  setAssignBook(e.target.value);
                  setAssignPage(0);
                }}
              >
                <option value="">Select book</option>
                {data.books
                  .filter((b) => b.status !== "archived")
                  .map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.title}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Page
              <select
                value={assignPage}
                disabled={!assignBook}
                onChange={(e) => setAssignPage(Number(e.target.value))}
              >
                {data.books
                  .find((b) => b.id === assignBook)
                  ?.pages.map((_, i) => (
                    <option key={i} value={i}>
                      Page {i + 1}
                    </option>
                  ))}
              </select>
            </label>
          </div>
          <button
            disabled={!assignBook}
            onClick={() => {
              const book = data.books.find((b) => b.id === assignBook);
              if (book)
                void actions.run(
                  () =>
                    api<Book>(`books/${book.id}`, "PUT", {
                      ...book,
                      pages: book.pages.map((p, i) =>
                        i === assignPage ? { ...p, assetId: selected.id } : p,
                      ),
                    }),
                  `Assigned to page ${assignPage + 1}`,
                );
            }}
          >
            Assign illustration
          </button>
          <hr />
          <div className="form-actions">
            <button
              disabled={uploading}
              onClick={() => replacement.current?.click()}
            >
              <RefreshCw size={16} />
              Replace image
            </button>
            <button
              className="danger"
              onClick={() => {
                if (
                  window.confirm(
                    "Remove this unused illustration permanently? Assets referenced by books, versions or publishing history are protected.",
                  )
                )
                  void actions
                    .run(
                      () => api(`assets/${selected.id}`, "DELETE"),
                      "Illustration removed",
                    )
                    .then((v) => {
                      if (v) setSelected(null);
                    });
              }}
            >
              <Trash2 size={16} />
              Remove
            </button>
          </div>
          <p className="form-note">
            Replacement updates this illustration wherever it is assigned.
            Publishing snapshots retain the original file.
          </p>
          <input
            className="sr-only"
            ref={replacement}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            aria-label="Replacement image"
            onChange={(e) => {
              if (e.target.files) void uploadFiles(e.target.files, selected.id);
            }}
          />
        </Modal>
      )}
    </>
  );
}
