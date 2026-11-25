routerAdd(
  "GET",
  "/api/paideuo/metrics",
  (event) => require(__hooks + "/metrics.js").report(event),
  $apis.requireAuth("paideuo_users"),
);

routerAdd(
  "GET",
  "/api/paideuo/v1/metrics",
  (event) => require(__hooks + "/metrics.js").report(event),
  $apis.requireAuth("paideuo_users"),
);

routerAdd("GET", "/api/paideuo/v1/service/metrics", (event) => {
  const credentials = require(__hooks + "/service-credentials.cjs");
  const principal = credentials.servicePrincipalFromEvent(event);
  credentials.ensureScopes(principal, ["metrics:read"]);
  return require(__hooks + "/metrics.js").report(event, {
    owner: principal.ownerId,
    includeFoodNutrition: principal.scopes.has("nutrition:read"),
  });
});
