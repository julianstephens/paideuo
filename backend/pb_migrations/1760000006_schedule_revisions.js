migrate(
  (app) => {
    const sessions = app.findCollectionByNameOrId("paideuo_scheduled_sessions");
    sessions.fields.add(new TextField({ name: "program_date", required: true, max: 10 }));
    sessions.fields.add(new BoolField({ name: "manually_moved" }));
    sessions.fields.add(new BoolField({ name: "source_removal_acknowledged" }));
    app.save(sessions);
    app
      .db()
      .newQuery("UPDATE paideuo_scheduled_sessions SET program_date = original_date")
      .execute();

    const schedules = app.findCollectionByNameOrId("paideuo_program_schedules");
    app.save(
      new Collection({
        type: "base",
        name: "paideuo_schedule_revision_receipts",
        fields: [
          {
            type: "relation",
            name: "schedule",
            collectionId: schedules.id,
            required: true,
            maxSelect: 1,
          },
          { type: "text", name: "operation_id", required: true, max: 36 },
          { type: "text", name: "request_hash", required: true, max: 64 },
          { type: "number", name: "applied", required: true, min: 1, onlyInt: true },
        ],
        indexes: [
          "CREATE UNIQUE INDEX idx_paideuo_revision_operation ON paideuo_schedule_revision_receipts (schedule, operation_id)",
        ],
      }),
    );
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId("paideuo_schedule_revision_receipts"));
    const sessions = app.findCollectionByNameOrId("paideuo_scheduled_sessions");
    sessions.fields.removeByName("source_removal_acknowledged");
    sessions.fields.removeByName("manually_moved");
    sessions.fields.removeByName("program_date");
    app.save(sessions);
  },
);
