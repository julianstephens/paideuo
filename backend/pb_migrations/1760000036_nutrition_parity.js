migrate(
  (app) => {
    const receipts = app.findCollectionByNameOrId("paideuo_nutrition_operations");
    receipts.fields.add(new TextField({ name: "operation", max: 100 }));
    receipts.fields.add(new TextField({ name: "actor", max: 100 }));
    app.save(receipts);
  },
  (app) => {
    const receipts = app.findCollectionByNameOrId("paideuo_nutrition_operations");
    receipts.fields.removeByName("operation");
    receipts.fields.removeByName("actor");
    app.save(receipts);
  },
);
