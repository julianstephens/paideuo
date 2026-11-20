migrate(
  (app) => {
    const users = app.findCollectionByNameOrId("paideuo_users");
    app.save(
      new Collection({
        type: "base",
        name: "paideuo_import_operations",
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
          { type: "text", name: "operation_id", required: true, max: 200 },
          { type: "text", name: "payload_hash", required: true, max: 64 },
          { type: "text", name: "status", required: true, max: 32 },
          { type: "json", name: "provenance_json", required: true, maxSize: 65536 },
          { type: "json", name: "summary_json", required: true, maxSize: 65536 },
          { type: "json", name: "result_json", required: true, maxSize: 65536 },
        ],
        indexes: [
          "CREATE UNIQUE INDEX idx_paideuo_import_operation_owner ON paideuo_import_operations (owner, operation_id)",
          "CREATE INDEX idx_paideuo_import_operation_hash ON paideuo_import_operations (payload_hash)",
        ],
      }),
    );
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId("paideuo_import_operations"));
  },
);
