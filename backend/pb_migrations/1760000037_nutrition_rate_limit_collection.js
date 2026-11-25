migrate(
  (app) => {
    const table = "paideuo_nutrition_rate_limits";
    if (app.findAllCollections("base").some((collection) => collection.name === table)) return;

    // Earlier builds of migration 36 created a raw SQLite table.
    const hasLegacyCounters = app.hasTable(table);
    if (hasLegacyCounters) {
      app.db().newQuery(`ALTER TABLE ${table} RENAME TO ${table}_legacy`).execute();
    }

    const users = app.findCollectionByNameOrId("paideuo_users");
    app.save(
      new Collection({
        name: table,
        type: "base",
        fields: [
          {
            type: "relation",
            name: "owner",
            collectionId: users.id,
            required: true,
            maxSelect: 1,
            cascadeDelete: true,
          },
          ...["bucket", "requests", "estimates"].map((name) => ({
            type: "number",
            name,
            onlyInt: true,
          })),
        ],
        indexes: [
          "CREATE UNIQUE INDEX idx_nutrition_rate_owner_bucket ON paideuo_nutrition_rate_limits (owner, bucket)",
        ],
      }),
    );

    if (hasLegacyCounters) {
      app
        .db()
        .newQuery(`INSERT INTO ${table} (id, owner, bucket, requests, estimates)
          SELECT substr(lower(hex(randomblob(8))), 1, 15), owner, bucket, requests, estimates
          FROM ${table}_legacy`)
        .execute();
      app.db().newQuery(`DROP TABLE ${table}_legacy`).execute();
    }
  },
  (app) => app.delete(app.findCollectionByNameOrId("paideuo_nutrition_rate_limits")),
);
