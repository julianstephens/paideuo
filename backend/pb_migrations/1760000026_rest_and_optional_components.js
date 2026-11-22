/// <reference path="../pb_data/types.d.ts" />

migrate(
  (app) => {
    for (const name of ["paideuo_session_prescriptions", "paideuo_session_templates"]) {
      const collection = app.findCollectionByNameOrId(name);
      const field = collection.fields.getByName("session_type");
      field.values = [...field.values, "rest"];
      app.save(collection);
    }

    const components = app.findCollectionByNameOrId("paideuo_training_components");
    components.fields.add(new BoolField({ name: "optional" }));
    app.save(components);
  },
  (app) => {
    for (const name of ["paideuo_session_prescriptions", "paideuo_session_templates"]) {
      const collection = app.findCollectionByNameOrId(name);
      const field = collection.fields.getByName("session_type");
      field.values = field.values.filter((value) => value !== "rest");
      app.save(collection);
    }

    const components = app.findCollectionByNameOrId("paideuo_training_components");
    components.fields.removeByName("optional");
    app.save(components);
  },
);
