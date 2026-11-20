routerAdd("POST", "/api/paideuo/v1/mcp", (event) =>
  require(__hooks + "/mcp-tools.js").handle(event),
  $apis.requireAuth("paideuo_users"),
);

routerAdd("POST", "/api/paideuo/v1/service/mcp", (event) =>
  require(__hooks + "/mcp-tools.js").handle(event),
);
