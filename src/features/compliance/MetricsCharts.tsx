import { Flex, Grid, Heading, Link, NativeSelect, Stack, Text } from "@chakra-ui/react";
import { useState } from "react";
import { Link as RouterLink } from "react-router";
import { Disclosure, FormField, Notice, Panel } from "../../components/ui";
import { formatDate, parseDate } from "../calendar/dates";
import type { DurationUnit, Preferences } from "../recovery/recovery";
import { MetricPlot, plotColors } from "./MetricPlot";
import type { PlotPoint } from "./MetricPlot";
import { hours, loadPoints, percent } from "./format";
import { metricKeys, metricLabels } from "./metrics";
import type { Metric, MetricsPeriod, MetricsReport, MetricsTotal } from "./metrics";

const number = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
const noData = "No measurement";
const noResolvedSessions = "No resolved sessions";
const duration = (value: number | null, unit: DurationUnit) =>
  value === null ? noData : unit === "hours" ? hours(value) : `${number.format(value)} min`;
const count = (value: number | null) => (value === null ? noData : number.format(value));
const shortDate = (value: string) =>
  formatDate(parseDate(value)!, { month: "short", day: "numeric", year: "numeric" });
export const windowLabel = ({ start, end }: NonNullable<MetricsPeriod["window"]>) =>
  start === end ? shortDate(start) : `${shortDate(start)} – ${shortDate(end)}`;

const descriptions: Record<Metric, string> = {
  duration: "Sum of specified planned durations and recorded durations for completed sessions.",
  load: "Sum of actual minutes × session RPE for completed sessions with both measurements.",
  completion:
    "Adherence is completed ÷ (completed + skipped). Pending and unresolved sessions are shown separately.",
  sleep: "Average recorded sleep duration per day.",
  fatigue: "Average recorded fatigue rating on a 1–5 scale.",
  soreness: "Average recorded soreness rating on a 1–5 scale.",
  nutrition: "Number of recorded days in each self-reported adequacy category.",
  intensity: "Scheduled session count by planned intensity, including unspecified intensity.",
};

type Value = { label: string; value: number | null; display: string; coverage?: string };
export const metricValues = (metric: Metric, total: MetricsTotal, unit: DurationUnit): Value[] => {
  const { compliance, recovery, nutrition, load, measuredLoad } = total;
  switch (metric) {
    case "duration":
      return [
        {
          label: "Planned",
          coverage: `${compliance.specifiedDurations}/${compliance.scheduled} sessions specified`,
          value: compliance.plannedMinutes,
          display: duration(compliance.plannedMinutes, unit),
        },
        {
          label: "Actual",
          coverage: `${compliance.measuredCompletions}/${compliance.completed} completions measured`,
          value: compliance.actualMinutes,
          display: duration(compliance.actualMinutes, unit),
        },
        {
          label: "Aerobic",
          coverage: `${compliance.aerobicCoverage.measured}/${compliance.aerobicCoverage.specified} aerobic component outcomes measured`,
          value: compliance.aerobicMinutes,
          display: duration(compliance.aerobicMinutes, unit),
        },
      ];
    case "load":
      return [
        {
          label: "Total",
          coverage: `${measuredLoad}/${compliance.completed} completions measured`,
          value: load,
          display: load === null ? noData : loadPoints(load),
        },
      ];
    case "completion":
      return [
        ...(["completed", "skipped", "pending", "unresolved"] as const).map((status) => ({
          label: status[0].toUpperCase() + status.slice(1),
          value: compliance[status],
          display: count(compliance[status]),
        })),
        {
          label: "Adherence",
          value: null,
          display:
            compliance.adherence === null ? noResolvedSessions : percent(compliance.adherence),
        },
      ];
    case "sleep":
      return [
        {
          label: "Daily average",
          coverage: `${recovery.sleepHours.count} days recorded`,
          value: recovery.sleepHours.mean,
          display: duration(
            recovery.sleepHours.mean === null ? null : recovery.sleepHours.mean * 60,
            unit,
          ),
        },
      ];
    case "fatigue":
    case "soreness":
      return [
        {
          label: "Daily average",
          coverage: `${recovery[metric].count} days recorded`,
          value: recovery[metric].mean,
          display: recovery[metric].mean === null ? noData : `${count(recovery[metric].mean)} / 5`,
        },
      ];
    case "nutrition":
      if (!Object.values(nutrition).some(Boolean))
        return [{ label: "Recorded responses", value: null, display: noData }];
      return [
        { label: "Adequate", value: nutrition.adequate, display: count(nutrition.adequate) },
        {
          label: "Likely insufficient",
          value: nutrition.likely_insufficient,
          display: count(nutrition.likely_insufficient),
        },
        { label: "Unsure", value: nutrition.unsure, display: count(nutrition.unsure) },
      ];
    case "intensity":
      return Object.entries(compliance.intensity).map(([label, { sessions }]) => ({
        label: label[0].toUpperCase() + label.slice(1),
        value: sessions,
        display: count(sessions),
      }));
  }
};

const isRecovery = (metric: Metric) =>
  ["sleep", "fatigue", "soreness", "nutrition"].includes(metric);

export const plotMetricValue = (metric: Metric, value: number | null, unit: DurationUnit) => {
  if (value === null) return null;
  if (metric === "duration" && unit === "hours") return value / 60;
  if (metric === "sleep" && unit === "minutes") return value * 60;
  return value;
};

export const plotMetricUnit = (metric: Metric, unit: DurationUnit) => {
  if (metric === "duration" || metric === "sleep") return unit === "hours" ? "hr" : "min";
  if (metric === "load") return "load points";
  if (metric === "fatigue" || metric === "soreness") return "/ 5";
};

export const MetricsCharts = ({
  report,
  preferences,
  weekly,
  selected,
  reviewUrl,
}: {
  report: MetricsReport;
  preferences: Preferences;
  weekly: boolean;
  selected: Metric | null;
  reviewUrl?: (weekId: string) => string;
}) => {
  const [comparison, setComparison] = useState<Metric>("duration");
  const { durationUnit, hiddenSummary, hiddenCharts } = preferences;
  const shown = metricKeys.filter((metric) => !hiddenCharts.includes(metric));
  const chart = selected ?? shown.find((metric) => metric === comparison) ?? shown[0];
  const summaries = metricKeys.filter((metric) =>
    weekly
      ? !hiddenSummary.includes(metric)
      : shown.includes(metric) && (!selected || metric === selected),
  );
  const periods = chart && weekly && isRecovery(chart) ? report.days : report.periods;
  const rows = chart
    ? periods.map((period) => ({ period, measurements: metricValues(chart, period, durationUnit) }))
    : [];
  const series = [
    ...new Set(
      rows.flatMap(({ measurements }) =>
        measurements
          .filter(({ label }) => label !== "Adherence" && label !== "Recorded responses")
          .map(({ label }) => label),
      ),
    ),
  ].map((name, index) => ({ name, color: plotColors[index % plotColors.length] }));
  const plotData = rows.map(
    ({ period, measurements }, index) =>
      ({
        label:
          period.label ||
          (period.window
            ? formatDate(parseDate(period.window.start)!, { month: "short", day: "numeric" })
            : String(index + 1)),
        adherence: period.compliance.adherence === null ? null : period.compliance.adherence * 100,
        ...Object.fromEntries(
          measurements.map(({ label, value }) => [
            label,
            chart ? plotMetricValue(chart, value, durationUnit) : null,
          ]),
        ),
      }) as PlotPoint,
  );
  return (
    <Stack gap="4">
      {summaries.length > 0 && (
        <Stack as="section" gap="3">
          <Flex align="baseline" justify="space-between" gap="2" wrap="wrap">
            <Heading as="h2" size="md">
              {weekly ? "Weekly summary" : "Period totals"}
            </Heading>
            {report.window && (
              <Text fontSize="sm" color="fg.muted">
                {windowLabel(report.window)}
              </Text>
            )}
          </Flex>
          <Grid
            gap="3"
            templateColumns={{
              base: "minmax(0, 1fr)",
              sm: "repeat(2, minmax(0, 1fr))",
              xl: "repeat(4, minmax(0, 1fr))",
            }}
          >
            {summaries.map((metric) => (
              <Panel key={metric} as="article" p="4" gap="2.5">
                <Heading as="h3" size="md">
                  {metric === "duration"
                    ? "Training duration"
                    : metric === "completion"
                      ? "Completion and adherence"
                      : metricLabels[metric]}
                </Heading>
                <Stack as="dl" gap="1.5">
                  {metricValues(metric, report.total, durationUnit).map(
                    ({ label, display, coverage }) => {
                      const missing = display === noData || display === noResolvedSessions;
                      return (
                        <Grid
                          key={label}
                          templateColumns="minmax(0, 1fr) fit-content(58%)"
                          alignItems="baseline"
                          gapX="2"
                          fontSize="sm"
                        >
                          <Text as="dt" color="fg.muted">
                            {label}
                          </Text>
                          <Text
                            as="dd"
                            textAlign="end"
                            fontSize={missing ? "xs" : undefined}
                            fontWeight={missing ? "normal" : "semibold"}
                            fontVariantNumeric="tabular-nums"
                            color={missing ? "fg.muted" : undefined}
                          >
                            {display}
                          </Text>
                          {coverage && (
                            <Text as="dd" gridColumn="1 / -1" fontSize="xs" color="fg.muted">
                              {coverage}
                            </Text>
                          )}
                        </Grid>
                      );
                    },
                  )}
                </Stack>
              </Panel>
            ))}
          </Grid>
        </Stack>
      )}
      {report.unassigned > 0 && (
        <Notice>{report.unassigned} unassigned sessions are included in program totals.</Notice>
      )}
      {reviewUrl && report.periods.length > 0 && (
        <Panel as="section">
          <Heading as="h2" size="md">
            Weekly reviews
          </Heading>
          <Stack as="ul" listStyleType="none" gap="2">
            {report.periods.map((period) => (
              <li key={period.id}>
                <Link asChild variant="underline">
                  <RouterLink to={reviewUrl(period.id)}>Weekly review · {period.label}</RouterLink>
                </Link>
              </li>
            ))}
          </Stack>
        </Panel>
      )}
      {chart ? (
        <Panel as="section">
          <Flex
            align={{ base: "start", sm: "end" }}
            direction={{ base: "column", sm: "row" }}
            justify="space-between"
            gap="3"
          >
            <Heading as="h2" size="md">
              {weekly && isRecovery(chart) ? "Daily breakdown" : "Period comparison"}
            </Heading>
            {!selected && shown.length > 1 && (
              <FormField as="div" w="full" maxW="sm">
                <label htmlFor="metrics-comparison">Compare metric</label>
                <NativeSelect.Root>
                  <NativeSelect.Field
                    id="metrics-comparison"
                    value={chart}
                    onChange={({ target }) => {
                      const metric = metricKeys.find((key) => key === target.value);
                      if (metric) setComparison(metric);
                    }}
                  >
                    {shown.map((metric) => (
                      <option key={metric} value={metric}>
                        {metricLabels[metric]}
                      </option>
                    ))}
                  </NativeSelect.Field>
                  <NativeSelect.Indicator />
                </NativeSelect.Root>
              </FormField>
            )}
          </Flex>
          {(selected || shown.length === 1) && (
            <Heading as="h3" size="sm">
              {metricLabels[chart]}
            </Heading>
          )}
          <Disclosure label="How this metric is calculated">
            <Text fontSize="sm" color="fg.muted">
              {descriptions[chart]}
            </Text>
          </Disclosure>
          {!rows.length && <Notice>No comparison periods available.</Notice>}
          {!!rows.length && (
            <>
              <MetricPlot
                title={metricLabels[chart]}
                data={plotData}
                series={series}
                unit={plotMetricUnit(chart, durationUnit)}
                line={chart === "sleep" || chart === "fatigue" || chart === "soreness"}
                ceiling={chart === "fatigue" || chart === "soreness" ? 5 : undefined}
              />
              {chart === "completion" && (
                <MetricPlot
                  title="Session adherence"
                  data={plotData}
                  series={[{ name: "adherence", label: "Adherence", color: plotColors[0] }]}
                  unit="%"
                  ceiling={100}
                />
              )}
              <Disclosure label="Detailed values">
                <Stack gap="3">
                  {rows.map(({ period, measurements }) => (
                    <Grid
                      as="article"
                      key={period.id}
                      gap="3"
                      templateColumns={{
                        base: "minmax(0, 1fr)",
                        md: "minmax(0, 1fr) minmax(0, 3fr)",
                      }}
                      borderTopWidth="1px"
                      pt="3"
                    >
                      <Stack gap="1">
                        <Heading as="h3" size="sm">
                          {period.label || (period.window && windowLabel(period.window))}
                        </Heading>
                        {period.label && period.window && (
                          <Text fontSize="xs" color="fg.muted">
                            {isRecovery(chart) ? "Check-in dates " : ""}
                            {windowLabel(period.window)}
                          </Text>
                        )}
                      </Stack>
                      <Stack as="dl" gap="2">
                        {measurements.map(({ label, display, coverage }) => (
                          <Grid
                            key={label}
                            templateColumns="minmax(0, 1fr) auto"
                            gapX="3"
                            gapY="1"
                            fontSize="sm"
                          >
                            <Text as="dt">{label}</Text>
                            <Text
                              as="dd"
                              textAlign="end"
                              fontWeight="semibold"
                              fontVariantNumeric="tabular-nums"
                            >
                              {display}
                            </Text>
                            {coverage && (
                              <Text as="dd" gridColumn="1 / -1" fontSize="xs" color="fg.muted">
                                {coverage}
                              </Text>
                            )}
                          </Grid>
                        ))}
                      </Stack>
                    </Grid>
                  ))}
                </Stack>
              </Disclosure>
            </>
          )}
        </Panel>
      ) : (
        <Notice>Enable dashboard charts in Settings to see comparisons.</Notice>
      )}
    </Stack>
  );
};
