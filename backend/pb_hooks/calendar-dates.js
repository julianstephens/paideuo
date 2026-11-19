const format = (date) => date.toISOString().slice(0, 10);

// UTC arithmetic keeps a civil date independent of the server's timezone and DST.
// oxlint-disable-next-line import/no-commonjs
module.exports = {
  parse: (value) => {
    if (
      typeof value !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      value.startsWith("0000")
    ) {
      return null;
    }
    const date = new Date(value + "T00:00:00Z");
    return Number.isFinite(date.getTime()) && format(date) === value ? date : null;
  },
  format,
  validTimezone: (timezone) =>
    typeof timezone === "string" &&
    timezone.length <= 100 &&
    !!timezone &&
    timezone !== "Local" &&
    new Timezone(timezone).string() === timezone,
};
