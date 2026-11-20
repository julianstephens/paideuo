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

routerAdd("POST", "/api/paideuo/v1/imports/service/preview", (event) => {
  const principal = require(__hooks + "/service-credentials.cjs").servicePrincipalFromEvent(event);
  return require(__hooks + "/imports.js").preview(event, principal);
});

routerAdd("POST", "/api/paideuo/v1/imports/service/commit", (event) => {
  const principal = require(__hooks + "/service-credentials.cjs").servicePrincipalFromEvent(event);
  return require(__hooks + "/imports.js").commit(event, principal);
});

routerAdd(
  "GET",
  "/api/paideuo/v1/service-credentials",
  (event) => require(__hooks + "/service-credentials.cjs").listCredentials(event),
  $apis.requireAuth("paideuo_users"),
);

routerAdd(
  "POST",
  "/api/paideuo/v1/service-credentials/issue",
  (event) => require(__hooks + "/service-credentials.cjs").issueCredential(event),
  $apis.requireAuth("paideuo_users"),
);

routerAdd(
  "POST",
  "/api/paideuo/v1/service-credentials/{id}/revoke",
  (event) => require(__hooks + "/service-credentials.cjs").revokeCredential(event),
  $apis.requireAuth("paideuo_users"),
);
