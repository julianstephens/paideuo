/* oxlint-disable import/no-commonjs */

const defaults = ["Breakfast", "Meals", "Snacks", "Fruit", "Ingredients", "Drinks", "Desserts"];
const field = "food_categories";
const collection = "paideuo_nutrition_foods";

const read = (db, user, categories) => {
  const used = arrayOf(new DynamicModel({ category: "" }));
  db.db()
    .newQuery(
      "SELECT DISTINCT json_extract(data, '$.category') AS category FROM " +
        collection +
        " WHERE owner = {:owner} AND json_extract(data, '$.category') != '' ORDER BY category",
    )
    .bind({ owner: user.id })
    .all(used);
  return {
    categories,
    previousCategories: Array.from(used, ({ category }) => category).filter(
      (category) => !categories.includes(category),
    ),
  };
};

const label = (value) => {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 100) {
    throw new BadRequestError("Enter a category name between 1 and 100 characters.");
  }
  return value.trim();
};

const handle = (event) => {
  const owner = event.auth.id;
  const load = (db) => db.findRecordById("paideuo_users", owner);
  const categoriesFor = (user) => JSON.parse(user.getString(field) || "null") ?? defaults;
  if (event.request.method === "GET") {
    const user = load(event.app);
    return event.json(200, read(event.app, user, categoriesFor(user)));
  }

  const { action, name, newName } = event.requestInfo().body;
  if (!["add", "rename", "remove"].includes(action))
    throw new BadRequestError("Unknown category action.");
  const current = action === "add" ? null : label(name);
  const next = action === "remove" ? null : label(newName);
  let result;
  event.app.runInTransaction((tx) => {
    const user = load(tx);
    const categories = [...categoriesFor(user)];
    const index = categories.indexOf(current);
    if (action !== "add" && index === -1) throw new NotFoundError("Category not found.");
    if (
      next &&
      categories.some(
        (item, position) => position !== index && item.toLowerCase() === next.toLowerCase(),
      )
    ) {
      throw new ApiError(409, "A category with that name already exists.");
    }
    if (action === "add") {
      if (categories.length >= 50)
        throw new BadRequestError("The food bank supports up to 50 categories.");
      categories.push(next);
    } else if (action === "remove") {
      categories.splice(index, 1);
    } else {
      categories[index] = next;
      if (current !== next) {
        const foods = tx.findRecordsByFilter(
          collection,
          "owner = {:owner} && data.category = {:category}",
          "",
          0,
          0,
          { owner, category: current },
        );
        for (const food of foods) {
          food.set("data", { ...JSON.parse(food.getString("data")), category: next });
          tx.save(food);
        }
      }
    }
    user.set(field, categories);
    tx.save(user);
    result = read(tx, user, categories);
  });
  return event.json(200, result);
};

module.exports = { handle };
