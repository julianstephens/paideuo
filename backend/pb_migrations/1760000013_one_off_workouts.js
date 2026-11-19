migrate(
  (app) => {
    const sessions = app.findCollectionByNameOrId("paideuo_scheduled_sessions");
    const users = app.findCollectionByNameOrId("paideuo_users");
    sessions.fields.addMarshaledJSON(
      JSON.stringify({
        type: "relation",
        name: "owner",
        collectionId: users.id,
        maxSelect: 1,
        cascadeDelete: true,
      }),
    );
    sessions.fields.add(new TextField({ name: "timezone", max: 100 }));
    sessions.fields.add(new TextField({ name: "operation_id", max: 36 }));
    sessions.fields.add(new TextField({ name: "request_hash", max: 64 }));
    for (const name of ["schedule", "source_prescription_id", "program_date"]) {
      sessions.fields.getByName(name).required = false;
    }
    sessions.removeIndex("idx_paideuo_schedule_source");
    sessions.addIndex(
      "idx_paideuo_schedule_source",
      true,
      "schedule, source_prescription_id",
      "schedule != ''",
    );
    sessions.addIndex("idx_paideuo_one_off_operation", true, "owner, operation_id", "owner != ''");
    app.save(sessions);
  },
  (app) => {
    const sessions = app.findCollectionByNameOrId("paideuo_scheduled_sessions");
    for (const row of app.findRecordsByFilter(sessions.name, "owner != ''", "", 0, 0)) {
      app.delete(row);
    }
    for (const name of ["owner", "timezone", "operation_id", "request_hash"]) {
      sessions.fields.removeByName(name);
    }
    for (const name of ["schedule", "source_prescription_id", "program_date"]) {
      sessions.fields.getByName(name).required = true;
    }
    sessions.removeIndex("idx_paideuo_one_off_operation");
    sessions.removeIndex("idx_paideuo_schedule_source");
    sessions.addIndex("idx_paideuo_schedule_source", true, "schedule, source_prescription_id", "");
    app.save(sessions);
  },
);
