import { apiRequest } from "../../lib/api/request";

export type ServiceCredentialScope =
  | "imports:commit"
  | "programs:read"
  | "programs:write"
  | "workouts:write"
  | "metrics:write"
  | "nutrition:read"
  | "nutrition:write"
  | "nutrition:estimate"
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

const credentialsEndpoint = "/api/paideuo/v1/service-credentials";

export const serviceCredentialsApi = {
  list: (signal?: AbortSignal) =>
    apiRequest<{ credentials: ServiceCredential[]; availableScopes: ServiceCredentialScope[] }>(
      credentialsEndpoint,
      "GET",
      undefined,
      signal,
    ),
  issue: (payload: {
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
  revoke: (id: string) =>
    apiRequest<{ revoked: true; id: string; revokedAt: string }>(
      `${credentialsEndpoint}/${id}/revoke`,
      "POST",
    ),
};
