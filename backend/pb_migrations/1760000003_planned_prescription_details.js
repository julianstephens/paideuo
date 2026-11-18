migrate(
  (app) => {
    const collection = app.findCollectionByNameOrId("paideuo_session_prescriptions");
    collection.fields.add(
      new BoolField({ name: "duration_specified" }),
      new SelectField({
        name: "planned_intensity",
        maxSelect: 1,
        values: ["easy", "moderate", "hard", "maximal"],
      }),
    );
    app.save(collection);
    app
      .db()
      .newQuery(
        "UPDATE paideuo_session_prescriptions SET duration_specified = TRUE WHERE planned_duration_min > 0",
      )
      .execute();
  },
  (app) => {
    const collection = app.findCollectionByNameOrId("paideuo_session_prescriptions");
    collection.fields.removeByName("planned_intensity");
    collection.fields.removeByName("duration_specified");
    app.save(collection);
  },
);
