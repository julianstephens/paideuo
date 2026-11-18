migrate(
  (app) => {
    const entries = app.findCollectionByNameOrId("paideuo_daily_recovery");
    entries.fields.getByName("measurements").required = false;
    entries.fields.add(new JSONField({ name: "nutrition", maxSize: 65536 }));
    app.save(entries);

    const users = app.findCollectionByNameOrId("paideuo_users");
    users.fields.add(new JSONField({ name: "disabled_check_in_fields", maxSize: 4096 }));
    app.save(users);
  },
  (app) => {
    const entries = app.findCollectionByNameOrId("paideuo_daily_recovery");
    app
      .db()
      .newQuery(
        "DELETE FROM paideuo_daily_recovery WHERE measurements IS NULL OR measurements = 'null'",
      )
      .execute();
    entries.fields.removeByName("nutrition");
    entries.fields.getByName("measurements").required = true;
    app.save(entries);

    const users = app.findCollectionByNameOrId("paideuo_users");
    users.fields.removeByName("disabled_check_in_fields");
    app.save(users);
  },
);
