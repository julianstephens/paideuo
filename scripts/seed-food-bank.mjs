import PocketBase, { ClientResponseError } from "pocketbase";

const samples = [
  {
    key: "chicken-rice-bowl",
    food: {
      title: "Chicken and rice bowl",
      category: "Meals",
      description: "Chicken, brown rice, and broccoli with olive oil.",
      serving: { description: "One bowl", size: 1, unit: "bowl" },
      macros: { calories: 520, protein: 46, carbohydrate: 49, fat: 14 },
    },
    recipe: {
      ingredients: [
        { name: "Cooked chicken breast", quantity: 120, unit: "g", prep: "Sliced" },
        { name: "Cooked brown rice", quantity: 180, unit: "g" },
        { name: "Broccoli", quantity: 90, unit: "g" },
        { name: "Olive oil", quantity: 2, unit: "tsp" },
        { name: "Black pepper", prep: "To taste" },
      ],
      instructions:
        "Steam the broccoli. Warm the cooked chicken and rice, then assemble and season.",
      portions: 1,
    },
  },
  {
    key: "yogurt-oat-bowl",
    food: {
      title: "Greek yogurt and oat bowl",
      category: "Breakfast",
      serving: { description: "One bowl", size: 1, unit: "bowl" },
      macros: { calories: 325, protein: 26, carbohydrate: 43, fat: 7 },
    },
    recipe: {
      ingredients: [
        { name: "Plain Greek yogurt", quantity: 200, unit: "g" },
        { name: "Rolled oats", quantity: 40, unit: "g" },
        { name: "Blueberries", quantity: 70, unit: "g" },
      ],
      instructions: "Stir the oats into the yogurt and top with blueberries.",
      portions: 1,
    },
  },
  {
    key: "banana",
    food: {
      title: "Banana",
      category: "Fruit",
      serving: { description: "One medium banana", size: 1, unit: "banana" },
      macros: { calories: 105, protein: 1.3, carbohydrate: 27, fat: 0.4 },
    },
  },
  {
    key: "rolled-oats",
    food: {
      title: "Rolled oats",
      category: "Ingredients",
      serving: { description: "Dry oats", size: 40, unit: "g" },
      macros: { calories: 150, protein: 5, carbohydrate: 27, fat: 3 },
    },
  },
  {
    key: "black-coffee",
    food: {
      title: "Black coffee",
      category: "Drinks",
      serving: { description: "One cup, unsweetened", size: 240, unit: "mL" },
      macros: { calories: 2, fat: 0 },
    },
  },
];

const seed = async () => {
  const { TEST_EMAIL, TEST_PASSWORD, POCKETBASE_URL = "http://127.0.0.1:8090" } = process.env;
  if (!TEST_EMAIL || !TEST_PASSWORD) {
    throw new Error("Set TEST_EMAIL and TEST_PASSWORD for an existing paideuo_users account.");
  }

  const pb = new PocketBase(POCKETBASE_URL);
  await pb.collection("paideuo_users").authWithPassword(TEST_EMAIL, TEST_PASSWORD);
  const post = (path, body) =>
    pb.send("/api/paideuo/v1/nutrition/" + path, { method: "POST", body });

  const { categories } = await pb.send("/api/paideuo/v1/nutrition/food-categories");
  const allowed = new Map(categories.map((category) => [category.toLowerCase(), category]));
  const existingFoods = async () => {
    const foods = new Map();
    let after;
    do {
      const { items, next } = await post("foods/list", { status: "all", limit: 100, after });
      for (const item of items) foods.set(item.externalId, item.id);
      after = next ?? undefined;
    } while (after);
    return foods;
  };
  const existing = await existingFoods();

  for (const { key, food, recipe } of samples) {
    const externalId = "seed-food-bank:" + key;
    let foodId = existing.get(externalId);
    if (!foodId) {
      const { category, ...fields } = food;
      const selected = allowed.get(category.toLowerCase());
      const data = selected ? { ...fields, category: selected } : fields;
      try {
        ({ id: foodId } = await post("foods/create", {
          externalId,
          operationId: externalId,
          data,
        }));
      } catch (error) {
        if (!(error instanceof ClientResponseError) || error.status !== 409) throw error;
        // A concurrent seed may have created the same external ID.
        foodId = (await existingFoods()).get(externalId);
        if (!foodId) throw error;
      }
    }
    if (!recipe) continue;
    const { items } = await post("recipes/list", { foodId, limit: 1 });
    if (items.length) continue;
    const recipeId = externalId + ":recipe";
    await post("recipes/create", {
      foodId,
      externalId: recipeId,
      operationId: recipeId,
      data: recipe,
    });
  }

  console.log(`Processed ${samples.length} sample foods. Open Plan → Nutrition (/nutrition).`);
};

try {
  await seed();
} catch (error) {
  // Print only the API message or status, without request details.
  const detail =
    error instanceof ClientResponseError
      ? error.response.message ||
        (error.status ? `HTTP ${error.status}` : "Could not reach PocketBase.")
      : error.message;
  console.error(`Food bank seed failed: ${detail}`);
  process.exitCode = 1;
}
