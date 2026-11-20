const imports = () => require(__hooks + "/imports.js");
const credentials = () => require(__hooks + "/service-credentials.cjs");

routerAdd(
  "POST",
  "/api/paideuo/v1/imports/preview",
  (event) => imports().preview(event),
  $apis.requireAuth("paideuo_users"),
);

routerAdd(
  "POST",
  "/api/paideuo/v1/imports/commit",
  (event) => imports().commit(event),
  $apis.requireAuth("paideuo_users"),
);

routerAdd(
  "POST",
  "/api/paideuo/v1/imports/service/preview",
  (event) => {
    credentials().withServiceCredential(event);
    return imports().preview(event);
  },
);

routerAdd(
  "POST",
  "/api/paideuo/v1/imports/service/commit",
  (event) => {
    credentials().withServiceCredential(event);
    return imports().commit(event);
  },
);

routerAdd(
  "GET",
  "/api/paideuo/v1/service-credentials",
  (event) => credentials().listCredentials(event),
  $apis.requireAuth("paideuo_users"),
);

routerAdd(
  "POST",
  "/api/paideuo/v1/service-credentials/issue",
  (event) => credentials().issueCredential(event),
  $apis.requireAuth("paideuo_users"),
);

routerAdd(
  "POST",
  "/api/paideuo/v1/service-credentials/{id}/revoke",
  (event) => credentials().revokeCredential(event),
  $apis.requireAuth("paideuo_users"),
);
