migrate(
  (app) => {
    const sessions = app.findCollectionByNameOrId("paideuo_scheduled_sessions");
    sessions.fields.add(new BoolField({ name: "deleted" }));
    app.save(sessions);
  },
  (app) => {
    const sessions = app.findCollectionByNameOrId("paideuo_scheduled_sessions");
    for (const row of app.findRecordsByFilter(sessions.name, "deleted = true", "", 0, 0)) {
      app.delete(row);
    }
    sessions.fields.removeByName("deleted");
    app.save(sessions);
  },
);
