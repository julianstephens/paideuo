/* oxlint-disable import/no-commonjs */

const { macroKeys } = require("./nutrition-contracts.cjs");

const targetSource = (kind, id) => ({ kind, id });

const resolveTargets = (layers) => {
  let active = false;
  let activationSource = null;
  const macros = Object.fromEntries(macroKeys.map((key) => [key, { value: null, source: null }]));
  for (const { source, data } of layers) {
    if (Object.hasOwn(data, "active")) {
      active = data.active;
      activationSource = source;
    }
    for (const key of macroKeys) {
      if (Object.hasOwn(data.macros ?? {}, key)) {
        macros[key] = { value: data.macros[key], source };
      }
    }
  }
  return { active, activationSource, macros: active ? macros : null };
};

const scaled = (value) => Math.round(value * 1000);

const entryAmount = (entry, key) => {
  if (Object.hasOwn(entry.overrides ?? {}, key)) {
    const override = entry.overrides[key];
    return override === null ? null : scaled(override);
  }
  const estimate = entry.snapshot.macros[key];
  if (estimate === undefined) return null;
  return Math.floor((scaled(estimate) * scaled(entry.quantity) + 500) / 1000);
};

const summarize = (entries) => ({
  entryCount: entries.length,
  macros: Object.fromEntries(
    macroKeys.map((key) => {
      let subtotal = 0;
      let knownCount = 0;
      for (const entry of entries) {
        const amount = entryAmount(entry, key);
        if (amount === null) continue;
        knownCount++;
        subtotal += amount;
        if (!Number.isSafeInteger(subtotal))
          throw new RangeError("Nutrition subtotal exceeds the supported range.");
      }
      return [key, { subtotal: knownCount ? subtotal / 1000 : null, knownCount }];
    }),
  ),
});

const canonical = (value) => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  }
  return value;
};

module.exports = { targetSource, resolveTargets, summarize, canonical };
