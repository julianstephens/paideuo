const componentKey = (record) => record.getString("external_key") || record.id;

const sameTrainingComponent = (record, values) =>
  record.getInt("position") === values.position &&
  record.getString("external_key") === values.external_key &&
  record.getString("name") === values.name &&
  record.getString("instructions") === values.instructions &&
  record.getInt("duration_min") === values.duration_min &&
  record.getInt("duration_max") === (values.duration_max ?? 0) &&
  record.getBool("duration_max_specified") === (values.duration_max_specified ?? false) &&
  record.getBool("duration_specified") === values.duration_specified &&
  record.getString("classification") === (values.classification ?? "") &&
  JSON.stringify(JSON.parse(record.getString("targets") || "null")) ===
    JSON.stringify(values.targets);

const reconcileTrainingComponents = (db, prescriptionId, components) => {
  const collection = "paideuo_training_components";
  const existing = db.findRecordsByFilter(collection, "prescription = {:id}", "position,id", 0, 0, {
    id: prescriptionId,
  });
  const byKey = new Map(existing.map((record) => [componentKey(record), record]));
  for (const { key, ...fields } of components) {
    const values = { ...fields, external_key: key };
    const current = byKey.get(key);
    if (!current) {
      db.save(
        new Record(db.findCollectionByNameOrId(collection), {
          prescription: prescriptionId,
          ...values,
        }),
      );
    } else if (!sameTrainingComponent(current, values)) {
      for (const [field, value] of Object.entries(values)) current.set(field, value);
      db.save(current);
    }
    byKey.delete(key);
  }
  for (const record of byKey.values()) db.delete(record);
};

// oxlint-disable-next-line import/no-commonjs
module.exports = { componentKey, reconcileTrainingComponents };
