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

export type ServiceCredentialScope =
  | "imports:commit"
  | "programs:read"
  | "programs:write"
  | "workouts:write"
  | "metrics:write"
  | "recordings:write";

export type ServiceCredential = {
  id: string;
  label: string;
  tokenPrefix: string;
  scopes: ServiceCredentialScope[];
  allowHistoryRewrite: boolean;
  expiresAt: string | null;
  revokedAt: string | null;
  lastUsedAt: string | null;
  created: string | null;
  updated: string | null;
};

const endpoint = "/api/paideuo/v1/imports";
const credentialsEndpoint = "/api/paideuo/v1/service-credentials";

export const importsApi = {
  preview: (document: ImportDocumentV1) =>
    apiRequest<ImportPreview>(`${endpoint}/preview`, "POST", document),
  commit: (previewToken: string, document: ImportDocumentV1) =>
    apiRequest<ImportCommit>(`${endpoint}/commit`, "POST", { previewToken, document }),
  listServiceCredentials: () =>
    apiRequest<{ credentials: ServiceCredential[]; availableScopes: ServiceCredentialScope[] }>(
      credentialsEndpoint,
    ),
  issueServiceCredential: (payload: {
    label: string;
    scopes: ServiceCredentialScope[];
    expiresAt?: string | null;
    allowHistoryRewrite?: boolean;
  }) =>
    apiRequest<{ credential: ServiceCredential; plaintextToken: string }>(
      `${credentialsEndpoint}/issue`,
      "POST",
      payload,
    ),
  revokeServiceCredential: (id: string) =>
    apiRequest<{ revoked: true; id: string; revokedAt: string }>(
      `${credentialsEndpoint}/${id}/revoke`,
      "POST",
    ),
};
