migrate(
  (app) => {
    const templates = app.findCollectionByNameOrId("paideuo_session_templates");
    templates.fields.add(new TextField({ name: "external_id", max: 200 }));
    templates.addIndex(
      "idx_paideuo_template_import_identity",
      true,
      "owner, external_id",
      "external_id != ''",
    );
    app.save(templates);
  },
  (app) => {
    const templates = app.findCollectionByNameOrId("paideuo_session_templates");
    templates.removeIndex("idx_paideuo_template_import_identity");
    templates.fields.removeByName("external_id");
    app.save(templates);
  },
);
