/// <reference path="../pb_data/types.d.ts" />

migrate(
  (app) => {
    const reviews = app.findCollectionByNameOrId("paideuo_weekly_reviews");
    const programs = app.findCollectionByNameOrId("paideuo_programs");
    const addMissing = (field) => {
      if (!reviews.fields.getByName(field.name)) reviews.fields.add(field);
    };

    addMissing(
      new RelationField({
        name: "program",
        collectionId: programs.id,
        required: true,
        maxSelect: 1,
        cascadeDelete: true,
      }),
    );
    for (const field of [
      new TextField({ name: "source_week", max: 100, required: true }),
      new TextField({ name: "source_block", max: 100, required: true }),
      new TextField({ name: "week_label", max: 1000, required: true }),
      new TextField({ name: "block_label", max: 1000, required: true }),
      new TextField({ name: "start_date", max: 10 }),
      new TextField({ name: "end_date", max: 10 }),
      new TextField({ name: "worked", max: 10000 }),
      new TextField({ name: "did_not_work", max: 10000 }),
      new TextField({ name: "recovery_observations", max: 10000 }),
      new TextField({ name: "adjustments", max: 10000 }),
      new AutodateField({ name: "created", onCreate: true }),
      new AutodateField({ name: "updated", onCreate: true, onUpdate: true }),
    ]) {
      addMissing(field);
    }

    const index =
      "CREATE UNIQUE INDEX idx_paideuo_review_week ON paideuo_weekly_reviews (program, source_week)";
    if (!reviews.indexes.includes(index)) reviews.indexes.push(index);
    app.save(reviews);
  },
  () => {
    // The migration only repairs fields owned by the original weekly review migration.
  },
);
