migrate(
  (app) => {
    const users = app.findCollectionByNameOrId("paideuo_users");
    const relation = (name, collection, required = false, cascadeDelete = false) => ({
      type: "relation",
      name,
      collectionId: collection.id,
      maxSelect: 1,
      required,
      cascadeDelete,
    });
    const text = (name, max) => ({ type: "text", name, max, required: true });
    const json = (name) => ({ type: "json", name, maxSize: 512 * 1024, required: true });
    const add = (suffix, fields, indexes) => {
      const name = "paideuo_nutrition_" + suffix;
      const collection = new Collection({
        type: "base",
        name,
        fields: [relation("owner", users, true, true), ...fields],
        indexes: indexes.map(
          ([key, unique, columns]) =>
            "CREATE " +
            (unique ? "UNIQUE " : "") +
            "INDEX idx_nutrition_" +
            suffix +
            "_" +
            key +
            " ON " +
            name +
            " (" +
            columns +
            ")",
        ),
      });
      app.save(collection);
      return collection;
    };
    const externalId = () => text("external_id", 200);
    const identity = ["identity", true, "owner, external_id"];
    const food = add("foods", [externalId(), json("data")], [identity]);
    add(
      "recipes",
      [externalId(), relation("food", food, true, true), json("data")],
      [identity, ["food", true, "food"]],
    );
    const plans = add(
      "plans",
      [
        externalId(),
        relation("program", app.findCollectionByNameOrId("paideuo_programs"), true, true),
        json("data"),
      ],
      [identity, ["program", true, "program"]],
    );
    add(
      "targets",
      [externalId(), relation("plan", plans, true, true), text("selector", 80), json("data")],
      [identity, ["selector", true, "plan, selector"]],
    );
    const entryFields = () => [externalId(), text("date", 10), json("data")];
    const byDate = ["date", false, "owner, date"];
    add("planned", entryFields(), [identity, byDate]);
    add("consumed", entryFields(), [identity, byDate]);
    add(
      "operations",
      [text("operation_id", 200), text("fingerprint", 64), json("result")],
      [["operation", true, "owner, operation_id"]],
    );
  },
  (app) => {
    for (const suffix of [
      "operations",
      "consumed",
      "planned",
      "targets",
      "plans",
      "recipes",
      "foods",
    ]) {
      app.delete(app.findCollectionByNameOrId("paideuo_nutrition_" + suffix));
    }
  },
);
