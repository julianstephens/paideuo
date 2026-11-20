migrate(
  (app) => {
    const credentials = app.findCollectionByNameOrId("paideuo_service_credentials");
    credentials.fields.add(new AutodateField({ name: "created", onCreate: true }));
    credentials.fields.add(new AutodateField({ name: "updated", onCreate: true, onUpdate: true }));
    credentials.fields.getByName("allow_history_rewrite").required = false;
    app.save(credentials);
  },
  (app) => {
    const credentials = app.findCollectionByNameOrId("paideuo_service_credentials");
    credentials.fields.removeByName("created");
    credentials.fields.removeByName("updated");
    credentials.fields.getByName("allow_history_rewrite").required = true;
    app.save(credentials);
  },
);
