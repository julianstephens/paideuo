/// <reference path="../pb_data/types.d.ts" />

migrate(
  (app) => {
    const session = app.findCollectionByNameOrId("paideuo_session_prescriptions");
    session.fields.add(
      new NumberField({ name: "planned_duration_max", min: 0 }),
      new NumberField({ name: "planned_rpe_min", min: 1, max: 10 }),
      new NumberField({ name: "planned_rpe_max", min: 1, max: 10 }),
    );
    app.save(session);

    const component = app.findCollectionByNameOrId("paideuo_training_components");
    component.fields.add(new NumberField({ name: "duration_max", min: 0 }));
    app.save(component);

    const template = app.findCollectionByNameOrId("paideuo_session_templates");
    template.fields.add(
      new JsonField({ name: "planned_duration_max", maxSize: 64 }),
      new JsonField({ name: "planned_rpe_min", maxSize: 64 }),
      new JsonField({ name: "planned_rpe_max", maxSize: 64 }),
    );
    app.save(template);
  },
  (app) => {
    const session = app.findCollectionByNameOrId("paideuo_session_prescriptions");
    session.fields.removeByName("planned_rpe_max");
    session.fields.removeByName("planned_rpe_min");
    session.fields.removeByName("planned_duration_max");
    app.save(session);

    const component = app.findCollectionByNameOrId("paideuo_training_components");
    component.fields.removeByName("duration_max");
    app.save(component);

    const template = app.findCollectionByNameOrId("paideuo_session_templates");
    template.fields.removeByName("planned_rpe_max");
    template.fields.removeByName("planned_rpe_min");
    template.fields.removeByName("planned_duration_max");
    app.save(template);
  },
);
