migrate(
  (app) => {
    const sessions = app.findCollectionByNameOrId("paideuo_scheduled_sessions");
    sessions.fields.add(new JSONField({ name: "source_attribution", maxSize: 8192 }));
    app.save(sessions);
    app
      .db()
      .newQuery(`
      UPDATE paideuo_scheduled_sessions AS session
      SET source_attribution = (
        SELECT json_object(
          'blockId', block.id,
          'blockName', block.name,
          'weekId', week.id,
          'weekPosition', week.position,
          'weekLabel', week.label
        )
        FROM paideuo_session_prescriptions AS prescription
        JOIN paideuo_program_weeks AS week ON week.id = prescription.program_week
        JOIN paideuo_blocks AS block ON block.id = week.block
        JOIN paideuo_program_schedules AS schedule ON schedule.program = block.program
        WHERE prescription.id = session.source_prescription_id AND schedule.id = session.schedule
      )
      WHERE EXISTS (
        SELECT 1 FROM paideuo_session_prescriptions AS prescription
        WHERE prescription.id = session.source_prescription_id
      )
    `)
      .execute();
  },
  (app) => {
    const sessions = app.findCollectionByNameOrId("paideuo_scheduled_sessions");
    sessions.fields.removeByName("source_attribution");
    app.save(sessions);
  },
);
