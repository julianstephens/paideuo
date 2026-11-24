const handlePrograms = (event) => require(__hooks + "/programs.js")(event);

for (const method of ["GET", "POST", "PATCH", "DELETE"]) {
  routerAdd(method, "/api/paideuo/programs", handlePrograms, $apis.requireAuth("paideuo_users"));
  routerAdd(
    method,
    "/api/paideuo/programs/{path...}",
    handlePrograms,
    $apis.requireAuth("paideuo_users"),
  );
}

routerAdd(
  "DELETE",
  "/api/paideuo/programs/{path}",
  handlePrograms,
  $apis.requireAuth("paideuo_users"),
);
