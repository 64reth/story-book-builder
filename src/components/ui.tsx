"use client";
import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { X, AlertCircle, CheckCircle2, ImageIcon, Loader2 } from "lucide-react";
import type { Asset, Book, Page, Validation } from "@/lib/types";
export async function api<T>(
  url: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const form = body instanceof FormData;
  const response = await fetch(`/api/${url}`, {
    method,
    headers: body && !form ? { "Content-Type": "application/json" } : undefined,
    body: body ? (form ? body : JSON.stringify(body)) : undefined,
    cache: "no-store",
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed.");
  return data;
}
export const formatBytes = (n: number) =>
  n > 1024 * 1024
    ? `${(n / 1024 / 1024).toFixed(1)} MB`
    : `${Math.round(n / 1024)} KB`;
export const date = (value: string) =>
  new Date(value).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
export const words = (s: string) =>
  s.trim() ? s.trim().split(/\s+/).length : 0;
export function Spinner() {
  return <Loader2 size={18} className="spin" aria-label="Loading" />;
}
export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: string;
}) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
export function Empty({
  icon: Icon = ImageIcon,
  title,
  children,
}: {
  icon?: typeof ImageIcon;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      <Icon size={30} strokeWidth={1.3} />
      <h3>{title}</h3>
      {children}
    </div>
  );
}
export function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="modal"
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="modal-head">
        <h2>{title}</h2>
        <button
          className="icon-button"
          onClick={onClose}
          aria-label="Close dialog"
        >
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function Issues({ value }: { value: Validation }) {
  return (
    <div className="issues" aria-live="polite">
      {!value.errors.length && (
        <div className="notice success">
          <CheckCircle2 size={18} />
          <span>No blocking errors. Ready to generate a Canva draft.</span>
        </div>
      )}
      {!!value.errors.length && (
        <h3>
          {value.errors.length} blocking{" "}
          {value.errors.length === 1 ? "error" : "errors"}
        </h3>
      )}
      {value.errors.map((issue, i) => (
        <div className="issue error" key={i}>
          <AlertCircle size={16} />
          <span>{issue.message}</span>
        </div>
      ))}
      {!!value.warnings.length && <h3>Warnings & review notes</h3>}
      {value.warnings.map((issue, i) => (
        <div className="issue warning" key={i}>
          <AlertCircle size={16} />
          <span>{issue.message}</span>
        </div>
      ))}
    </div>
  );
}
export function PagePreview({
  page,
  asset,
  book,
  small = false,
  guides = true,
}: {
  page: Page;
  asset?: Asset;
  book: Pick<Book, "width" | "height" | "margin" | "font">;
  small?: boolean;
  guides?: boolean;
}) {
  return (
    <div
      className={`page-preview ${small ? "small" : ""}`}
      style={
        {
          aspectRatio: `${book.width}/${book.height}`,
          "--page-ratio": book.width / book.height,
          containerType: "inline-size",
        } as CSSProperties
      }
    >
      {asset ? (
        <img
          src={`/api/assets/${asset.id}?v=${asset.filename}`}
          alt={asset.name}
          className="page-art"
          style={{ objectFit: page.placement }}
        />
      ) : (
        <div className="page-placeholder">
          <ImageIcon size={small ? 20 : 40} strokeWidth={1} />
          {!small && <span>Assign an illustration</span>}
        </div>
      )}
      {guides && !small && (
        <div
          className="safe-guide"
          style={{
            inset: `${(book.margin / book.height) * 100}% ${(book.margin / book.width) * 100}%`,
          }}
        />
      )}
      {!!page.text && (
        <div
          className={`text-zone ${page.textPosition}`}
          style={{
            padding: `${(book.margin / book.height) * 100}% ${(book.margin / book.width) * 100}%`,
          }}
        >
          <div
            className="text-bubble"
            style={{
              background: `${page.bubbleColor}${Math.round(
                page.bubbleOpacity * 255,
              )
                .toString(16)
                .padStart(2, "0")}`,
              color: page.textColor,
              fontSize: `${page.fontSize / 6}cqw`,
              fontFamily: `"${book.font}", "Arial Rounded MT Bold", sans-serif`,
            }}
          >
            {page.text}
          </div>
        </div>
      )}
    </div>
  );
}
