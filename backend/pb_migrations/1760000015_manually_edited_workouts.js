migrate(
  (app) => {
    const sessions = app.findCollectionByNameOrId("paideuo_scheduled_sessions");
    sessions.fields.add(new BoolField({ name: "manually_edited" }));
    app.save(sessions);
  },
  (app) => {
    const sessions = app.findCollectionByNameOrId("paideuo_scheduled_sessions");
    sessions.fields.removeByName("manually_edited");
    app.save(sessions);
  },
);
