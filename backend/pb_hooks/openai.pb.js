for (const method of ["GET", "PUT", "DELETE"]) {
  routerAdd(
    method,
    "/api/paideuo/v1/settings/openai",
    (event) => require(__hooks + "/openai.cjs").settings(event),
    $apis.requireAuth("paideuo_users"),
  );
}
