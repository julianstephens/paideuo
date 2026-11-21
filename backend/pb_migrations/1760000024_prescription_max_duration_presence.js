migrate(
  (app) => {
    const session = app.findCollectionByNameOrId("paideuo_session_prescriptions");
    session.fields.add(new BoolField({ name: "duration_max_specified" }));
    app.save(session);
    const component = app.findCollectionByNameOrId("paideuo_training_components");
    component.fields.add(new BoolField({ name: "duration_max_specified" }));
    app.save(component);
    app
      .db()
      .newQuery(
        "UPDATE paideuo_session_prescriptions SET duration_max_specified = TRUE WHERE planned_duration_max > 0",
      )
      .execute();
    app
      .db()
      .newQuery(
        "UPDATE paideuo_training_components SET duration_max_specified = TRUE WHERE duration_max > 0",
      )
      .execute();
  },
  (app) => {
    for (const name of ["paideuo_session_prescriptions", "paideuo_training_components"]) {
      const collection = app.findCollectionByNameOrId(name);
      collection.fields.removeByName("duration_max_specified");
      app.save(collection);
    }
  },
);
