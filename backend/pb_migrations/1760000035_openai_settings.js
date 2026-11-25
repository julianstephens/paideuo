migrate(
  (app) => {
    const users = app.findCollectionByNameOrId("paideuo_users");
    app.save(
      new Collection({
        name: "paideuo_openai_settings",
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
          { type: "text", name: "encrypted_api_key", required: true, hidden: true },
          { type: "text", name: "model", required: true, max: 200 },
        ],
        indexes: [
          "CREATE UNIQUE INDEX idx_openai_settings_owner ON paideuo_openai_settings (owner)",
        ],
      }),
    );
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId("paideuo_openai_settings"));
  },
);
