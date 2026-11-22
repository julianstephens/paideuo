/* oxlint-disable import/no-commonjs */
const { pkceChallenge } = require("./oauth-pkce.js");

const collection = "paideuo_google_health_connections";
const scopes = [
  "https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly",
  "https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly",
];
const attemptLifetime = 10 * 60;
const now = () => Math.floor(Date.now() / 1000);

const configuration = () => {
  const origin = $os.getenv("PAIDEUO_GOOGLE_HEALTH_ORIGIN");
  const clientId = $os.getenv("PAIDEUO_GOOGLE_HEALTH_CLIENT_ID");
  const clientSecret = $os.getenv("PAIDEUO_GOOGLE_HEALTH_CLIENT_SECRET");
  const key = $os.getenv("PAIDEUO_GOOGLE_HEALTH_ENCRYPTION_KEY");
  if (
    !/^(?:https:\/\/[a-z0-9.-]+|http:\/\/(?:localhost|127\.0\.0\.1))(?::\d+)?$/i.test(origin) ||
    !clientId ||
    !clientSecret ||
    !/^[\x21-\x7e]{32}$/.test(key)
  ) {
    return null;
  }
  return { clientId, clientSecret, key, redirectUri: origin + "/settings" };
};

const requireConfiguration = () => {
  const config = configuration();
  if (!config) throw new BadRequestError("Google Health is unavailable on this server.");
  return config;
};

const forOwner = (app, owner) =>
  app.findRecordsByFilter(collection, "owner = {:owner}", "", 1, 0, { owner })[0];

const form = (fields) =>
  Object.entries(fields)
    .map(([key, value]) => key + "=" + encodeURIComponent(value))
    .join("&");

const status = (event) => {
  event.response.header().set("Cache-Control", "no-store");
  const connection = forOwner(event.app, event.auth.id);
  return event.json(200, {
    available: Boolean(configuration()),
    connected: Boolean(connection?.getString("encrypted_refresh_token")),
  });
};

const start = (event) => {
  event.response.header().set("Cache-Control", "no-store");
  const config = requireConfiguration();
  const state = $security.randomString(48);
  const verifier = $security.randomString(64);

  event.app.runInTransaction((tx) => {
    const connection =
      forOwner(tx, event.auth.id) || new Record(tx.findCollectionByNameOrId(collection));
    if (connection.getString("encrypted_refresh_token")) {
      throw new BadRequestError("Google Health is already connected.");
    }
    connection.set("owner", event.auth.id);
    connection.set("state_hash", $security.sha256(state));
    connection.set("state_expires_at", now() + attemptLifetime);
    connection.set("code_verifier", verifier);
    tx.save(connection);
  });

  const params = form({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: scopes.join(" "),
    state,
    code_challenge: pkceChallenge(verifier),
    code_challenge_method: "S256",
    access_type: "offline",
    prompt: "consent select_account",
  });
  return event.json(200, {
    state,
    authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth?" + params,
  });
};

const send = (request) => {
  try {
    return $http.send({ ...request, timeout: 10 });
  } catch {
    throw new BadRequestError("Unable to reach Google. Try connecting again.");
  }
};

const complete = (event) => {
  event.response.header().set("Cache-Control", "no-store");
  const config = requireConfiguration();
  const { state, code, denied } = event.requestInfo().body;
  if (
    typeof state !== "string" ||
    !/^[a-zA-Z0-9]{48}$/.test(state) ||
    (denied !== true && (typeof code !== "string" || !code || code.length > 4096))
  ) {
    throw new BadRequestError("Google Health returned an invalid authorization response.");
  }

  const stateHash = $security.sha256(state);
  let verifier;
  event.app.runInTransaction((tx) => {
    const connection = forOwner(tx, event.auth.id);
    if (
      !connection ||
      !$security.equal(connection.getString("state_hash"), stateHash) ||
      connection.getInt("state_expires_at") <= now() ||
      !connection.getString("code_verifier")
    ) {
      throw new BadRequestError("This Google Health connection attempt has expired. Try again.");
    }
    verifier = connection.getString("code_verifier");
    connection.set("code_verifier", "");
    tx.save(connection);
  });

  if (denied === true) {
    throw new BadRequestError("Google Health authorization was canceled or declined.");
  }

  const tokenResponse = send({
    url: "https://oauth2.googleapis.com/token",
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form({
      grant_type: "authorization_code",
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      code,
      code_verifier: verifier,
    }),
  });
  const tokens = tokenResponse.json;
  if (
    tokenResponse.statusCode !== 200 ||
    typeof tokens?.access_token !== "string" ||
    !tokens.access_token ||
    typeof tokens.refresh_token !== "string" ||
    !tokens.refresh_token
  ) {
    throw new BadRequestError("Google did not grant offline access to Google Health.");
  }

  const grantedScopes = typeof tokens.scope === "string" ? tokens.scope.split(/\s+/) : [];
  if (!scopes.every((scope) => grantedScopes.includes(scope))) {
    throw new BadRequestError("Allow both requested Google Health permissions, then try again.");
  }

  const identity = send({
    url: "https://health.googleapis.com/v4/users/me/identity",
    headers: { Authorization: "Bearer " + tokens.access_token, Accept: "application/json" },
  });
  const healthUserId = identity.json?.healthUserId;
  if (
    identity.statusCode === 400 &&
    Array.isArray(identity.json?.error?.details) &&
    identity.json.error.details.some((detail) => detail?.reason === "ACCOUNT_NOT_LINKED")
  ) {
    throw new BadRequestError(
      "Set up your profile or migrate your Fitbit account in the Google Health app, then try again.",
    );
  }
  if (
    identity.statusCode !== 200 ||
    typeof healthUserId !== "string" ||
    !/^[A-Za-z0-9-]{1,63}$/.test(healthUserId)
  ) {
    throw new BadRequestError("Unable to verify your Google Health profile. Try connecting again.");
  }

  const encryptedToken = $security.encrypt(tokens.refresh_token, config.key);
  event.app.runInTransaction((tx) => {
    const connection = forOwner(tx, event.auth.id);
    if (
      !connection ||
      !$security.equal(connection.getString("state_hash"), stateHash) ||
      connection.getInt("state_expires_at") <= now()
    ) {
      throw new BadRequestError("This Google Health connection attempt has expired. Try again.");
    }
    connection.set("health_user_id", healthUserId);
    connection.set("encrypted_refresh_token", encryptedToken);
    connection.set("state_hash", "");
    connection.set("state_expires_at", 0);
    tx.save(connection);
  });
  return event.json(200, { connected: true });
};

module.exports = { status, start, complete };
