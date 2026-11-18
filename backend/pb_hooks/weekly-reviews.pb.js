routerAdd(
  "GET",
  "/api/paideuo/programs/{programId}/weekly-reviews",
  (event) => require(__hooks + "/weekly-reviews.js").list(event),
  $apis.requireAuth("paideuo_users"),
);

for (const method of ["GET", "PUT"]) {
  routerAdd(
    method,
    "/api/paideuo/programs/{programId}/weekly-reviews/{weekId}",
    (event) => require(__hooks + "/weekly-reviews.js").detail(event),
    $apis.requireAuth("paideuo_users"),
  );
}
