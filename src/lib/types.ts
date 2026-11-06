export type Page = {
  id: string;
  text: string;
  assetId: string | null;
  placement: "cover" | "contain";
  bubbleColor: string;
  bubbleOpacity: number;
  textPosition: "top" | "center" | "bottom";
  fontSize: number;
  textColor: string;
};
export type Book = {
  id: string;
  title: string;
  author: string;
  status: "draft" | "review" | "archived";
  width: number;
  height: number;
  margin: number;
  font: string;
  templateId: string | null;
  pages: Page[];
  revision: number;
  createdAt: string;
  updatedAt: string;
};
export type Asset = {
  id: string;
  name: string;
  filename: string;
  mime: string;
  width: number;
  height: number;
  size: number;
  createdAt: string;
};
export type Dataset = Record<string, { type: string }>;
export type Mapping = { image: string; text: string }[];
export type Template = {
  id: string;
  name: string;
  pageCount: number | null;
  dataset: Dataset | null;
  mapping: Mapping;
  checkedAt: string | null;
  error: string | null;
};
export type Preferences = {
  width: number;
  height: number;
  margin: number;
  font: string;
  dpi: number;
  exportFormat: "pdf_print" | "png";
  theme: "light" | "dark";
};
export type Issue = { code: string; message: string; page?: number };
export type Validation = { errors: Issue[]; warnings: Issue[] };
export type RemoteJob = {
  id: string;
  status: "in_progress" | "success" | "failed";
  error?: { code: string; message: string };
  asset?: { id: string };
  result?: {
    type: string;
    design: {
      id: string;
      page_count?: number;
      urls?: { edit_url?: string };
      url?: string;
    };
  };
};
export type PublishJob = {
  id: string;
  bookId: string;
  title: string;
  status: "queued" | "uploading" | "generating" | "success" | "failed";
  message: string;
  progress: number;
  createdAt: string;
  updatedAt: string;
  nextAt: number;
  attempts: number;
  snapshot: { book: Book; template: Template; assets: Asset[]; dpi: number };
  uploaded: Record<string, string>;
  pendingUpload?: { assetId: string; remoteId: string };
  remoteId?: string;
  designId?: string;
  designUrl?: string;
};
export type JobSummary = Omit<
  PublishJob,
  "snapshot" | "uploaded" | "pendingUpload"
>;
export type Workspace = {
  books: Book[];
  assets: Asset[];
  templates: Template[];
  jobs: JobSummary[];
  preferences: Preferences;
  connection: { connected: boolean; configured: boolean; missing: string[] };
  storage: { bytes: number; assets: number };
};
