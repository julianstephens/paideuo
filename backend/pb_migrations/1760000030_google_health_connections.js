migrate(
  (app) => {
    const users = app.findCollectionByNameOrId("paideuo_users");
    app.save(
      new Collection({
        name: "paideuo_google_health_connections",
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
          { type: "text", name: "health_user_id", hidden: true },
          { type: "text", name: "encrypted_refresh_token", hidden: true },
          { type: "text", name: "state_hash", hidden: true },
          { type: "text", name: "code_verifier", hidden: true },
          { type: "number", name: "state_expires_at", onlyInt: true, hidden: true },
        ],
        indexes: [
          "CREATE UNIQUE INDEX idx_google_health_owner ON paideuo_google_health_connections (owner)",
        ],
      }),
    );
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId("paideuo_google_health_connections"));
  },
);
