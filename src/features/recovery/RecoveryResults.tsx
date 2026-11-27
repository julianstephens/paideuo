import { Button, Checkbox, Flex, Heading, Stack, Table, Text } from "@chakra-ui/react";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Disclosure, Notice, Panel } from "../../components/ui";
import { errorMessage } from "../../lib/api/request";
import { addDays, dateKey, formatDate, parseDate } from "../calendar/dates";
import { FoodNutritionMetrics } from "../compliance/FoodNutritionMetrics";
import { FilterSelect } from "../compliance/MetricsFilters";
import type { UpdateFilters } from "../compliance/MetricsFilters";
import { MetricPlot, plotColors } from "../compliance/MetricPlot";
import { hours, loadPoints } from "../compliance/format";
import type { MetricsReport } from "../compliance/metrics";
import {
  checkInApi,
  checkInKey,
  checkInSections,
  hasCheckInResponse,
  nutritionChoices,
  nutritionMetrics,
  recoveryMetrics,
  summarize,
} from "./recovery";
import type { CheckInEntry } from "./recovery";

const metricNumber = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
const shortDate = (date: string) =>
  formatDate(parseDate(date)!, { month: "short", day: "numeric", year: "numeric" });
const numericTrends = [...recoveryMetrics, ...nutritionMetrics];
const trendOptions = [...numericTrends, ...nutritionChoices];
const colors = [...plotColors, "green.solid", "red.solid", "cyan.solid"];

const listCheckIns = async (
  { start, end }: NonNullable<MetricsReport["window"]>,
  signal: AbortSignal,
) => {
  const chunks = [];
  let first = start;
  while (first <= end) {
    const last = dateKey(addDays(parseDate(first)!, 55));
    chunks.push(checkInApi.list(first, last < end ? last : end, signal));
    if (last >= end) break;
    first = dateKey(addDays(parseDate(last)!, 1));
  }
  return (await Promise.all(chunks)).flat();
};

const DailyDetails = ({ entries }: { entries: CheckInEntry[] }) => {
  const [date, setDate] = useState("");
  const entry = entries.find((item) => item.date === date) ?? entries.at(-1);
  if (!entry) return null;

  return (
    <Disclosure label="Daily check-in details">
      <Stack gap="3">
        <FilterSelect label="Check-in date" value={entry.date} onChange={setDate}>
          {entries.map(({ date }) => (
            <option key={date} value={date}>
              {shortDate(date)}
            </option>
          ))}
        </FilterSelect>
        <Stack as="dl" gap="1" fontSize="sm">
          {checkInSections.flatMap(({ fields }) =>
            fields.map((field) => {
              const value = entry[field.key];
              if (value == null || value === "") return null;
              const display =
                "unit" in field && typeof value === "number"
                  ? `${metricNumber.format(value)} ${field.unit}`
                  : "choices" in field
                    ? (field.choices.find((choice) => choice.value === value)?.label ?? value)
                    : value;
              return (
                <Flex key={field.key} gap="2" justify="space-between" wrap="wrap">
                  <Text as="dt" fontWeight="medium">
                    {field.label}
                  </Text>
                  <Text as="dd" color="fg.muted" whiteSpace="pre-wrap" overflowWrap="anywhere">
                    {display}
                  </Text>
                </Flex>
              );
            }),
          )}
        </Stack>
      </Stack>
    </Disclosure>
  );
};

export const RecoveryResults = ({
  ownerId,
  report,
  weekly,
  trend,
  updateParams,
}: {
  ownerId: string;
  report: MetricsReport;
  weekly: boolean;
  trend: string | null;
  updateParams: UpdateFilters;
}) => {
  const window = report.window;
  const query = useQuery({
    queryKey: [...checkInKey(ownerId), window?.start, window?.end],
    queryFn: ({ signal }) => listCheckIns(window!, signal),
    enabled: !!window,
    retry: false,
  });
  const selected = new Set(trend === null ? ["sleepHours"] : trend.split(","));
  const selectedNumeric = numericTrends.filter(({ key }) => selected.has(key));
  const selectedChoices = nutritionChoices.filter(({ key }) => selected.has(key));
  const entries = query.data ?? [];
  const chartPeriods = weekly ? report.days : report.periods;
  const chartBuckets = chartPeriods.flatMap(({ label, window }) =>
    window
      ? [
          {
            label:
              label ||
              formatDate(parseDate(window.start)!, {
                month: "short",
                day: "numeric",
                year: "2-digit",
              }),
            entries: entries.filter(({ date }) => date >= window.start && date <= window.end),
          },
        ]
      : [],
  );
  const units = [...new Set(selectedNumeric.map(({ unit }) => unit))];

  if (!window) return <Notice>No dates are available for this report.</Notice>;

  return (
    <Stack gap="4">
      <Panel as="section">
        <Heading as="h2" size="md">
          Check-in trends
        </Heading>
        <Stack as="fieldset" gap="2">
          <Text as="legend" fontWeight="medium" fontSize="sm">
            Metrics to chart
          </Text>
          <Flex gapX="4" gapY="2" wrap="wrap">
            {trendOptions.map(({ key, label }) => (
              <Checkbox.Root
                key={key}
                size="sm"
                checked={selected.has(key)}
                onCheckedChange={({ checked }) => {
                  const keys = trendOptions
                    .filter((option) =>
                      option.key === key ? checked === true : selected.has(option.key),
                    )
                    .map(({ key }) => key)
                    .join(",");
                  updateParams({ trend: keys === "sleepHours" ? null : keys });
                }}
              >
                <Checkbox.HiddenInput />
                <Checkbox.Control />
                <Checkbox.Label>{label}</Checkbox.Label>
              </Checkbox.Root>
            ))}
          </Flex>
        </Stack>
        {query.isPending && <Notice role="status">Loading check-ins…</Notice>}
        {query.isError && (
          <Stack align="start">
            <Notice role="alert">{errorMessage(query.error, "Unable to load check-ins.")}</Notice>
            <Button size="sm" variant="outline" onClick={() => void query.refetch()}>
              Retry
            </Button>
          </Stack>
        )}
        {query.data && !entries.length && <Notice>No check-ins in this date range.</Notice>}
        {query.data && entries.length > 0 && (
          <Stack gap="4">
            <Text color="fg.muted" fontSize="sm">
              {weekly ? "Daily measurements" : "Averages use days with a recorded value."}
            </Text>
            {!units.length && !selectedChoices.length && <Notice>Select metrics to chart.</Notice>}
            {units.map((unit) => {
              const metrics = selectedNumeric.filter((metric) => metric.unit === unit);
              const title = metrics.length === 1 ? metrics[0].label : "Check-in ratings (1–5)";
              return (
                <Stack key={unit} gap="2">
                  <Heading as="h3" size="sm">
                    {title}
                  </Heading>
                  <MetricPlot
                    title={title}
                    unit={unit}
                    ceiling={unit === "/ 5" ? 5 : undefined}
                    line
                    series={metrics.map(({ key, label }, index) => ({
                      name: key,
                      label,
                      color: colors[index],
                    }))}
                    data={chartBuckets.map(({ label, entries }) => ({
                      label,
                      ...Object.fromEntries(
                        metrics.map(({ key }) => [key, summarize(entries, key).mean]),
                      ),
                    }))}
                  />
                </Stack>
              );
            })}
            {selectedChoices.map(({ key, label, choices }) => (
              <Stack key={key} gap="2">
                <Heading as="h3" size="sm">
                  {label}
                </Heading>
                <MetricPlot
                  title={label}
                  unit="days"
                  series={choices.map(({ label, value }, index) => ({
                    name: value,
                    label,
                    color: colors[index],
                  }))}
                  data={chartBuckets.map(({ label, entries }) => {
                    const responses = entries
                      .map((entry) => entry[key])
                      .filter((value) => value != null);
                    return {
                      label,
                      ...Object.fromEntries(
                        choices.map(({ value }) => [
                          value,
                          responses.length
                            ? responses.filter((response) => response === value).length
                            : null,
                        ]),
                      ),
                    };
                  })}
                />
              </Stack>
            ))}
          </Stack>
        )}
      </Panel>
      <Panel as="section">
        <Heading as="h2" size="md">
          Check-in breakdown
        </Heading>
        <Table.ScrollArea>
          <Table.Root size="sm" aria-label="Check-in coverage and training totals">
            <Table.Header>
              <Table.Row>
                <Table.ColumnHeader scope="col">Period</Table.ColumnHeader>
                <Table.ColumnHeader scope="col">Check-ins</Table.ColumnHeader>
                <Table.ColumnHeader scope="col">Nutrition days</Table.ColumnHeader>
                <Table.ColumnHeader scope="col">Scheduled sessions</Table.ColumnHeader>
                <Table.ColumnHeader scope="col">Planned time</Table.ColumnHeader>
                <Table.ColumnHeader scope="col">Actual time</Table.ColumnHeader>
                <Table.ColumnHeader scope="col">Load</Table.ColumnHeader>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {report.periods.map(({ id, label, window, compliance, load, measuredLoad }) => {
                if (!window) return null;
                const recorded = entries.filter(
                  ({ date }) => date >= window.start && date <= window.end,
                );
                return (
                  <Table.Row key={id}>
                    <Table.Cell as="th" scope="row">
                      {label && <Text>{label}</Text>}
                      <Text whiteSpace="nowrap">
                        {shortDate(window.start)} – {shortDate(window.end)}
                      </Text>
                    </Table.Cell>
                    <Table.Cell>{query.data ? recorded.length : "—"}</Table.Cell>
                    <Table.Cell>
                      {query.data
                        ? recorded.filter((entry) => hasCheckInResponse(entry, checkInSections[1]))
                            .length
                        : "—"}
                    </Table.Cell>
                    <Table.Cell>{compliance.scheduled}</Table.Cell>
                    <Table.Cell>{hours(compliance.plannedMinutes)}</Table.Cell>
                    <Table.Cell>
                      {hours(compliance.actualMinutes)}
                      {compliance.completed > 0 && (
                        <Text fontSize="xs" color="fg.muted">
                          {compliance.measuredCompletions}/{compliance.completed} measured
                        </Text>
                      )}
                    </Table.Cell>
                    <Table.Cell>
                      {load === null ? "—" : loadPoints(load)}
                      {compliance.completed > 0 && (
                        <Text fontSize="xs" color="fg.muted">
                          {measuredLoad}/{compliance.completed} measured
                        </Text>
                      )}
                    </Table.Cell>
                  </Table.Row>
                );
              })}
            </Table.Body>
          </Table.Root>
        </Table.ScrollArea>
        <DailyDetails entries={entries} />
      </Panel>
      <FoodNutritionMetrics report={report} weekly={weekly} />
    </Stack>
  );
};
