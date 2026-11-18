migrate(
  (app) => {
    const users = app.findCollectionByNameOrId("paideuo_users");
    users.fields.add(new JSONField({ name: "metric_display_preferences", maxSize: 4096 }));
    app.save(users);
  },
  (app) => {
    const users = app.findCollectionByNameOrId("paideuo_users");
    users.fields.removeByName("metric_display_preferences");
    app.save(users);
  },
);
