migrate(
  (app) => {
    const relation = (name, collection) => ({
      type: "relation",
      name,
      required: true,
      maxSelect: 1,
      collectionId: collection.id,
    });
    const text = (name, max) => ({ type: "text", name, required: true, max });
    const status = (values) => ({
      type: "select",
      name: "status",
      required: true,
      maxSelect: 1,
      values,
    });
    const programs = app.findCollectionByNameOrId("paideuo_programs");
    const schedules = new Collection({
      type: "base",
      name: "paideuo_program_schedules",
      fields: [
        relation("program", programs),
        text("start_date", 10),
        text("timezone", 100),
        text("source_revision", 64),
        status(["active", "completed"]),
      ],
      indexes: [
        "CREATE UNIQUE INDEX idx_paideuo_schedule_program ON paideuo_program_schedules (program)",
      ],
    });
    app.save(schedules);
    app.save(
      new Collection({
        type: "base",
        name: "paideuo_scheduled_sessions",
        fields: [
          relation("schedule", schedules),
          text("source_prescription_id", 100),
          text("scheduled_date", 10),
          text("original_date", 10),
          { type: "number", name: "slot_position", required: true, min: 1, onlyInt: true },
          {
            type: "json",
            name: "prescription_snapshot",
            required: true,
            maxSize: Number.MAX_SAFE_INTEGER,
          },
          status(["planned", "completed", "skipped"]),
          { type: "autodate", name: "created", onCreate: true },
          { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
        ],
        indexes: [
          "CREATE UNIQUE INDEX idx_paideuo_schedule_source ON paideuo_scheduled_sessions (schedule, source_prescription_id)",
          "CREATE INDEX idx_paideuo_scheduled_date ON paideuo_scheduled_sessions (scheduled_date, slot_position)",
        ],
      }),
    );
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId("paideuo_scheduled_sessions"));
    app.delete(app.findCollectionByNameOrId("paideuo_program_schedules"));
  },
);
