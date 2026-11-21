const observationData = (value) =>
  value == null
    ? null
    : {
        category: value.category,
        severity: value.severity,
        context: value.context ?? "",
        notes: value.notes ?? "",
      };

// oxlint-disable-next-line import/no-commonjs
module.exports = { observationData };
