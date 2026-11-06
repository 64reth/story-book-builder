import type { Asset, Book, Mapping, Template, Validation } from "./types";
export function defaultMapping(count: number): Mapping {
  return Array.from({ length: count }, (_, i) => ({
    image: `PAGE_${String(i + 1).padStart(2, "0")}_IMAGE`,
    text: `PAGE_${String(i + 1).padStart(2, "0")}_TEXT`,
  }));
}
export function validateTemplate(
  template: Template,
  count = template.pageCount ?? template.mapping.length,
): Validation {
  const errors: Validation["errors"] = [],
    warnings: Validation["warnings"] = [];
  if (!template.dataset || !template.checkedAt || template.error)
    errors.push({
      code: "dataset",
      message:
        template.error || "Inspect the live Canva dataset before publishing.",
    });
  if (template.pageCount === null)
    errors.push({
      code: "page_count_unknown",
      message: "Canva has not confirmed the source design page count.",
    });
  else if (template.pageCount !== count)
    errors.push({
      code: "page_count",
      message: `Book has ${count} pages; template has ${template.pageCount}. Select a matching template.`,
    });
  if (template.mapping.length !== count)
    errors.push({
      code: "mapping_count",
      message: `Map exactly ${count} pages.`,
    });
  const used = new Set<string>();
  template.mapping.forEach((row, i) => {
    for (const type of ["image", "text"] as const) {
      const field = row[type];
      if (!field || !template.dataset?.[field])
        errors.push({
          code: "missing_field",
          page: i + 1,
          message: `Page ${i + 1}: ${field || type + " field"} is missing from the dataset.`,
        });
      else if (template.dataset[field].type !== type)
        errors.push({
          code: "field_type",
          page: i + 1,
          message: `${field} accepts ${template.dataset[field].type}, expected ${type}.`,
        });
      if (field && used.has(field))
        errors.push({
          code: "duplicate",
          page: i + 1,
          message: `${field} is mapped more than once.`,
        });
      used.add(field);
    }
  });
  for (const field of Object.keys(template.dataset ?? {}))
    if (!used.has(field))
      errors.push({
        code: "unmapped",
        message: `Dataset field ${field} is unassigned. Map it or use a compatible design.`,
      });
  return { errors, warnings };
}
export function validateBook(
  book: Book,
  template: Template | undefined,
  assets: Asset[],
  connected: boolean,
  dpi: number,
): Validation {
  const result: Validation = { errors: [], warnings: [] };
  if (!connected)
    result.errors.push({
      code: "connection",
      message: "Connect Canva in Settings.",
    });
  if (book.status === "archived")
    result.errors.push({
      code: "archived",
      message: "Restore this archived book before publishing.",
    });
  if (!template)
    result.errors.push({
      code: "template",
      message: "Select a registered Canva template.",
    });
  else
    result.errors.push(...validateTemplate(template, book.pages.length).errors);
  book.pages.forEach((page, index) => {
    const n = index + 1,
      asset = assets.find((a) => a.id === page.assetId);
    if (!page.text.trim())
      result.errors.push({
        code: "text",
        page: n,
        message: `Page ${n}: add manuscript text.`,
      });
    if (!asset)
      result.errors.push({
        code: "image",
        page: n,
        message: `Page ${n}: assign an illustration.`,
      });
    else {
      if (!["image/png", "image/jpeg", "image/webp"].includes(asset.mime))
        result.errors.push({
          code: "format",
          page: n,
          message: `Page ${n}: unsupported image format.`,
        });
      const actual =
        page.placement === "cover"
          ? Math.min(asset.width / book.width, asset.height / book.height)
          : Math.max(asset.width / book.width, asset.height / book.height);
      if (actual < dpi)
        result.errors.push({
          code: "resolution",
          page: n,
          message: `Page ${n}: artwork provides ${Math.floor(actual)} DPI; target is ${dpi}. Upload larger artwork or adjust the target in Settings.`,
        });
    }
    if (page.text.trim().split(/\s+/).length > 65)
      result.warnings.push({
        code: "length",
        page: n,
        message: `Page ${n}: long copy may overflow. Check the text in Canva.`,
      });
  });
  result.warnings.push({
    code: "preview",
    message:
      "Local overlay controls are preview only. Canva’s template controls typography, crop, bubbles and safe margins; inspect the generated draft before print.",
  });
  return result;
}
export function buildAutofill(
  book: Book,
  template: Template,
  uploaded: Record<string, string>,
) {
  const data: Record<
    string,
    { type: "text"; text: string } | { type: "image"; asset_id: string }
  > = {};
  const validation = validateTemplate(template, book.pages.length);
  if (validation.errors.length) throw new Error(validation.errors[0].message);
  book.pages.forEach((page, i) => {
    if (!page.assetId || !uploaded[page.assetId] || !page.text.trim())
      throw new Error(`Page ${i + 1} is incomplete.`);
    data[template.mapping[i].image] = {
      type: "image",
      asset_id: uploaded[page.assetId],
    };
    data[template.mapping[i].text] = { type: "text", text: page.text };
  });
  return {
    type: "create_from_design" as const,
    design_id: template.id,
    title: book.title,
    data,
  };
}
// Paragraph boundaries are preserved. Explicit --- separators give authors full control.
export function distributeManuscript(
  text: string,
  count: number,
  mode: "manual" | "paragraphs",
): string[] {
  const chunks = text.trim()
    ? text
        .trim()
        .split(mode === "manual" ? /\r?\n\s*---\s*\r?\n/ : /\r?\n\s*\r?\n/)
        .map((s) => s.trim())
    : [];
  if (mode === "manual" && chunks.length > count)
    throw new Error(
      `Manuscript has ${chunks.length} pages; this book has ${count}. Nothing was imported.`,
    );
  const pages = Array<string>(count).fill("");
  if (mode === "manual" || chunks.length <= count)
    chunks.forEach((chunk, i) => (pages[i] = chunk));
  else {
    const target =
      chunks.reduce((n, s) => n + s.split(/\s+/).length, 0) / count;
    let index = 0,
      words = 0;
    for (const chunk of chunks) {
      if (index < count - 1 && words >= target && pages[index]) {
        index++;
        words = 0;
      }
      pages[index] += (pages[index] ? "\n\n" : "") + chunk;
      words += chunk.split(/\s+/).length;
    }
  }
  return pages;
}
