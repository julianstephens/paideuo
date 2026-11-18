migrate(
  (app) => {
    const users = app.findCollectionByNameOrId("paideuo_users");
    const ownerRule = '@request.auth.id != "" && owner = @request.auth.id';
    app.save(
      new Collection({
        type: "base",
        name: "paideuo_session_templates",
        listRule: ownerRule,
        viewRule: ownerRule,
        fields: [
          { type: "relation", name: "owner", collectionId: users.id, required: true, maxSelect: 1 },
          { type: "text", name: "name", required: true, max: 200 },
          { type: "text", name: "description", max: 10000 },
          {
            type: "select",
            name: "session_type",
            required: true,
            maxSelect: 1,
            values: ["climbing", "strength", "conditioning", "mobility", "other"],
          },
          { type: "json", name: "planned_duration_min", maxSize: 64 },
          { type: "json", name: "components", maxSize: 1048576 },
          { type: "autodate", name: "created", onCreate: true },
          { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
        ],
        indexes: ["CREATE INDEX idx_session_templates_owner ON paideuo_session_templates (owner)"],
      }),
    );
    const slots = app.findCollectionByNameOrId("paideuo_session_slots");
    slots.fields.add(new JSONField({ name: "baseline", maxSize: 1114112 }));
    app.save(slots);
  },
  (app) => {
    const slots = app.findCollectionByNameOrId("paideuo_session_slots");
    slots.fields.removeByName("baseline");
    app.save(slots);
    app.delete(app.findCollectionByNameOrId("paideuo_session_templates"));
  },
);
