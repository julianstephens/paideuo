migrate(
  (app) => {
    const users = app.findCollectionByNameOrId("paideuo_users");
    app.save(
      new Collection({
        name: "paideuo_mcp_oauth_grants",
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
          { type: "text", name: "client_id", required: true },
          { type: "text", name: "resource", required: true },
          { type: "text", name: "redirect_uri" },
          { type: "text", name: "challenge" },
          { type: "text", name: "exchange_hash", required: true },
          { type: "text", name: "access_hash" },
          { type: "number", name: "exchange_expires_at", required: true, onlyInt: true },
          { type: "number", name: "access_expires_at", onlyInt: true },
        ],
        indexes: [
          "CREATE UNIQUE INDEX idx_mcp_oauth_exchange ON paideuo_mcp_oauth_grants (exchange_hash)",
          "CREATE UNIQUE INDEX idx_mcp_oauth_access ON paideuo_mcp_oauth_grants (access_hash) WHERE access_hash != ''",
          "CREATE INDEX idx_mcp_oauth_expiry ON paideuo_mcp_oauth_grants (exchange_expires_at)",
        ],
      }),
    );
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId("paideuo_mcp_oauth_grants"));
  },
);
