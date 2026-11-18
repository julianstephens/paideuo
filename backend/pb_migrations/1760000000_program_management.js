migrate(
  (app) => {
    const text = (name, required = false, max = 10000) => ({ type: "text", name, required, max });
    const number = (name, min, required = true) => ({
      type: "number",
      name,
      min,
      required,
      onlyInt: true,
    });
    const select = (name, values) => ({
      type: "select",
      name,
      required: true,
      maxSelect: 1,
      values,
    });
    const relation = (name, collection) => ({
      type: "relation",
      name,
      required: true,
      maxSelect: 1,
      collectionId: collection.id,
    });
    const dates = [
      { type: "autodate", name: "created", onCreate: true },
      { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
    ];
    const create = (name, ownerPath, fields, indexes = []) => {
      const rule = `@request.auth.id != "" && ${ownerPath} = @request.auth.id`;
      const collection = new Collection({
        type: "base",
        name,
        fields,
        indexes,
        listRule: rule,
        viewRule: rule,
      });
      app.save(collection);
      return collection;
    };

    const users = new Collection({
      type: "auth",
      name: "planner_users",
      passwordAuth: { enabled: true, identityFields: ["email"] },
    });
    app.save(users);
    const programs = create(
      "programs",
      "owner",
      [
        relation("owner", users),
        text("name", true, 200),
        text("description"),
        text("objective"),
        select("status", ["draft", "active", "completed", "archived"]),
        ...dates,
      ],
      ["CREATE INDEX idx_programs_owner ON programs (owner)"],
    );
    const blocks = create(
      "blocks",
      "program.owner",
      [
        relation("program", programs),
        text("name", true, 200),
        text("objective"),
        number("position", 1),
        number("duration_weeks", 1),
      ],
      ["CREATE UNIQUE INDEX idx_blocks_position ON blocks (program, position)"],
    );
    const weeks = create(
      "program_weeks",
      "block.program.owner",
      [
        relation("block", blocks),
        number("position", 1),
        text("label"),
        text("focus"),
        select("week_type", ["normal", "recovery"]),
      ],
      ["CREATE UNIQUE INDEX idx_weeks_position ON program_weeks (block, position)"],
    );
    const slots = create(
      "session_slots",
      "block.program.owner",
      [
        relation("block", blocks),
        { ...number("weekday", 1), max: 7 },
        number("position", 1),
        text("label", true, 200),
      ],
      ["CREATE INDEX idx_slots_block ON session_slots (block)"],
    );
    const prescriptions = create(
      "session_prescriptions",
      "program_week.block.program.owner",
      [
        relation("program_week", weeks),
        relation("slot", slots),
        text("title", true, 200),
        text("description"),
        number("planned_duration_min", 0, false),
        text("notes"),
        select("session_type", ["climbing", "strength", "conditioning", "mobility", "other"]),
      ],
      [
        "CREATE UNIQUE INDEX idx_prescriptions_week_slot ON session_prescriptions (program_week, slot)",
      ],
    );
    create(
      "training_components",
      "prescription.program_week.block.program.owner",
      [
        relation("prescription", prescriptions),
        number("position", 1),
        text("name", true, 200),
        text("instructions"),
        number("duration_min", 0, false),
        { type: "json", name: "targets" },
      ],
      ["CREATE INDEX idx_components_prescription ON training_components (prescription)"],
    );
    app.save(
      new Collection({
        type: "base",
        name: "program_duplications",
        fields: [
          relation("owner", users),
          relation("source", programs),
          relation("copy", programs),
          text("operation_id", true, 36),
        ],
        indexes: [
          "CREATE UNIQUE INDEX idx_duplications_operation ON program_duplications (owner, operation_id)",
        ],
      }),
    );
  },
  (app) => {
    for (const name of [
      "program_duplications",
      "training_components",
      "session_prescriptions",
      "session_slots",
      "program_weeks",
      "blocks",
      "programs",
      "planner_users",
    ]) {
      app.delete(app.findCollectionByNameOrId(name));
    }
  },
);
