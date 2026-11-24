const updateTemplateLinks = (db, template, removeLink = false) => {
  const { isEditable } = require(__hooks + "/program-editability.js");
  const { sessionFields, templateSnapshot } = require(__hooks + "/prescription-fields.cjs");
  const { reconcileTrainingComponents } = require(__hooks + "/training-components.cjs");
  const parseComponents = require(__hooks + "/prescription-components.js");
  const templateId = template.id;
  const owner = template.getString("owner");
  const baseline = removeLink ? null : { ...templateSnapshot(template), templateId };
  const slots = db.findRecordsByFilter(
    "paideuo_session_slots",
    "baseline.templateId = {:templateId} && block.program.owner = {:owner}",
    "",
    0,
    0,
    { templateId, owner },
  );
  const prescriptions = db.findRecordsByFilter(
    "paideuo_session_prescriptions",
    "source_template_id = {:templateId} && program_week.block.program.owner = {:owner}",
    "",
    0,
    0,
    { templateId, owner },
  );
  const blocks = new Map();
  const programs = new Map();
  const editable = (blockId) => {
    if (!blocks.has(blockId)) {
      const block = db.findRecordById("paideuo_blocks", blockId);
      blocks.set(blockId, block.getString("program"));
    }
    const programId = blocks.get(blockId);
    if (!programs.has(programId)) {
      programs.set(programId, isEditable(db.findRecordById("paideuo_programs", programId)));
    }
    return programs.get(programId);
  };
  for (const slot of slots) {
    if (!editable(slot.getString("block"))) continue;
    const next = baseline ?? JSON.parse(slot.getString("baseline"));
    if (removeLink) delete next.templateId;
    slot.set("baseline", next);
    db.save(slot);
  }
  if (!prescriptions.length) return;
  const fields = baseline
    ? sessionFields({ ...baseline, title: baseline.name })
    : { source_template_id: "" };
  const components = baseline ? parseComponents(baseline.components) : null;
  for (const prescription of prescriptions) {
    const week = db.findRecordById("paideuo_program_weeks", prescription.getString("program_week"));
    if (!editable(week.getString("block"))) continue;
    for (const [key, value] of Object.entries(fields)) {
      if (key !== "notes") prescription.set(key, value);
    }
    db.save(prescription);
    if (components) reconcileTrainingComponents(db, prescription.id, components);
  }
};

// oxlint-disable-next-line import/no-commonjs
module.exports = updateTemplateLinks;
