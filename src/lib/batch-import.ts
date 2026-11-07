export function artworkAssignments(names: string[], count: number) {
  const sorted = names
    .map((name, index) => ({ name, index }))
    .sort((a, b) =>
      a.name.localeCompare(b.name, undefined, {
        numeric: true,
        sensitivity: "base",
      }),
    );
  const numberedPages = sorted.map(({ name }) => {
    const m = name.replace(/\.[^.]+$/, "").match(/(?:^|\D)(\d{1,3})(?!.*\d)/);
    return m ? Number(m[1]) - 1 : null;
  });
  const used = new Set<number>(
    numberedPages.filter((p): p is number => p !== null && p >= 0 && p < count),
  );
  return sorted.map(({ name, index }) => {
    const match = name
      .replace(/\.[^.]+$/, "")
      .match(/(?:^|\D)(\d{1,3})(?!.*\d)/);
    const numbered = match ? Number(match[1]) - 1 : null;
    const page =
      numbered !== null
        ? numbered
        : (Array.from({ length: count }, (_, i) => i).find(
            (i) => !used.has(i),
          ) ?? -1);
    const valid =
      page >= 0 &&
      page < count &&
      (numbered === null
        ? !used.has(page)
        : numberedPages.filter((p) => p === page).length === 1);
    if (valid) used.add(page);
    return {
      index,
      name,
      page: valid ? page : null,
      warning: valid
        ? ""
        : numbered !== null
          ? "Page number is duplicated or outside this book"
          : "No unassigned page remains",
    };
  });
}
export function numberedManuscript(
  text: string,
  count: number,
  current: string[],
) {
  const markers = [
    ...text.matchAll(/^\s*(?:#{1,6}\s*)?Page\s+(\d+)\s*[:.\-]?\s*$/gim),
  ];
  if (!markers.length) return null;
  const result = [...current],
    seen = new Set<number>();
  markers.forEach((m, i) => {
    const page = Number(m[1]) - 1;
    if (page < 0 || page >= count || seen.has(page))
      throw new Error(
        "Manuscript page numbers must be unique and within this book.",
      );
    seen.add(page);
    result[page] = text
      .slice(m.index! + m[0].length, markers[i + 1]?.index ?? text.length)
      .trim();
  });
  return result;
}
