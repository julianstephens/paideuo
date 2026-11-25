/* oxlint-disable import/no-commonjs */

const { restContract, mcpContract, publishedOperations } = require("./nutrition-contracts.cjs");
const { execute } = require("./nutrition.cjs");

const bind = (describe, key) =>
  new Map(
    publishedOperations.map((operation) => {
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

const publishedRestOperations = bind(restContract, "path");
const publishedMcpOperations = bind(mcpContract, "name");

module.exports = { publishedRestOperations, publishedMcpOperations };
