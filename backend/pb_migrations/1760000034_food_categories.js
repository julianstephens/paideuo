migrate(
  (app) => {
    const users = app.findCollectionByNameOrId("paideuo_users");
    users.fields.add(new JSONField({ name: "food_categories", maxSize: 32768 }));
    app.save(users);
  },
  (app) => {
    const users = app.findCollectionByNameOrId("paideuo_users");
    users.fields.removeByName("food_categories");
    app.save(users);
  },
);
