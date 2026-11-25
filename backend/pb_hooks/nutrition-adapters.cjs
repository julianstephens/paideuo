/* oxlint-disable import/no-commonjs */

const { operations, restContract, mcpContract } = require("./nutrition-contracts.cjs");
const { execute } = require("./nutrition.cjs");

const bind = (describe, key) =>
  new Map(
    Object.keys(operations).map((operation) => {
      const contract = describe(operation);
      return [
        contract[key],
        {
          contract,
          invoke: (app, principal, input) => execute(app, principal, operation, input),
        },
      ];
    }),
  );

const restOperations = bind(restContract, "path");
const mcpOperations = bind(mcpContract, "name");

const foodRestOperations = new Map(
  [...restOperations].filter(([path]) => path.startsWith("/api/paideuo/v1/nutrition/foods/")),
);
const foodMcpOperations = new Map(
  [...mcpOperations].filter(([name]) => name.startsWith("nutrition_foods_")),
);

module.exports = { restOperations, mcpOperations, foodRestOperations, foodMcpOperations };
