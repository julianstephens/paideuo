export const nutritionOperation = <Change>(
  change: Change,
  failed?: { change: Change; operationId: string },
) =>
  failed && JSON.stringify(failed.change) === JSON.stringify(change)
    ? failed
    : { change, operationId: crypto.randomUUID() };
