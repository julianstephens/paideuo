/* oxlint-disable import/no-commonjs */

const { macroKeys } = require("./nutrition-contracts.cjs");

const measure = () => ({ thousandths: 0, days: 0 });
const add = (measure, value) => {
  if (value === null) return;
  measure.thousandths += Math.round(value * 1000);
  if (!Number.isSafeInteger(measure.thousandths))
    throw new RangeError("Nutrition subtotal exceeds the supported range.");
  measure.days++;
};
const result = ({ thousandths, days }) => ({
  total: days ? thousandths / 1000 : null,
  average: days ? thousandths / 1000 / days : null,
  days,
});

const summarizeMacro = (days, key) => {
  const planned = measure();
  const consumed = measure();
  const target = measure();
  const attainmentActual = measure();
  const attainmentTarget = measure();
  const planDifference = measure();
  let partialPlannedDays = 0;
  let partialConsumedDays = 0;
  for (const day of days) {
    const plan = day.planned.macros[key];
    const actual = day.consumed.macros[key];
    const goal = day.target.macros?.[key].value ?? null;
    const partialPlan = plan.knownCount < day.planned.entryCount;
    const partialActual = actual.knownCount < day.consumed.entryCount;
    partialPlannedDays += Number(partialPlan);
    partialConsumedDays += Number(partialActual);
    add(planned, plan.subtotal);
    add(consumed, actual.subtotal);
    add(target, goal);
    if (partialActual || actual.subtotal === null) continue;
    if (goal !== null) {
      add(attainmentActual, actual.subtotal);
      add(attainmentTarget, goal);
    }
    if (day.target.active && !partialPlan && plan.subtotal !== null) {
      add(planDifference, actual.subtotal - plan.subtotal);
    }
  }
  return {
    planned: { ...result(planned), partialDays: partialPlannedDays },
    consumed: { ...result(consumed), partialDays: partialConsumedDays },
    target: result(target),
    attainment: {
      ratio: attainmentTarget.thousandths
        ? attainmentActual.thousandths / attainmentTarget.thousandths
        : null,
      days: attainmentTarget.days,
    },
    planDifference: result(planDifference),
  };
};

const summarizeFoodNutrition = (days) => ({
  days: days.length,
  loggedDays: days.filter(({ consumed }) => consumed.entryCount > 0).length,
  plannedDays: days.filter(({ planned }) => planned.entryCount > 0).length,
  activePlanDays: days.filter(({ target }) => target.active).length,
  macros: Object.fromEntries(macroKeys.map((key) => [key, summarizeMacro(days, key)])),
});

module.exports = { summarizeFoodNutrition };
