onRecordValidate((event) => {
  const week = event.app.findRecordById(
    "paideuo_program_weeks",
    event.record.getString("program_week"),
  );
  const slot = event.app.findRecordById("paideuo_session_slots", event.record.getString("slot"));
  if (week.getString("block") !== slot.getString("block")) {
    throw new BadRequestError("A prescription's week and slot must belong to the same block.");
  }
  event.next();
}, "paideuo_session_prescriptions");
