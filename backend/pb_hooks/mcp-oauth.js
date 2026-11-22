/* oxlint-disable import/no-commonjs */
const mcpPath = "/api/paideuo/v1/mcp";
const oauthPath = "/api/paideuo/v1/mcp-oauth";
const metadataPath = "/.well-known/oauth-protected-resource" + mcpPath;
const collectionName = "paideuo_mcp_oauth_grants";
const scope = "paideuo:mcp";
const accessLifetime = 3600;
const refreshLifetime = 30 * 24 * 3600;
const codeLifetime = 5 * 60;

const configuration = () => {
  const origin = $os.getenv("PAIDEUO_MCP_OAUTH_ORIGIN");
  const clientId = $os.getenv("PAIDEUO_MCP_OAUTH_CLIENT_ID");
  const secret = $os.getenv("PAIDEUO_MCP_OAUTH_CLIENT_SECRET");
  const redirect =
    $os.getenv("PAIDEUO_MCP_OAUTH_REDIRECT_URI") ||
    "https://chatgpt.com/connector_platform_oauth_redirect";
  if (
    !/^https:\/\/[a-z0-9.-]+(?::\d+)?$/i.test(origin) ||
    !/^[A-Za-z0-9._~-]{1,128}$/.test(clientId) ||
    !/^[A-Za-z0-9._~-]{32,256}$/.test(secret) ||
    !/^https:\/\/chatgpt\.com\/(?:connector_platform_oauth_redirect|connector\/oauth\/[A-Za-z0-9_-]+)$/.test(
      redirect,
    )
  )
    return null;
  return { origin, clientId, secret, redirect, resource: origin + mcpPath };
};

const requireConfiguration = () => {
  const config = configuration();
  if (!config) throw new NotFoundError("MCP OAuth is disabled.");
  return config;
};

const noStore = (event) => {
  event.response.header().set("Cache-Control", "no-store");
  event.response.header().set("Pragma", "no-cache");
};

const protectedResource = (event) => {
  const config = requireConfiguration();
  return event.json(200, {
    resource: config.resource,
    authorization_servers: [config.origin],
    scopes_supported: [scope],
    bearer_methods_supported: ["header"],
  });
};

const authorizationServer = (event) => {
  const { origin } = requireConfiguration();
  return event.json(200, {
    issuer: origin,
    authorization_response_iss_parameter_supported: true,
    authorization_endpoint: origin + oauthPath + "/authorize",
    token_endpoint: origin + oauthPath + "/token",
    revocation_endpoint: origin + oauthPath + "/revoke",
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["client_secret_basic", "client_secret_post"],
    revocation_endpoint_auth_methods_supported: ["client_secret_basic", "client_secret_post"],
    scopes_supported: [scope],
  });
};

const validResource = (resource, config) => resource === undefined || resource === config.resource;

const validAuthorization = (request, config) =>
  request.client_id === config.clientId &&
  request.redirect_uri === config.redirect &&
  request.response_type === "code" &&
  (request.response_mode === undefined || request.response_mode === "query") &&
  request.code_challenge_method === "S256" &&
  typeof request.code_challenge === "string" &&
  /^[A-Za-z0-9_-]{43}$/.test(request.code_challenge) &&
  (request.scope === undefined || request.scope === "" || request.scope === scope) &&
  validResource(request.resource, config) &&
  (request.state === undefined ||
    (typeof request.state === "string" && request.state.length <= 2048));

const queryString = (values) =>
  Object.entries(values)
    .map(([key, value]) => key + "=" + encodeURIComponent(value))
    .join("&");

const authorize = (event) => {
  const config = requireConfiguration();
  const request = event.requestInfo().query;
  if (!validAuthorization(request, config)) throw new BadRequestError("Invalid OAuth request.");
  noStore(event);
  event.response.header().set("Referrer-Policy", "no-referrer");
  const fields = [
    "client_id",
    "redirect_uri",
    "response_type",
    "code_challenge",
    "code_challenge_method",
    "scope",
    "resource",
    "state",
  ];
  const params = Object.fromEntries(
    fields.filter((name) => request[name] !== undefined).map((name) => [name, request[name]]),
  );
  return event.redirect(302, config.origin + "/mcp/authorize?" + queryString(params));
};

const opaqueToken = (prefix) => prefix + $security.randomString(48);
const now = () => Math.floor(Date.now() / 1000);

const consent = (event) => {
  const config = requireConfiguration();
  const request = event.requestInfo().body;
  if (!validAuthorization(request, config) || typeof request.approved !== "boolean") {
    throw new BadRequestError("Invalid OAuth request.");
  }
  noStore(event);
  const result = { iss: config.origin };
  if (request.state !== undefined) result.state = request.state;
  if (request.approved) {
    const code = opaqueToken("pdc_");
    const grant = new Record(event.app.findCollectionByNameOrId(collectionName));
    grant.set("owner", event.auth.id);
    grant.set("client_id", config.clientId);
    grant.set("resource", config.resource);
    grant.set("redirect_uri", config.redirect);
    grant.set("challenge", request.code_challenge);
    grant.set("exchange_hash", $security.sha256(code));
    grant.set("exchange_expires_at", now() + codeLifetime);
    event.app.save(grant);
    result.code = code;
  } else {
    result.error = "access_denied";
  }
  return event.json(200, { redirect: config.redirect + "?" + queryString(result) });
};

// PocketBase's SHA-256 helper returns hex. PKCE uses unpadded base64url of the digest bytes.
const pkceChallenge = (verifier) => {
  const hex = $security.sha256(verifier);
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  let encoded = "";
  for (let offset = 0; offset < hex.length; offset += 6) {
    const chunk = hex.slice(offset, offset + 6);
    const bits = parseInt(chunk.padEnd(6, "0"), 16);
    encoded += alphabet[(bits >> 18) & 63] + alphabet[(bits >> 12) & 63];
    if (chunk.length >= 4) encoded += alphabet[(bits >> 6) & 63];
    if (chunk.length === 6) encoded += alphabet[bits & 63];
  }
  return encoded;
};

const clientMatches = (event, body, config) => {
  const [user, password, basic] = event.request.basicAuth();
  if (
    basic &&
    (body.client_secret !== undefined || (body.client_id !== undefined && body.client_id !== user))
  )
    return false;
  return (
    (basic ? user : body.client_id) === config.clientId &&
    typeof (basic ? password : body.client_secret) === "string" &&
    $security.equal(basic ? password : body.client_secret, config.secret)
  );
};

const invalidClient = (event) => {
  if (event.request.header.get("Authorization")) {
    event.response.header().set("WWW-Authenticate", 'Basic realm="Paideuo MCP OAuth"');
    return event.json(401, { error: "invalid_client" });
  }
  return event.json(400, { error: "invalid_client" });
};

const findGrant = (app, field, token, config) =>
  app.findRecordsByFilter(
    collectionName,
    field + " = {:hash} && client_id = {:client} && resource = {:resource}",
    "",
    1,
    0,
    { hash: $security.sha256(token), client: config.clientId, resource: config.resource },
  )[0];

const token = (event) => {
  const config = requireConfiguration();
  noStore(event);
  const body = event.requestInfo().body;
  if (!clientMatches(event, body, config)) return invalidClient(event);
  if (!validResource(body.resource, config)) return event.json(400, { error: "invalid_target" });

  const isCode = body.grant_type === "authorization_code";
  if (!isCode && body.grant_type !== "refresh_token") {
    return event.json(400, { error: "unsupported_grant_type" });
  }
  const exchange = isCode ? body.code : body.refresh_token;
  const pattern = isCode ? /^pdc_[A-Za-z0-9]{48}$/ : /^pdr_[A-Za-z0-9]{48}$/;
  if (typeof exchange !== "string" || !pattern.test(exchange)) {
    return event.json(400, { error: "invalid_grant" });
  }
  if (
    isCode &&
    (body.redirect_uri !== config.redirect ||
      typeof body.code_verifier !== "string" ||
      !/^[A-Za-z0-9._~-]{43,128}$/.test(body.code_verifier))
  )
    return event.json(400, { error: "invalid_grant" });
  if (body.scope !== undefined && body.scope !== scope) {
    return event.json(400, { error: "invalid_scope" });
  }

  let result;
  event.app.runInTransaction((tx) => {
    const grant = findGrant(tx, "exchange_hash", exchange, config);
    const timestamp = now();
    if (!grant || grant.getInt("exchange_expires_at") <= timestamp) return;
    if (
      isCode &&
      (grant.getString("redirect_uri") !== body.redirect_uri ||
        !$security.equal(grant.getString("challenge"), pkceChallenge(body.code_verifier)))
    )
      return;

    const access = opaqueToken("pda_");
    const refresh = opaqueToken("pdr_");
    grant.set("redirect_uri", "");
    grant.set("challenge", "");
    grant.set("exchange_hash", $security.sha256(refresh));
    grant.set("exchange_expires_at", timestamp + refreshLifetime);
    grant.set("access_hash", $security.sha256(access));
    grant.set("access_expires_at", timestamp + accessLifetime);
    tx.save(grant);
    result = {
      access_token: access,
      refresh_token: refresh,
      token_type: "Bearer",
      expires_in: accessLifetime,
      scope,
    };
  });

  return result ? event.json(200, result) : event.json(400, { error: "invalid_grant" });
};

const revoke = (event) => {
  const config = requireConfiguration();
  noStore(event);
  const body = event.requestInfo().body;
  if (!clientMatches(event, body, config)) return invalidClient(event);
  const value = body.token;
  if (typeof value !== "string" || !value) return event.json(400, { error: "invalid_request" });
  if (/^pd[ar]_[A-Za-z0-9]{48}$/.test(value)) {
    event.app.runInTransaction((tx) => {
      const field = value.startsWith("pda_") ? "access_hash" : "exchange_hash";
      const grant = findGrant(tx, field, value, config);
      if (grant) tx.delete(grant);
    });
  }
  return event.noContent(200);
};

const mcp = (event) => {
  noStore(event);
  const config = configuration();
  const tools = require("./mcp-tools.js");
  if (event.auth?.collection().name === "paideuo_users") {
    return tools.handle(event, { oauthScope: config ? scope : undefined });
  }
  if (!config) throw new UnauthorizedError("Unauthorized.");

  const bearer = /^Bearer (pda_[A-Za-z0-9]{48})$/i.exec(event.request.header.get("Authorization"));
  const grant = bearer && findGrant(event.app, "access_hash", bearer[1], config);
  if (grant && grant.getInt("access_expires_at") > now()) {
    event.auth = event.app.findRecordById("paideuo_users", grant.getString("owner"));
    return tools.handle(event, { oauthScope: scope });
  }
  event.response
    .header()
    .set(
      "WWW-Authenticate",
      'Bearer resource_metadata="' +
        config.origin +
        metadataPath +
        '", scope="' +
        scope +
        '"' +
        (event.request.header.get("Authorization") ? ', error="invalid_token"' : ""),
    );
  return event.json(401, { error: "unauthorized" });
};

const prune = (app) => {
  app
    .db()
    .newQuery("DELETE FROM paideuo_mcp_oauth_grants WHERE exchange_expires_at <= {:timestamp}")
    .bind({ timestamp: now() })
    .execute();
};

module.exports = {
  authorize,
  authorizationServer,
  consent,
  mcp,
  protectedResource,
  prune,
  revoke,
  token,
};
