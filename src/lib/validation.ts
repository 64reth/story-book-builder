import type {
  Asset,
  AutofillField,
  Book,
  Issue,
  Mapping,
  SkippedField,
  Template,
  Validation,
} from "./types";

export function defaultMapping(count: number): Mapping {
  return Array.from({ length: count }, (_, i) => ({
    image: `PAGE_${String(i + 1).padStart(2, "0")}_IMAGE`,
    text: `PAGE_${String(i + 1).padStart(2, "0")}_TEXT`,
  }));
}
export function pageRanges(pages: number[]) {
  const sorted = [...new Set(pages)].sort((a, b) => a - b),
    ranges: string[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const start = sorted[i];
    let end = start;
    while (sorted[i + 1] === end + 1) end = sorted[++i];
    ranges.push(start === end ? String(start) : `${start}–${end}`);
  }
  return ranges.join(", ");
}
function fieldUsage(template: Template, count: number) {
  const usage = new Map<string, number>();
  template.mapping.slice(0, count).forEach((row) =>
    [row.image, row.text].forEach((field) => {
      if (field) usage.set(field, (usage.get(field) ?? 0) + 1);
    }),
  );
  return usage;
}
function mappingIssue(
  template: Template,
  index: number,
  kind: "image" | "text",
  usage: Map<string, number>,
): Issue | undefined {
  const page = index + 1,
    field = template.mapping[index]?.[kind] || "";
  if (!field || !template.dataset?.[field])
    return {
      code: "missing_field",
      page,
      message: `Page ${page} ${kind} could not be mapped because ${field || "its field"} is ${field ? "absent from the Canva dataset" : "unassigned"}. Assign a compatible label to include this content automatically.`,
    };
  const actual = template.dataset[field].type;
  if (actual !== kind)
    return {
      code: "field_type",
      page,
      message: `Page ${page} ${kind} could not be mapped because ${field} is ${/^[aeiou]/i.test(actual) ? "an" : "a"} ${actual} field. Correct the label in Canva to include this ${kind === "text" ? "text" : "illustration"} automatically.`,
    };
  if ((usage.get(field) ?? 0) > 1)
    return {
      code: "duplicate",
      page,
      message: `Page ${page} ${kind}: ${field} is mapped more than once. Conflicting mappings are skipped; assign distinct fields to include this content.`,
    };
}
export function validateTemplate(
  template: Template,
  count = template.pageCount ?? template.mapping.length,
): Validation {
  const result: Validation = { errors: [], warnings: [], details: [] };
  if (!template.dataset || !template.checkedAt || template.error) {
    result.errors.push({
      code: "dataset",
      message:
        template.error ||
        "Inspect the live Canva dataset before generating a draft.",
    });
    return result;
  }
  if (template.pageCount === null)
    result.warnings.push({
      code: "page_count_unknown",
      message:
        "Canva has not reported a page count. The draft will retain the source design’s pages.",
    });
  else if (template.pageCount !== count)
    result.warnings.push({
      code: "page_count",
      message: `Book has ${count} pages; the source design has ${template.pageCount}. The new design retains the source pages; unmatched content is skipped, without adding or removing pages.`,
    });
  if (template.mapping.length !== count)
    result.warnings.push({
      code: "mapping_count",
      message: `${template.mapping.length} mapping rows are registered for ${count} book pages. Only compatible mapped fields will be submitted.`,
    });
  const usage = fieldUsage(template, count),
    issues: Issue[] = [];
  for (let i = 0; i < count; i++)
    for (const kind of ["image", "text"] as const) {
      const issue = mappingIssue(template, i, kind, usage);
      if (issue) issues.push(issue);
    }
  result.details!.push(...issues);
  for (const code of ["field_type", "missing_field", "duplicate"]) {
    const group = issues.filter((i) => i.code === code);
    if (group.length)
      result.warnings.push(
        group.length === 1
          ? group[0]
          : {
              code,
              message: `${group.length} page fields ${code === "field_type" ? "have incompatible Canva types" : code === "duplicate" ? "have conflicting duplicate mappings" : "are missing or unassigned"} and will be skipped. See field details to include this content.`,
            },
      );
  }
  const extra = Object.keys(template.dataset).filter(
    (field) => !usage.has(field),
  );
  if (extra.length)
    result.warnings.push({
      code: "unmapped",
      message: `${extra.length} source dataset ${extra.length === 1 ? "field has" : "fields have"} no page mapping and will retain template content.`,
    });
  return result;
}
export function planAutofill(
  book: Book,
  template: Template,
  assets?: Asset[],
  unavailableAssetIds: string[] = [],
) {
  const fields: AutofillField[] = [],
    skipped: SkippedField[] = [],
    usage = fieldUsage(template, book.pages.length);
  book.pages.forEach((page, i) => {
    for (const kind of ["image", "text"] as const) {
      const field = template.mapping[i]?.[kind] || "",
        populated = kind === "text" ? !!page.text.trim() : !!page.assetId;
      const issue = mappingIssue(template, i, kind, usage);
      let reason = issue?.message;
      if (!reason && !populated)
        reason =
          kind === "text"
            ? "No manuscript text; template content is retained."
            : "No illustration assigned; template content is retained.";
      if (!reason && kind === "image") {
        const asset = assets?.find((a) => a.id === page.assetId);
        if (assets && !asset)
          reason =
            "The assigned illustration is unavailable; template content is retained.";
        else if (
          asset &&
          !["image/png", "image/jpeg", "image/webp"].includes(asset.mime)
        )
          reason =
            "The assigned image format is unsupported; template content is retained.";
        else if (unavailableAssetIds.includes(page.assetId!))
          reason =
            "The illustration file is missing or changed on disk; template content is retained. Replace the file to include this artwork.";
      }
      if (reason) skipped.push({ page: i + 1, field, kind, populated, reason });
      else
        fields.push(
          kind === "text"
            ? { page: i + 1, field, kind, text: page.text }
            : { page: i + 1, field, kind, assetId: page.assetId! },
        );
    }
  });
  for (const field of Object.keys(template.dataset ?? {}))
    if (!usage.has(field))
      skipped.push({
        field,
        populated: false,
        reason: "No book-page mapping; source-template content is retained.",
      });
  return { fields, skipped };
}
export function validateBook(
  book: Book,
  template: Template | undefined,
  assets: Asset[],
  connected: boolean,
  dpi: number,
  unavailableAssetIds: string[] = [],
): Validation {
  const result: Validation = {
    errors: [],
    warnings: [],
    details: [],
    skipped: [],
    submission: { textFields: 0, imageFields: 0 },
  };
  if (!connected)
    result.errors.push({
      code: "connection",
      message: "Connect Canva in Settings.",
    });
  if (!template)
    result.errors.push({
      code: "template",
      message: "Select a registered Canva template.",
    });
  else {
    const mapping = validateTemplate(template, book.pages.length);
    result.errors.push(...mapping.errors);
    result.warnings.push(...mapping.warnings);
    result.details!.push(...(mapping.details ?? []));
    const plan = planAutofill(book, template, assets, unavailableAssetIds);
    result.skipped = plan.skipped;
    result.submission = {
      textFields: plan.fields.filter((f) => f.kind === "text").length,
      imageFields: plan.fields.filter((f) => f.kind === "image").length,
    };
    if (!mapping.errors.length && !plan.fields.length)
      result.errors.push({
        code: "no_data",
        message:
          "No supported, populated fields can be submitted. Assign text or artwork to at least one compatible Canva field, then retry.",
      });
    const unavailable = plan.skipped.filter(
      (f) =>
        f.kind === "image" &&
        f.populated &&
        !["field_type", "missing_field", "duplicate"].some((code) =>
          mapping.details?.some(
            (issue) =>
              issue.page === f.page &&
              issue.code === code &&
              issue.message === f.reason,
          ),
        ),
    );
    if (unavailable.length)
      result.warnings.push({
        code: "unavailable_image",
        message: `${unavailable.length} assigned ${unavailable.length === 1 ? "illustration cannot" : "illustrations cannot"} be submitted because the file or format is unavailable. See skipped fields; compatible text and artwork can still be generated.`,
      });
  }
  const blankText: number[] = [],
    blankImages: number[] = [],
    low: { page: number; dpi: number }[] = [],
    long: number[] = [],
    aspect: number[] = [];
  book.pages.forEach((page, i) => {
    const n = i + 1,
      asset = assets.find((a) => a.id === page.assetId);
    if (!page.text.trim()) blankText.push(n);
    if (!page.assetId) blankImages.push(n);
    if (asset) {
      const actual =
        page.placement === "cover"
          ? Math.min(asset.width / book.width, asset.height / book.height)
          : Math.max(asset.width / book.width, asset.height / book.height);
      if (actual < dpi) {
        low.push({ page: n, dpi: Math.floor(actual) });
        result.details!.push({
          code: "resolution",
          page: n,
          message: `Page ${n}: ${Math.floor(actual)} DPI; print target ${dpi} DPI.`,
        });
      }
      if (
        Math.abs(asset.width / asset.height / (book.width / book.height) - 1) >
        0.1
      )
        aspect.push(n);
    }
    if (page.text.trim().split(/\s+/).length > 65) long.push(n);
  });
  if (blankText.length)
    result.warnings.push({
      code: "text",
      message: `${blankText.length} ${blankText.length === 1 ? "page has" : "pages have"} no manuscript text (${pageRanges(blankText)}).`,
    });
  if (blankImages.length)
    result.warnings.push({
      code: "image",
      message: `${blankImages.length} ${blankImages.length === 1 ? "page has" : "pages have"} no illustration (${pageRanges(blankImages)}). Template artwork may remain.`,
    });
  if (low.length) {
    const min = Math.min(...low.map((p) => p.dpi)),
      max = Math.max(...low.map((p) => p.dpi));
    result.warnings.push({
      code: "resolution",
      message: `${low.length} ${low.length === 1 ? "illustration is" : "illustrations are"} below the ${dpi} DPI print target (${min === max ? min : `${min}–${max}`} DPI). Review before final print export.`,
    });
  }
  if (long.length)
    result.warnings.push({
      code: "length",
      message: `${long.length} ${long.length === 1 ? "page has" : "pages have"} long copy that may overflow (${pageRanges(long)}). Review text in Canva.`,
    });
  if (aspect.length)
    result.warnings.push({
      code: "aspect",
      message: `${aspect.length} illustrations have a different aspect ratio from the page (${pageRanges(aspect)}). Review cropping in Canva.`,
    });
  if (book.status === "archived")
    result.warnings.push({
      code: "archived",
      message:
        "This book is archived. The draft uses its currently saved content.",
    });
  result.warnings.push({
    code: "preview",
    message:
      "Local layout controls are preview only. Review the generated copy in Canva; skipped fields retain source-template content, including placeholder text or old artwork.",
  });
  return result;
}
export function buildAutofill(
  book: Book,
  template: Template,
  uploaded: Record<string, string>,
  fields = planAutofill(book, template).fields,
) {
  if (!template.dataset || !template.checkedAt || template.error)
    throw new Error(
      template.error || "Inspect the live Canva dataset before generating.",
    );
  const data: Record<
    string,
    { type: "text"; text: string } | { type: "image"; asset_id: string }
  > = Object.create(null);
  for (const field of fields) {
    // A persisted plan is checked again at construction; never coerce a field type.
    if (
      template.dataset[field.field]?.type !== field.kind ||
      Object.hasOwn(data, field.field)
    )
      throw new Error(
        `The submission plan for ${field.field} is incompatible. Validate again.`,
      );
    if (field.kind === "text") {
      if (field.text.trim())
        data[field.field] = { type: "text", text: field.text };
    } else {
      if (!uploaded[field.assetId])
        throw new Error(
          `Canva has not confirmed the illustration upload for ${field.field}. Retry the upload before generating.`,
        );
      data[field.field] = { type: "image", asset_id: uploaded[field.assetId] };
    }
  }
  if (!Object.keys(data).length)
    throw new Error(
      "No supported, populated Autofill fields are available. Add compatible content and validate again.",
    );
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
