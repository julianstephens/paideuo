migrate(
  (app) => {
    const grants = app.findCollectionByNameOrId("paideuo_mcp_oauth_grants");
    grants.fields.add(new TextField({ name: "scopes", max: 200 }));
    app.save(grants);
  },
  (app) => {
    const grants = app.findCollectionByNameOrId("paideuo_mcp_oauth_grants");
    grants.fields.removeByName("scopes");
    app.save(grants);
  },
);
