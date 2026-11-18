migrate(
  (app) => {
    const users = app.findCollectionByNameOrId("paideuo_users");
    app.save(
      new Collection({
        type: "base",
        name: "paideuo_daily_recovery",
        fields: [
          {
            type: "relation",
            name: "owner",
            collectionId: users.id,
            required: true,
            maxSelect: 1,
            cascadeDelete: true,
          },
          { type: "text", name: "date", required: true, max: 10 },
          { type: "json", name: "measurements", required: true, maxSize: 65536 },
        ],
        indexes: [
          "CREATE UNIQUE INDEX idx_paideuo_recovery_owner_date ON paideuo_daily_recovery (owner, date)",
        ],
      }),
    );
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId("paideuo_daily_recovery"));
  },
);
