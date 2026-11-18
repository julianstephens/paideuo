migrate(
  (app) => {
    const templates = app.findCollectionByNameOrId("paideuo_session_templates");
    templates.fields.add(
      new SelectField({
        name: "planned_intensity",
        maxSelect: 1,
        values: ["easy", "moderate", "hard", "maximal"],
      }),
    );
    app.save(templates);

    const components = app.findCollectionByNameOrId("paideuo_training_components");
    components.fields.add(new BoolField({ name: "duration_specified" }));
    app.save(components);
    app
      .db()
      .newQuery(
        "UPDATE paideuo_training_components SET duration_specified = TRUE WHERE duration_min > 0",
      )
      .execute();
  },
  (app) => {
    const components = app.findCollectionByNameOrId("paideuo_training_components");
    components.fields.removeByName("duration_specified");
    app.save(components);
    const templates = app.findCollectionByNameOrId("paideuo_session_templates");
    templates.fields.removeByName("planned_intensity");
    app.save(templates);
  },
);
