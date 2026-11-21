migrate(
  (app) => {
    const results = app.findCollectionByNameOrId("paideuo_workout_component_results");
    results.fields.add(new JSONField({ name: "observation", maxSize: 16384 }));
    app.save(results);
  },
  (app) => {
    const results = app.findCollectionByNameOrId("paideuo_workout_component_results");
    results.fields.removeByName("observation");
    app.save(results);
  },
);
