import { randomUUID } from "node:crypto";
import type { Asset, Book, Template, Workspace } from "../../src/lib/types";
import { defaultMapping } from "../../src/lib/validation";

export function partialFixture() {
  const stamp = new Date().toISOString(),
    mapping = defaultMapping(33);
  const template: Template = {
    id: "fixture-source",
    name: "Partial draft fixture",
    pageCount: 33,
    mapping,
    dataset: Object.fromEntries(
      mapping.flatMap((row) => [
        [row.image, { type: "image" }],
        [row.text, { type: "text" }],
      ]),
    ),
    checkedAt: stamp,
    error: null,
  };
  template.dataset!.PAGE_12_TEXT = { type: "image" };
  const assets: Asset[] = Array.from({ length: 33 }, (_, i) => {
    const dpi = i === 0 ? 101 : i === 32 ? 144 : 117;
    return {
      id: randomUUID(),
      name: `Illustration ${i + 1}`,
      filename: `${randomUUID()}.png`,
      mime: "image/png",
      width: Math.ceil(dpi * 8.625),
      height: Math.ceil(dpi * 8.7),
      size: 1,
      createdAt: stamp,
    };
  });
  const book: Book = {
    id: randomUUID(),
    title: "Partial draft regression",
    author: "",
    status: "draft",
    width: 8.625,
    height: 8.7,
    margin: 0.375,
    font: "Lilita One",
    templateId: template.id,
    revision: 0,
    createdAt: stamp,
    updatedAt: stamp,
    pages: assets.map((asset, i) => ({
      id: randomUUID(),
      text: i < 27 ? `Story copy for page ${i + 1}.` : "",
      assetId: asset.id,
      placement: "cover",
      bubbleColor: "#f6dfcf",
      bubbleOpacity: 0.55,
      textPosition: "bottom",
      fontSize: 30,
      textColor: "#302e36",
    })),
  };
  const workspace: Workspace = {
    books: [book],
    assets,
    templates: [template],
    jobs: [],
    preferences: {
      width: 8.625,
      height: 8.7,
      margin: 0.375,
      font: "Lilita One",
      dpi: 300,
      exportFormat: "pdf_print",
      theme: "light",
    },
    connection: { connected: true, configured: true, missing: [] },
    storage: { bytes: 33, assets: 33 },
  };
  return { book, template, assets, workspace };
}
