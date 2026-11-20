const serviceScopes = [
  "imports:commit",
  "programs:read",
  "programs:write",
  "workouts:write",
  "metrics:write",
  "recordings:write",
];

const serviceScopeSet = new Set(serviceScopes);

const scopeByImportKind = {
  program: "programs:write",
  "workout-component-results": "workouts:write",
  "daily-check-ins": "metrics:write",
  "heart-rate-recording": "recordings:write",
};

const find = (db, collection, filter, params, sort = "") =>
  db.findRecordsByFilter(collection, filter, sort, 0, 0, params);

const first = (db, collection, filter, params) => find(db, collection, filter, params)[0] ?? null;

const parseScopes = (value) => {
  if (!Array.isArray(value)) return null;
  const normalized = value.map((entry) =>
    typeof entry === "string" ? entry.trim().toLowerCase() : "",
  );
  if (normalized.some((entry) => !serviceScopeSet.has(entry))) return null;
  return [...new Set(normalized)];
};

const isoTimestamp = (value, label, required = false) => {
  if (value == null || value === "") {
    if (required) throw new BadRequestError(`Enter a valid ${label}.`);
    return "";
  }
  if (typeof value !== "string" || value.length > 40 || !Number.isFinite(Date.parse(value))) {
    throw new BadRequestError(`Enter a valid ${label}.`);
  }
  return new Date(value).toISOString();
};

const requireOwner = (event) => {
  if (!event.auth?.id) throw new UnauthorizedError("Unauthorized.");
  return event.auth.id;
};

const listCredentials = (event) => {
  const owner = requireOwner(event);
  const rows = find(
    event.app,
    "paideuo_service_credentials",
    "owner = {:owner}",
    { owner },
    "-created,id",
  );
  const credentials = rows.map((row) => {
    const scopes = JSON.parse(row.getString("scopes_json") || "[]");
    return {
      id: row.id,
      label: row.getString("label"),
      tokenPrefix: row.getString("token_prefix"),
      scopes: Array.isArray(scopes) ? scopes : [],
      allowHistoryRewrite: row.getBool("allow_history_rewrite"),
      expiresAt: row.getString("expires_at") || null,
      revokedAt: row.getString("revoked_at") || null,
      lastUsedAt: row.getString("last_used_at") || null,
      created: row.getString("created") || null,
      updated: row.getString("updated") || null,
    };
  });
  return event.json(200, { credentials, availableScopes: serviceScopes });
};

const issueCredential = (event) => {
  const owner = requireOwner(event);
  const body = event.requestInfo().body;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new BadRequestError("Enter a valid service credential request.");
  }
  const label = (typeof body.label === "string" ? body.label.trim() : "") || "";
  if (!label || label.length > 200) {
    throw new BadRequestError("Enter a valid credential label.");
  }
  const scopes = parseScopes(body.scopes);
  if (!scopes || !scopes.length) {
    throw new BadRequestError("Select at least one valid scope.");
  }
  const expiresAt = isoTimestamp(body.expiresAt, "expiry timestamp");
  if (expiresAt && Date.parse(expiresAt) <= Date.now()) {
    throw new BadRequestError("Expiry timestamp must be in the future.");
  }
  const allowHistoryRewrite = body.allowHistoryRewrite === true;
  const token = `pds_${$security.randomString(48)}`;
  const tokenHash = $security.sha256(token);
  const tokenPrefix = token.slice(0, 16);
  const record = new Record(event.app.findCollectionByNameOrId("paideuo_service_credentials"));
  record.set("owner", owner);
  record.set("label", label);
  record.set("token_hash", tokenHash);
  record.set("token_prefix", tokenPrefix);
  record.set("scopes_json", scopes);
  record.set("allow_history_rewrite", allowHistoryRewrite);
  record.set("expires_at", expiresAt);
  record.set("revoked_at", "");
  record.set("last_used_at", "");
  event.app.save(record);
  return event.json(200, {
    credential: {
      id: record.id,
      label,
      tokenPrefix,
      scopes,
      allowHistoryRewrite,
      expiresAt: expiresAt || null,
      revokedAt: null,
      lastUsedAt: null,
      created: record.getString("created") || null,
      updated: record.getString("updated") || null,
    },
    plaintextToken: token,
  });
};

const revokeCredential = (event) => {
  const owner = requireOwner(event);
  const id = event.request.pathValue("id");
  if (!id) throw new BadRequestError("Enter a valid credential id.");
  const record = first(
    event.app,
    "paideuo_service_credentials",
    "id = {:id} && owner = {:owner}",
    { id, owner },
  );
  if (!record) throw new NotFoundError("Service credential not found.");
  if (!record.getString("revoked_at")) {
    record.set("revoked_at", new Date().toISOString());
    event.app.save(record);
  }
  return event.json(200, { revoked: true, id: record.id, revokedAt: record.getString("revoked_at") });
};

const requiredScopesForImportKind = (kind) => {
  const scope = scopeByImportKind[kind];
  return scope ? ["imports:commit", scope] : ["imports:commit"];
};

const ensureScopes = (principal, requiredScopes) => {
  if (!requiredScopes.length || principal.type === "user") return;
  for (const scope of requiredScopes) {
    if (!principal.scopes.has(scope)) {
      throw new ApiError(403, `Service credential is missing required scope: ${scope}.`);
    }
  }
};

const parseBearerToken = (event) => {
  const header = event.request?.header?.get("Authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match?.[1]?.trim() ?? "";
};

const authenticateServiceCredential = (app, plaintextToken) => {
  if (!plaintextToken || plaintextToken.length < 20) {
    throw new UnauthorizedError("Provide a valid service credential bearer token.");
  }
  const tokenHash = $security.sha256(plaintextToken);
  const record = first(
    app,
    "paideuo_service_credentials",
    "token_hash = {:tokenHash}",
    { tokenHash },
  );
  if (!record) throw new UnauthorizedError("Service credential is invalid.");
  if (record.getString("revoked_at")) {
    throw new UnauthorizedError("Service credential has been revoked.");
  }
  const expiresAt = record.getString("expires_at");
  if (expiresAt && Date.parse(expiresAt) <= Date.now()) {
    throw new UnauthorizedError("Service credential has expired.");
  }
  const scopes = parseScopes(JSON.parse(record.getString("scopes_json") || "[]"));
  if (!scopes || !scopes.length) {
    throw new UnauthorizedError("Service credential scope configuration is invalid.");
  }
  const now = new Date().toISOString();
  record.set("last_used_at", now);
  app.save(record);
  return {
    type: "service",
    ownerId: record.getString("owner"),
    credentialId: record.id,
    credentialRef: `service:${record.id}`,
    scopes: new Set(scopes),
    allowHistoryRewrite: record.getBool("allow_history_rewrite"),
    label: record.getString("label"),
  };
};

const importPrincipalFromEvent = (event) => {
  if (event.importAuth) return event.importAuth;
  const ownerId = event.auth?.id;
  if (!ownerId) throw new UnauthorizedError("Unauthorized.");
  return {
    type: "user",
    ownerId,
    credentialId: null,
    credentialRef: `user:${ownerId}`,
    scopes: new Set(serviceScopes),
    allowHistoryRewrite: false,
    label: "user",
  };
};

const withServiceCredential = (event) => {
  const token = parseBearerToken(event);
  const principal = authenticateServiceCredential(event.app, token);
  event.importAuth = principal;
  return principal;
};

// oxlint-disable-next-line import/no-commonjs
module.exports = {
  importPrincipalFromEvent,
  requiredScopesForImportKind,
  ensureScopes,
  withServiceCredential,
  listCredentials,
  issueCredential,
  revokeCredential,
  serviceScopes,
};
