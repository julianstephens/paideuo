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

// Stable, domain-specific HTTP entry points.  These routes intentionally reuse the import
// normalizer and commit services rather than exposing PocketBase collection writes.
routerAdd("POST", "/api/paideuo/v1/programs", (event) =>
  require(__hooks + "/imports.js").domainBatch(event, "program"),
);
routerAdd("POST", "/api/paideuo/v1/programs/create", (event) =>
  require(__hooks + "/imports.js").domainBatch(event, "program"),
);
routerAdd("POST", "/api/paideuo/v1/workouts/results/batch", (event) =>
  require(__hooks + "/imports.js").domainBatch(event, "workout-component-results"),
);
routerAdd("POST", "/api/paideuo/v1/workout-results/batch", (event) =>
  require(__hooks + "/imports.js").domainBatch(event, "workout-component-results"),
);
routerAdd("POST", "/api/paideuo/v1/check-ins/upsert", (event) =>
  require(__hooks + "/imports.js").domainBatch(event, "daily-check-ins"),
);
routerAdd("POST", "/api/paideuo/v1/check-ins", (event) =>
  require(__hooks + "/imports.js").domainBatch(event, "daily-check-ins"),
);
routerAdd("POST", "/api/paideuo/v1/heart-rate/recordings/attach", (event) =>
  require(__hooks + "/imports.js").domainBatch(event, "heart-rate-recording"),
);
routerAdd("POST", "/api/paideuo/v1/heart-rate/recordings", (event) =>
  require(__hooks + "/imports.js").domainBatch(event, "heart-rate-recording"),
);

routerAdd("POST", "/api/paideuo/v1/service/programs", (event) => {
  const principal = require(__hooks + "/service-credentials.cjs").servicePrincipalFromEvent(event);
  return require(__hooks + "/imports.js").domainBatch(event, "program", principal);
});
routerAdd("POST", "/api/paideuo/v1/service/workouts/results/batch", (event) => {
  const principal = require(__hooks + "/service-credentials.cjs").servicePrincipalFromEvent(event);
  return require(__hooks + "/imports.js").domainBatch(
    event,
    "workout-component-results",
    principal,
  );
});
routerAdd("POST", "/api/paideuo/v1/service/check-ins/upsert", (event) => {
  const principal = require(__hooks + "/service-credentials.cjs").servicePrincipalFromEvent(event);
  return require(__hooks + "/imports.js").domainBatch(event, "daily-check-ins", principal);
});
routerAdd("POST", "/api/paideuo/v1/service/heart-rate/recordings/attach", (event) => {
  const principal = require(__hooks + "/service-credentials.cjs").servicePrincipalFromEvent(event);
  return require(__hooks + "/imports.js").domainBatch(event, "heart-rate-recording", principal);
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
