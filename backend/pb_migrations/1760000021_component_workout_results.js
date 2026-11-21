migrate(
  (app) => {
    const results = app.findCollectionByNameOrId("paideuo_workout_component_results");
    results.fields.add(new JSONField({ name: "rounds", maxSize: 32 }));
    app.save(results);

    const sessions = app.findCollectionByNameOrId("paideuo_scheduled_sessions");
    for (const row of app.findRecordsByFilter(sessions.name, "", "", 0, 0)) {
      const snapshot = JSON.parse(row.getString("prescription_snapshot") || "{}");
      const existingResults = app.findRecordsByFilter(
        results.name,
        "session = {:session}",
        "planned_position,id",
        0,
        0,
        { session: row.id },
      );
      let changed = false;
      snapshot.components = (snapshot.components ?? []).map((component, index) => {
        if (component.key) return component;
        changed = true;
        const existing = existingResults.find(
          (result) => result.getInt("planned_position") === index + 1,
        );
        return {
          ...component,
          key:
            existing?.getString("component_key") ||
            `snapshot:${$security.sha256(`${row.id}:${index}:${component.name}`)}`,
        };
      });
      if (changed) {
        row.set("prescription_snapshot", snapshot);
        app.save(row);
      }
    }
  },
  (app) => {
    const results = app.findCollectionByNameOrId("paideuo_workout_component_results");
    results.fields.removeByName("rounds");
    app.save(results);
  },
);
