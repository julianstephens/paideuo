migrate(
  (app) => {
    const components = app.findCollectionByNameOrId("paideuo_training_components");
    components.fields.add(new TextField({ name: "classification", max: 32 }));
    app.save(components);

    const results = app.findCollectionByNameOrId("paideuo_workout_component_results");
    results.fields.add(new JSONField({ name: "running_min", maxSize: 32 }));
    results.fields.add(new JSONField({ name: "walking_min", maxSize: 32 }));
    results.fields.add(new JSONField({ name: "continuous_bout_min", maxSize: 32 }));
    results.fields.add(new TextField({ name: "aerobic_modality", max: 64 }));
    app.save(results);
  },
  (app) => {
    const results = app.findCollectionByNameOrId("paideuo_workout_component_results");
    results.fields.removeByName("running_min");
    results.fields.removeByName("walking_min");
    results.fields.removeByName("continuous_bout_min");
    results.fields.removeByName("aerobic_modality");
    app.save(results);

    const components = app.findCollectionByNameOrId("paideuo_training_components");
    components.fields.removeByName("classification");
    app.save(components);
  },
);
