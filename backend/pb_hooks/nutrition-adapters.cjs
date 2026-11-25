/* oxlint-disable import/no-commonjs */

const {
  operations,
  restContract,
  mcpContract,
  publishedOperations,
} = require("./nutrition-contracts.cjs");
const { execute } = require("./nutrition.cjs");

const bind = (describe, key, names = Object.keys(operations)) =>
  new Map(
    names.map((operation) => {
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

const publishedRestOperations = bind(restContract, "path", publishedOperations);
const publishedMcpOperations = bind(mcpContract, "name", publishedOperations);

module.exports = { restOperations, mcpOperations, publishedRestOperations, publishedMcpOperations };
