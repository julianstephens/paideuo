migrate(
  (app) => {
    const addExternalId = (collection, index) => {
      const fields = collection.fields;
      fields.add(new TextField({ name: "external_id", max: 200 }));
      if (index) collection.indexes.push(index);
      app.save(collection);
    };

    addExternalId(
      app.findCollectionByNameOrId("paideuo_programs"),
      "CREATE UNIQUE INDEX idx_paideuo_program_import_identity ON paideuo_programs (owner, external_id) WHERE external_id != ''",
    );
    addExternalId(
      app.findCollectionByNameOrId("paideuo_blocks"),
      "CREATE UNIQUE INDEX idx_paideuo_block_import_identity ON paideuo_blocks (program, external_id) WHERE external_id != ''",
    );
    addExternalId(
      app.findCollectionByNameOrId("paideuo_program_weeks"),
      "CREATE UNIQUE INDEX idx_paideuo_week_import_identity ON paideuo_program_weeks (block, external_id) WHERE external_id != ''",
    );
    addExternalId(
      app.findCollectionByNameOrId("paideuo_session_slots"),
      "CREATE UNIQUE INDEX idx_paideuo_slot_import_identity ON paideuo_session_slots (block, external_id) WHERE external_id != ''",
    );
    addExternalId(
      app.findCollectionByNameOrId("paideuo_session_prescriptions"),
      "CREATE UNIQUE INDEX idx_paideuo_prescription_import_identity ON paideuo_session_prescriptions (program_week, external_id) WHERE external_id != ''",
    );

    const sessions = app.findCollectionByNameOrId("paideuo_scheduled_sessions");
    const users = app.findCollectionByNameOrId("paideuo_users");
    const resultCollection = new Collection({
      type: "base",
      name: "paideuo_workout_component_results",
      listRule:
        '@request.auth.id != "" && ((session.schedule = "" && session.owner = @request.auth.id) || session.schedule.program.owner = @request.auth.id)',
      viewRule:
        '@request.auth.id != "" && ((session.schedule = "" && session.owner = @request.auth.id) || session.schedule.program.owner = @request.auth.id)',
      fields: [
        {
          type: "relation",
          name: "session",
          collectionId: sessions.id,
          required: true,
          maxSelect: 1,
          cascadeDelete: true,
        },
        { type: "text", name: "component_key", required: true, max: 200 },
        { type: "number", name: "planned_position", required: true, min: 1, onlyInt: true },
        { type: "text", name: "name", required: true, max: 200 },
        { type: "bool", name: "completed", required: true },
        { type: "json", name: "actual_duration_min", maxSize: 32 },
        { type: "json", name: "sets_completed", maxSize: 32 },
        { type: "text", name: "reps_completed", max: 200 },
        { type: "json", name: "actual_load", maxSize: 4096 },
        { type: "json", name: "rpe", maxSize: 32 },
        { type: "text", name: "notes", max: 10000 },
      ],
      indexes: [
        "CREATE UNIQUE INDEX idx_paideuo_result_session_component ON paideuo_workout_component_results (session, component_key)",
      ],
    });
    app.save(resultCollection);

    app.save(
      new Collection({
        type: "base",
        name: "paideuo_heart_rate_recordings",
        listRule: '@request.auth.id != "" && owner = @request.auth.id',
        viewRule: '@request.auth.id != "" && owner = @request.auth.id',
        fields: [
          {
            type: "relation",
            name: "owner",
            collectionId: users.id,
            required: true,
            maxSelect: 1,
            cascadeDelete: true,
          },
          {
            type: "relation",
            name: "session",
            collectionId: sessions.id,
            maxSelect: 1,
            cascadeDelete: true,
          },
          { type: "text", name: "source_workout_key", required: true, max: 200 },
          { type: "text", name: "started_at", required: true, max: 40 },
          { type: "text", name: "ended_at", required: true, max: 40 },
          { type: "text", name: "timezone", required: true, max: 100 },
          { type: "json", name: "device", required: true, maxSize: 4096 },
          { type: "text", name: "provider", max: 200 },
          { type: "text", name: "external_id", max: 200 },
          { type: "json", name: "sample_interval_seconds", maxSize: 32 },
          { type: "json", name: "sample_count", maxSize: 32 },
          {
            type: "select",
            name: "units",
            required: true,
            maxSelect: 1,
            values: ["bpm"],
          },
          { type: "json", name: "algorithm", required: true, maxSize: 4096 },
        ],
        indexes: [
          "CREATE UNIQUE INDEX idx_paideuo_hr_owner_external ON paideuo_heart_rate_recordings (owner, external_id) WHERE external_id != ''",
          "CREATE UNIQUE INDEX idx_paideuo_hr_owner_workout ON paideuo_heart_rate_recordings (owner, source_workout_key) WHERE external_id = ''",
        ],
      }),
    );
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId("paideuo_heart_rate_recordings"));
    app.delete(app.findCollectionByNameOrId("paideuo_workout_component_results"));
    const indexes = new Map([
      ["paideuo_session_prescriptions", "idx_paideuo_prescription_import_identity"],
      ["paideuo_session_slots", "idx_paideuo_slot_import_identity"],
      ["paideuo_program_weeks", "idx_paideuo_week_import_identity"],
      ["paideuo_blocks", "idx_paideuo_block_import_identity"],
      ["paideuo_programs", "idx_paideuo_program_import_identity"],
    ]);
    for (const [name, index] of indexes) {
      const collection = app.findCollectionByNameOrId(name);
      collection.indexes = collection.indexes.filter((value) => !value.includes(index));
      collection.fields.removeByName("external_id");
      app.save(collection);
    }
  },
);
