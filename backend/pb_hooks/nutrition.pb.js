const { publishedRestOperations } = require(__hooks + "/nutrition-adapters.cjs");

for (const [path, { contract }] of publishedRestOperations) {
  routerAdd(
    contract.method,
    path,
    (event) => {
      const credentials = require(__hooks + "/service-credentials.cjs");
      const { publishedRestOperations } = require(__hooks + "/nutrition-adapters.cjs");
      const principal = credentials.importPrincipalFromEvent(event);
      return event.json(
        200,
        publishedRestOperations
          .get(event.request.url.path)
          .invoke(event.app, principal, event.requestInfo().body),
      );
    },
    $apis.requireAuth("paideuo_users"),
  );
  routerAdd(contract.method, path.replace("/v1/", "/v1/service/"), (event) => {
    const credentials = require(__hooks + "/service-credentials.cjs");
    const { publishedRestOperations } = require(__hooks + "/nutrition-adapters.cjs");
    const principal = credentials.servicePrincipalFromEvent(event);
    const path = event.request.url.path.replace("/v1/service/", "/v1/");
    return event.json(
      200,
      publishedRestOperations.get(path).invoke(event.app, principal, event.requestInfo().body),
    );
  });
}

for (const method of ["GET", "PUT"]) {
  routerAdd(
    method,
    "/api/paideuo/v1/nutrition/food-categories",
    (event) => require(__hooks + "/food-categories.cjs").handle(event),
    $apis.requireAuth("paideuo_users"),
  );
}
