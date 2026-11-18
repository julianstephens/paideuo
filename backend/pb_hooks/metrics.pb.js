routerAdd(
  "GET",
  "/api/paideuo/metrics",
  (event) => require(__hooks + "/metrics.js").report(event),
  $apis.requireAuth("paideuo_users"),
);
