const isEditable = (program) => ["draft", "active"].includes(program.getString("status"));

const requireEditable = (program) => {
  if (!isEditable(program)) {
    throw new BadRequestError("Completed and archived programs are read-only.");
  }
  return program;
};

// oxlint-disable-next-line import/no-commonjs
module.exports = { isEditable, requireEditable };
