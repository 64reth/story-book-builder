"use client";
import { useRef, useState } from "react";
import { artworkAssignments } from "@/lib/batch-import";
import type { Asset, Book } from "@/lib/types";
import { api, Spinner } from "./ui";
export default function BatchArtwork({
  book,
  onApply,
  disabled,
}: {
  book: Book;
  onApply: (assignments: { page: number; assetId: string }[]) => Promise<void>;
  disabled: boolean;
}) {
  const [files, setFiles] = useState<File[]>([]),
    [rows, setRows] = useState<ReturnType<typeof artworkAssignments>>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [progress, setProgress] = useState(0);
  const input = useRef<HTMLInputElement>(null),
    folder = useRef<HTMLInputElement>(null);
  function prepare(list: FileList | File[] | null) {
    const next = Array.from(list ?? []).filter((f) =>
      /^image\/(png|jpeg|webp)$/.test(f.type),
    );
    setFiles(next);
    setRows(
      artworkAssignments(
        next.map((f) => f.name),
        book.pages.length,
      ),
    );
    setError(next.length ? "" : "Choose PNG, JPEG or WebP artwork.");
  }
  return (
    <section className="batch-artwork" aria-label="Batch artwork">
      <div
        className="artwork-drop"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (!disabled && !busy) prepare(e.dataTransfer.files);
        }}
      >
        <div>
          <strong>Drop illustrations here</strong>
          <span>Match page numbers, review assignments, then apply.</span>
        </div>
        <button
          disabled={disabled || busy}
          onClick={() => input.current?.click()}
        >
          Choose images
        </button>
        <button
          disabled={disabled || busy}
          onClick={() => folder.current?.click()}
        >
          Replace from folder
        </button>
        <input
          ref={input}
          aria-label="Batch artwork files"
          hidden
          type="file"
          multiple
          accept="image/png,image/jpeg,image/webp"
          onChange={(e) => prepare(e.target.files)}
        />
        <input
          ref={folder}
          aria-label="Artwork folder"
          hidden
          type="file"
          multiple
          {...{ webkitdirectory: "" }}
          onChange={(e) => prepare(e.target.files)}
        />
      </div>
      {!!rows.length && (
        <div className="assignment-review">
          <strong>Assignment preview · {rows.length} files</strong>
          <div className="assignment-rows">
            {rows.map((r, i) => (
              <label key={r.index}>
                {r.name}
                <select
                  value={r.page ?? ""}
                  disabled={busy}
                  onChange={(e) =>
                    setRows(
                      rows.map((v, n) =>
                        n === i
                          ? {
                              ...v,
                              page:
                                e.target.value === ""
                                  ? null
                                  : Number(e.target.value),
                              warning: "",
                            }
                          : v,
                      ),
                    )
                  }
                >
                  <option value="">Skip</option>
                  {book.pages.map((_, p) => (
                    <option key={p} value={p}>
                      Page {p + 1}
                      {book.pages[p].assetId ? " · replaces artwork" : ""}
                    </option>
                  ))}
                </select>
                {r.warning && <span>{r.warning}</span>}
              </label>
            ))}
          </div>
          <button
            className="primary"
            disabled={disabled || busy || !rows.some((r) => r.page !== null)}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                const selected = rows.filter((r) => r.page !== null);
                if (
                  new Set(selected.map((r) => r.page)).size !== selected.length
                )
                  throw new Error(
                    "Assign each illustration to a different page.",
                  );
                const assignments = [];
                for (const [i, row] of selected.entries()) {
                  const form = new FormData();
                  form.set("file", files[row.index]);
                  const asset = await api<Asset>("assets", "POST", form);
                  assignments.push({ page: row.page!, assetId: asset.id });
                  setProgress(i + 1);
                }
                await onApply(assignments);
                setRows([]);
                setFiles([]);
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? (
              <>
                <Spinner />
                Uploaded {progress}
              </>
            ) : (
              "Apply reviewed artwork"
            )}
          </button>
          <button disabled={busy} onClick={() => setRows([])}>
            Cancel
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </section>
  );
}
