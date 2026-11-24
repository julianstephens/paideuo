const handleTemplates = (event) => require(__hooks + "/templates.js")(event);

for (const method of ["GET", "POST", "PATCH", "DELETE"]) {
  routerAdd(method, "/api/paideuo/templates", handleTemplates, $apis.requireAuth("paideuo_users"));
  routerAdd(
    method,
    "/api/paideuo/templates/{path...}",
    handleTemplates,
    $apis.requireAuth("paideuo_users"),
  );
}
