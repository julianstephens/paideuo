migrate(
  (app) => {
    const prescriptions = app.findCollectionByNameOrId("paideuo_session_prescriptions");
    prescriptions.fields.add(new TextField({ name: "source_template_id", max: 15 }));
    prescriptions.addIndex("idx_prescriptions_source_template", false, "source_template_id", "");
    app.save(prescriptions);
  },
  (app) => {
    const prescriptions = app.findCollectionByNameOrId("paideuo_session_prescriptions");
    prescriptions.removeIndex("idx_prescriptions_source_template");
    prescriptions.fields.removeByName("source_template_id");
    app.save(prescriptions);
  },
);
