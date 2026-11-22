routerAdd("POST", "/api/paideuo/v1/mcp", (event) => require(__hooks + "/mcp-oauth.js").mcp(event));

routerAdd("GET", "/api/paideuo/v1/mcp", (event) => {
  event.response.header().set("Allow", "POST");
  return event.noContent(405);
});

routerAdd("POST", "/api/paideuo/v1/service/mcp", (event) =>
  require(__hooks + "/mcp-tools.js").handle(event),
);

routerAdd("GET", "/.well-known/oauth-protected-resource/api/paideuo/v1/mcp", (event) =>
  require(__hooks + "/mcp-oauth.js").protectedResource(event),
);

routerAdd("GET", "/.well-known/oauth-authorization-server", (event) =>
  require(__hooks + "/mcp-oauth.js").authorizationServer(event),
);

routerAdd("GET", "/api/paideuo/v1/mcp-oauth/authorize", (event) =>
  require(__hooks + "/mcp-oauth.js").authorize(event),
);

routerAdd(
  "POST",
  "/api/paideuo/v1/mcp-oauth/consent",
  (event) => require(__hooks + "/mcp-oauth.js").consent(event),
  $apis.requireAuth("paideuo_users"),
);

routerAdd("POST", "/api/paideuo/v1/mcp-oauth/token", (event) =>
  require(__hooks + "/mcp-oauth.js").token(event),
);

routerAdd("POST", "/api/paideuo/v1/mcp-oauth/revoke", (event) =>
  require(__hooks + "/mcp-oauth.js").revoke(event),
);

cronAdd("paideuo_mcp_oauth_prune", "17 * * * *", () =>
  require(__hooks + "/mcp-oauth.js").prune($app),
);
