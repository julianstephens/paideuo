const collectionNames = [
  ["planner_users", "paideuo_users"],
  ["programs", "paideuo_programs"],
  ["blocks", "paideuo_blocks"],
  ["program_weeks", "paideuo_program_weeks"],
  ["session_slots", "paideuo_session_slots"],
  ["session_prescriptions", "paideuo_session_prescriptions"],
  ["training_components", "paideuo_training_components"],
  ["program_duplications", "paideuo_program_duplications"],
];

const renameCollection = (app, from, to) => {
  const collection = app.findCollectionByNameOrId(from);
  collection.name = to;
  collection.indexes = collection.indexes.map((index) =>
    index.replace(/(\bON\s+)(["`]?)(\w+)\2/i, (match, on, quote, table) =>
      table === from ? `${on}${quote}${to}${quote}` : match,
    ),
  );
  app.save(collection);
};

migrate(
  (app) => {
    for (const [from, to] of collectionNames) renameCollection(app, from, to);
  },
  (app) => {
    for (const [from, to] of collectionNames.toReversed()) renameCollection(app, to, from);
  },
);
