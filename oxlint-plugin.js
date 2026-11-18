const isMethod = ({ parent }) =>
  parent.type === "MethodDefinition" ||
  (parent.type === "Property" && (parent.method || parent.kind !== "init"));

export default {
  meta: { name: "paideuo" },
  rules: {
    "arrow-functions": {
      create: (context) => {
        const checkFunction = (node) => {
          if (!node.generator && !isMethod(node)) {
            context.report({ node, message: "Use an arrow function." });
          }
        };

        return {
          FunctionDeclaration: checkFunction,
          FunctionExpression: checkFunction,
        };
      },
    },
  },
};
