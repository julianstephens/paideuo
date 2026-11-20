migrate(
  (app) => {
    const operations = app.findCollectionByNameOrId("paideuo_import_operations");
    // Domain receipts include one result per submitted row.
    operations.fields.getByName("result_json").maxSize = 4 * 1024 * 1024;
    app.save(operations);
  },
  (app) => {
    const operations = app.findCollectionByNameOrId("paideuo_import_operations");
    operations.fields.getByName("result_json").maxSize = 65536;
    app.save(operations);
  },
);
