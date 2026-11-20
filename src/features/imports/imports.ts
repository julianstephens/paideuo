import { apiRequest } from "../../lib/api/request";

export type ImportKind =
  | "program"
  | "workout-component-results"
  | "daily-check-ins"
  | "heart-rate-recording";

export type ImportDocumentV1<T = Record<string, unknown>> = {
  schema: "paideuo";
  version: 1;
  kind: ImportKind;
  data: T;
};

export type ImportItem = {
  type: string;
  key: string;
  id: string | null;
  status: "create" | "update" | "skip" | "conflict";
  error?: string;
};

export type ImportPreview = {
  previewToken: string;
  schema: "paideuo";
  version: 1;
  kind: ImportKind;
  items: ImportItem[];
  conflicting: number;
};

export type ImportCommit = {
  committed: true;
  rows:
    | { programId: string; scheduleSynchronization: "review-required" | null }
    | { key: string; status: string }[];
};

const endpoint = "/api/paideuo/v1/imports";

export const importsApi = {
  preview: (document: ImportDocumentV1) =>
    apiRequest<ImportPreview>(`${endpoint}/preview`, "POST", document),
  commit: (previewToken: string, document: ImportDocumentV1) =>
    apiRequest<ImportCommit>(`${endpoint}/commit`, "POST", { previewToken, document }),
};
