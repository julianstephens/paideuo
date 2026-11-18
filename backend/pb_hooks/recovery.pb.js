routerAdd(
  "GET",
  "/api/paideuo/recovery",
  (event) => require(__hooks + "/daily-check-ins.js").list(event, true),
  $apis.requireAuth("paideuo_users"),
);

routerAdd(
  "GET",
  "/api/paideuo/check-ins",
  (event) => require(__hooks + "/daily-check-ins.js").list(event, false),
  $apis.requireAuth("paideuo_users"),
);

for (const method of ["PUT", "DELETE"]) {
  routerAdd(
    method,
    "/api/paideuo/recovery/{date}",
    (event) => require(__hooks + "/daily-check-ins.js").write(event, true),
    $apis.requireAuth("paideuo_users"),
  );
  routerAdd(
    method,
    "/api/paideuo/check-ins/{date}",
    (event) => require(__hooks + "/daily-check-ins.js").write(event, false),
    $apis.requireAuth("paideuo_users"),
  );
}

for (const method of ["GET", "PUT"]) {
  routerAdd(
    method,
    "/api/paideuo/check-in-preferences",
    (event) => require(__hooks + "/daily-check-ins.js").preferences(event),
    $apis.requireAuth("paideuo_users"),
  );
}
