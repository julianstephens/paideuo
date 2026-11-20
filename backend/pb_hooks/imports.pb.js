routerAdd(
  "POST",
  "/api/paideuo/v1/imports/preview",
  (event) => require(__hooks + "/imports.js").preview(event),
  $apis.requireAuth("paideuo_users"),
);

routerAdd(
  "POST",
  "/api/paideuo/v1/imports/commit",
  (event) => require(__hooks + "/imports.js").commit(event),
  $apis.requireAuth("paideuo_users"),
);
