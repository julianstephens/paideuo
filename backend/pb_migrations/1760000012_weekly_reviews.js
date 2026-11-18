migrate(
  (app) => {
    const programs = app.findCollectionByNameOrId("paideuo_programs");
    const text = (name, max, required = false) => ({ type: "text", name, max, required });
    app.save(
      new Collection({
        type: "base",
        name: "paideuo_weekly_reviews",
        fields: [
          {
            type: "relation",
            name: "program",
            collectionId: programs.id,
            required: true,
            maxSelect: 1,
            cascadeDelete: true,
          },
          text("source_week", 100, true),
          text("source_block", 100, true),
          text("week_label", 1000, true),
          text("block_label", 1000, true),
          text("start_date", 10),
          text("end_date", 10),
          text("worked", 10000),
          text("did_not_work", 10000),
          text("recovery_observations", 10000),
          text("adjustments", 10000),
          { type: "autodate", name: "created", onCreate: true },
          { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
        ],
        indexes: [
          "CREATE UNIQUE INDEX idx_paideuo_review_week ON paideuo_weekly_reviews (program, source_week)",
        ],
      }),
    );
  },
  (app) => app.delete(app.findCollectionByNameOrId("paideuo_weekly_reviews")),
);
