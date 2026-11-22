routerAdd(
  "GET",
  "/api/paideuo/v1/google-health",
  (event) => require(__hooks + "/google-health.js").status(event),
  $apis.requireAuth("paideuo_users"),
);

routerAdd(
  "POST",
  "/api/paideuo/v1/google-health/start",
  (event) => require(__hooks + "/google-health.js").start(event),
  $apis.requireAuth("paideuo_users"),
);

routerAdd(
  "POST",
  "/api/paideuo/v1/google-health/complete",
  (event) => require(__hooks + "/google-health.js").complete(event),
  $apis.requireAuth("paideuo_users"),
);
