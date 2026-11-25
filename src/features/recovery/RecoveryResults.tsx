import { Badge, Box, Button, Flex, Grid, Heading, Input, Stack, Text } from "@chakra-ui/react";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Disclosure, FormField, Notice, Panel } from "../../components/ui";
import { errorMessage } from "../../lib/api/request";
import { addDays, dateKey, formatDate, monday, parseDate } from "../calendar/dates";
import { FilterFields, FilterSelect, MetricsFilters } from "../compliance/MetricsFilters";
import type { UpdateFilters } from "../compliance/MetricsFilters";
import { MetricPlot, plotColors } from "../compliance/MetricPlot";
import { hours, loadPoints } from "../compliance/format";
import { useTrainingLoad } from "../compliance/TrainingLoad";
import {
  checkInApi,
  checkInKey,
  checkInSections,
  nutritionChoices,
  hasCheckInResponse,
  nutritionMetrics,
  recoveryMetrics,
  summarize,
} from "./recovery";

const metricNumber = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
const shortDate = (date: Date) =>
  formatDate(date, { month: "short", day: "numeric", year: "numeric" });

const numericTrends = [...recoveryMetrics, ...nutritionMetrics];
const trendOptions = [...numericTrends, ...nutritionChoices];

export const RecoveryResults = ({
  ownerId,
  programId,
  date,
  trend,
  updateParams,
  onReset,
  resetDisabled,
  programPicker,
}: {
  ownerId: string;
  programId?: string;
  date: string;
  trend: string | null;
  updateParams: UpdateFilters;
  onReset: () => void;
  resetDisabled: boolean;
  programPicker?: ReactNode;
}) => {
  const trendKey = trendOptions.find(({ key }) => key === trend)?.key ?? "sleepHours";
  const selected = parseDate(date);
  const currentWeek = selected ? monday(selected) : null;
  const start = currentWeek ? dateKey(addDays(currentWeek, -49)) : "";
  const end = currentWeek ? dateKey(addDays(currentWeek, 6)) : "";
  const query = useQuery({
    queryKey: [...checkInKey(ownerId), start, end],
    queryFn: ({ signal }) => checkInApi.list(start, end, signal),
    enabled: Boolean(currentWeek),
    retry: false,
  });
  const training = useTrainingLoad(ownerId, programId);
  const trainingWeeks = new Map(
    training.data?.weeks.map((week) => [week.startDate, week.totals.all]),
  );
  const entry = query.data?.find((item) => item.date === date);
  const weeks = currentWeek
    ? Array.from({ length: 8 }, (_, index) => addDays(currentWeek, -7 * index))
    : [];

  const weeklyEntries = weeks.map((week) => {
    const start = dateKey(week);
    const end = dateKey(addDays(week, 6));
    return {
      week,
      entries: query.data?.filter(({ date }) => date >= start && date <= end) ?? [],
    };
  });
  const numericTrend = numericTrends.find(({ key }) => key === trendKey);
  const nutritionTrend = nutritionChoices.find(({ key }) => key === trendKey);
  const trendSeries = numericTrend
    ? [{ name: "mean", label: numericTrend.label, color: plotColors[0] }]
    : (nutritionTrend?.choices ?? []).map(({ value, label }, index) => ({
        name: value,
        label,
        color: plotColors[index],
      }));
  const trendData = [...weeklyEntries].reverse().map(({ week, entries }) => ({
    label: formatDate(week, { month: "short", day: "numeric" }),
    ...(numericTrend && { mean: summarize(entries, numericTrend.key).mean }),
    ...(nutritionTrend &&
      Object.fromEntries(
        nutritionTrend.choices.map(({ value }) => [
          value,
          entries.some((entry) => entry[nutritionTrend.key] !== null)
            ? entries.filter((entry) => entry[nutritionTrend.key] === value).length
            : null,
        ]),
      )),
  }));

  return (
    <Stack gap="4">
      <MetricsFilters onReset={onReset} resetDisabled={resetDisabled}>
        <FilterFields>
          <FormField as="div" flex="1 1 12rem" minW="0" maxW="sm">
            <label htmlFor="metrics-results-date">Results date</label>
            <Input
              id="metrics-results-date"
              type="date"
              min="0001-01-01"
              max="9999-12-31"
              value={date}
              onChange={({ target }) => updateParams({ date: target.value || null })}
            />
          </FormField>
          {programPicker}
          <FilterSelect
            label="Weekly trend metric"
            value={trendKey}
            onChange={(value) => updateParams({ trend: value === "sleepHours" ? null : value })}
          >
            {trendOptions.map(({ key, label }) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </FilterSelect>
        </FilterFields>
        <Text color="fg.muted" fontSize="sm">
          Check-ins show the selected day and eight weeks ending with that week.
          {programId && " The program selection applies to training totals only."}
        </Text>
      </MetricsFilters>
      <Panel as="section">
        <Heading as="h2" size="md">
          Weekly recovery and nutrition
        </Heading>
        {!selected && <Notice>Choose a valid results date.</Notice>}
        {selected && query.isPending && <Notice role="status">Loading check-ins…</Notice>}
        {query.isError && (
          <Stack align="start">
            <Notice role="alert">{errorMessage(query.error, "Unable to load check-ins.")}</Notice>
            <Button size="sm" variant="outline" onClick={() => void query.refetch()}>
              Retry
            </Button>
          </Stack>
        )}
        {query.data && selected && (
          <Stack gap="3">
            <Disclosure label={`Daily results for ${shortDate(selected)}`}>
              {entry ? (
                <Stack as="dl" gap="2" fontSize="sm">
                  {checkInSections.flatMap(({ fields }) =>
                    fields.map((field) => {
                      const value = entry[field.key];
                      if (value === null || value === "") return null;
                      const display =
                        "unit" in field && typeof value === "number"
                          ? `${metricNumber.format(value)} ${field.unit}`
                          : "choices" in field
                            ? (field.choices.find((choice) => choice.value === value)?.label ??
                              value)
                            : value;
                      return (
                        <Box key={field.key}>
                          <Text as="dt" fontWeight="medium">
                            {field.label}
                          </Text>
                          <Text as="dd" color="fg.muted" whiteSpace="pre-wrap">
                            {display}
                          </Text>
                        </Box>
                      );
                    }),
                  )}
                </Stack>
              ) : (
                <Text color="fg.muted" fontSize="sm">
                  No check-in recorded for this date.
                </Text>
              )}
            </Disclosure>
            <Disclosure label="About these totals">
              <Text color="fg.muted" fontSize="sm">
                Averages use recorded values.
                {programId &&
                  " Training totals include all session types for the selected program."}
              </Text>
            </Disclosure>
            {programId && training.isPending && (
              <Notice role="status">Loading training comparison…</Notice>
            )}
            {programId && training.isError && (
              <Stack align="start">
                <Notice>Unable to load the training comparison.</Notice>
                <Button size="sm" variant="outline" onClick={() => void training.refetch()}>
                  Retry training comparison
                </Button>
              </Stack>
            )}
            <MetricPlot
              title={numericTrend?.label ?? nutritionTrend?.label ?? "Weekly check-in trend"}
              data={trendData}
              series={trendSeries}
              unit={numericTrend?.unit ?? "days"}
              line={Boolean(numericTrend)}
              ceiling={numericTrend?.unit === "/ 5" ? 5 : undefined}
            />
            <Grid
              gap="3"
              templateColumns={{ base: "minmax(0, 1fr)", md: "repeat(2, minmax(0, 1fr))" }}
            >
              {weeklyEntries.map(({ week, entries }) => {
                const weekStart = dateKey(week);
                const weekEnd = addDays(week, 6);
                const totals = trainingWeeks.get(weekStart);
                const nutritionDays = entries.filter((entry) =>
                  hasCheckInResponse(entry, checkInSections[1]),
                ).length;
                return (
                  <Stack
                    as="article"
                    key={weekStart}
                    gap="2"
                    borderWidth="1px"
                    borderRadius="md"
                    p="3"
                  >
                    <Flex align="baseline" justify="space-between" gap="2" wrap="wrap">
                      <Heading as="h3" size="sm">
                        {shortDate(week)} – {shortDate(weekEnd)}
                      </Heading>
                      <Badge variant="subtle">
                        {entries.length} {entries.length === 1 ? "check-in" : "check-ins"}
                      </Badge>
                    </Flex>
                    <Disclosure label={`View breakdown for ${shortDate(week)}`}>
                      <Stack as="dl" gap="1" fontSize="sm">
                        {numericTrends.map(({ key, label, unit }) => {
                          const { mean, count } = summarize(entries, key);
                          return (
                            <Flex as="div" key={key} justify="space-between" gap="2" wrap="wrap">
                              <Text as="dt">{label}</Text>
                              <Text as="dd" color="fg.muted">
                                {mean === null ? "—" : `${metricNumber.format(mean)} ${unit}`} ·{" "}
                                {count} recorded
                              </Text>
                            </Flex>
                          );
                        })}
                        {nutritionChoices.map(({ key, label, choices }) => {
                          const counts = choices
                            .map(({ value, label }) => ({
                              label,
                              count: entries.filter((entry) => entry[key] === value).length,
                            }))
                            .filter(({ count }) => count > 0);
                          return (
                            <Flex as="div" key={key} justify="space-between" gap="2" wrap="wrap">
                              <Text as="dt">{label}</Text>
                              <Text as="dd" color="fg.muted">
                                {counts.length
                                  ? counts
                                      .map(({ label, count }) => `${label} · ${count}`)
                                      .join(" · ")
                                  : "—"}
                              </Text>
                            </Flex>
                          );
                        })}
                      </Stack>
                      <Text fontSize="xs" color="fg.muted" mt="2">
                        Nutrition recorded on {nutritionDays} of 7 days
                      </Text>
                      {programId && training.isSuccess && (
                        <Stack mt="3" pt="3" borderTopWidth="1px" gap="2">
                          <Heading as="h4" size="xs">
                            Training
                          </Heading>
                          {totals ? (
                            <Grid
                              as="dl"
                              gap="2"
                              templateColumns="repeat(auto-fit, minmax(min(100%, 7rem), 1fr))"
                            >
                              {[
                                ["Scheduled sessions", totals.scheduledSessions, ""],
                                ["Planned duration", hours(totals.plannedMinutes), ""],
                                [
                                  "Actual duration",
                                  hours(totals.actualMinutes),
                                  `${totals.measuredDurationSessions}/${totals.completedSessions} measured`,
                                ],
                                [
                                  "Load",
                                  totals.load === null ? "—" : loadPoints(totals.load),
                                  `${totals.measuredLoadSessions}/${totals.completedSessions} measured`,
                                ],
                              ].map(([label, value, coverage]) => (
                                <Box key={label}>
                                  <Text as="dt" fontSize="xs" color="fg.muted">
                                    {label}
                                  </Text>
                                  <Text as="dd" fontWeight="semibold">
                                    {value}
                                  </Text>
                                  {coverage && (
                                    <Text as="dd" fontSize="xs" color="fg.muted">
                                      {coverage}
                                    </Text>
                                  )}
                                </Box>
                              ))}
                            </Grid>
                          ) : (
                            <Text fontSize="sm" color="fg.muted">
                              No scheduled program week
                            </Text>
                          )}
                        </Stack>
                      )}
                    </Disclosure>
                  </Stack>
                );
              })}
            </Grid>
          </Stack>
        )}
      </Panel>
    </Stack>
  );
};
