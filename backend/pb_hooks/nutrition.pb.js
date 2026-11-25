const { publishedRestOperations } = require(__hooks + "/nutrition-adapters.cjs");

for (const [path, { contract }] of publishedRestOperations) {
  routerAdd(
    contract.method,
    path,
    (event) => {
      const credentials = require(__hooks + "/service-credentials.cjs");
      const { publishedRestOperations } = require(__hooks + "/nutrition-adapters.cjs");
      const principal = credentials.importPrincipalFromEvent(event);
      let input = event.requestInfo().body;
      if (event.request.url.path.endsWith("/predict-macros")) {
        event.response.header().set("Cache-Control", "no-store");
        input = require(__hooks + "/openai.cjs").foodInput(input);
      }
      return event.json(
        200,
        publishedRestOperations.get(event.request.url.path).invoke(event.app, principal, input),
      );
    },
    $apis.requireAuth("paideuo_users"),
  );
  routerAdd(contract.method, path.replace("/v1/", "/v1/service/"), (event) => {
    const credentials = require(__hooks + "/service-credentials.cjs");
    const { publishedRestOperations } = require(__hooks + "/nutrition-adapters.cjs");
    const principal = credentials.servicePrincipalFromEvent(event);
    const path = event.request.url.path.replace("/v1/service/", "/v1/");
    if (path.endsWith("/predict-macros")) event.response.header().set("Cache-Control", "no-store");
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
    (event) => {
      const credentials = require(__hooks + "/service-credentials.cjs");
      const { execute } = require(__hooks + "/nutrition.cjs");
      const principal = credentials.importPrincipalFromEvent(event);
      if (event.request.method === "GET")
        return event.json(200, execute(event.app, principal, "categories.list", {}));
      const { action, operationId, name, newName } = event.requestInfo().body;
      if (!["add", "rename", "remove"].includes(action))
        throw new BadRequestError("Unknown category action.");
      const input = { operationId: operationId ?? $security.randomString(32) };
      if (action !== "add") input.name = typeof name === "string" ? name.trim() : name;
      if (action !== "remove")
        input.newName = typeof newName === "string" ? newName.trim() : newName;
      return event.json(200, execute(event.app, principal, "categories." + action, input));
    },
    $apis.requireAuth("paideuo_users"),
  );
}

cronAdd("paideuo_nutrition_rate_limit_cleanup", "*/5 * * * *", () => {
  require(__hooks + "/nutrition-rate-limit.cjs").prune($app);
});
