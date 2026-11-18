migrate(
  (app) => {
    const sessions = app.findCollectionByNameOrId("paideuo_scheduled_sessions");
    app.save(
      new Collection({
        type: "base",
        name: "paideuo_session_completions",
        fields: [
          {
            type: "relation",
            name: "session",
            collectionId: sessions.id,
            required: true,
            maxSelect: 1,
            cascadeDelete: true,
          },
          { type: "text", name: "completed_date", required: true, max: 10 },
          { type: "json", name: "actual_duration_min", maxSize: 32 },
          { type: "json", name: "session_rpe", maxSize: 32 },
          { type: "text", name: "notes", max: 10000 },
        ],
        indexes: [
          "CREATE UNIQUE INDEX idx_paideuo_completion_session ON paideuo_session_completions (session)",
        ],
      }),
    );
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId("paideuo_session_completions"));
  },
);
