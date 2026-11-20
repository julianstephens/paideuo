migrate(
  (app) => {
    const users = app.findCollectionByNameOrId("paideuo_users");
    app.save(
      new Collection({
        type: "base",
        name: "paideuo_service_credentials",
        listRule: '@request.auth.id != "" && owner = @request.auth.id',
        viewRule: '@request.auth.id != "" && owner = @request.auth.id',
        createRule: null,
        updateRule: null,
        deleteRule: null,
        fields: [
          {
            type: "relation",
            name: "owner",
            collectionId: users.id,
            required: true,
            maxSelect: 1,
            cascadeDelete: true,
          },
          { type: "text", name: "label", required: true, max: 200 },
          { type: "text", name: "token_hash", required: true, max: 64 },
          { type: "text", name: "token_prefix", required: true, max: 32 },
          { type: "json", name: "scopes_json", required: true, maxSize: 8192 },
          { type: "bool", name: "allow_history_rewrite", required: true },
          { type: "text", name: "expires_at", max: 40 },
          { type: "text", name: "revoked_at", max: 40 },
          { type: "text", name: "last_used_at", max: 40 },
        ],
        indexes: [
          "CREATE UNIQUE INDEX idx_paideuo_service_credential_hash ON paideuo_service_credentials (token_hash)",
          "CREATE INDEX idx_paideuo_service_credential_owner ON paideuo_service_credentials (owner)",
        ],
      }),
    );
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId("paideuo_service_credentials"));
  },
);
