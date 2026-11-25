import { Badge, Button, Box, Flex, Grid, Heading, Link, Stack, Text } from "@chakra-ui/react";
import { useState } from "react";
import { Link as RouterLink } from "react-router";
import { comparisonDelta } from "../../components/ComparisonChange";
import { Disclosure, Notice, Panel } from "../../components/ui";
import { formatDate, parseDate } from "../calendar/dates";
import type { DurationUnit, Preferences } from "../recovery/recovery";
import { FoodNutritionMetrics } from "./FoodNutritionMetrics";
import { MetricBar } from "./MetricBars";
import { MetricPlot, plotColors } from "./MetricPlot";
import type { PlotPoint } from "./MetricPlot";
import { hours, loadPoints, percent } from "./format";
import { isCheckInMetric, isNutritionMeasurement, metricKeys, metricLabels } from "./metrics";
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

const nutritionDetails = {
  calories: {
    unit: "kcal",
    label: "Daily average",
    description: "Average calories from manual check-ins with a recorded value.",
  },
  proteinGrams: {
    unit: "g",
    label: "Daily average",
    description: "Average protein from manual check-ins with a recorded value.",
  },
  morningWeightKg: {
    unit: "kg",
    label: "Average reading",
    description: "Average of recorded morning weigh-ins.",
  },
  mealTiming: {
    unit: "days",
    label: "Days logged",
    description: "Number of days with meal timing recorded.",
  },
  skippedMeals: {
    unit: "meals",
    label: "Total",
    description:
      "Sum of skipped meals across days with a recorded count. An explicit zero counts as a measurement.",
  },
  hunger: {
    unit: "/ 5",
    label: "Daily average",
    description: "Average hunger rating across days with a recorded value.",
  },
  digestion: {
    unit: "/ 5",
    label: "Daily average",
    description: "Average digestion rating across days with a recorded value.",
  },
  energy: {
    unit: "/ 5",
    label: "Daily average",
    description: "Average energy rating across days with a recorded value.",
  },
  trainingRecovery: {
    unit: "/ 5",
    label: "Daily average",
    description: "Average training recovery rating across days with a recorded value.",
  },
} satisfies Record<
  keyof MetricsTotal["nutritionMeasurements"],
  { unit: string; label: string; description: string }
>;

const descriptions: Record<Exclude<Metric, keyof typeof nutritionDetails>, string> = {
  duration:
    "Training duration sums planned session durations and actual durations from completed sessions. Aerobic plans use classified components across scheduled sessions. Recorded aerobic duration and coverage use completed sessions.",
  load: "Sum of actual minutes × session RPE for completed sessions with both measurements.",
  completion:
    "Adherence is completed ÷ (completed + skipped). Pending and unresolved sessions are shown separately.",
  sleep: "Average recorded sleep duration per day.",
  fatigue: "Average recorded fatigue rating on a 1–5 scale.",
  soreness: "Average recorded soreness rating on a 1–5 scale.",
  nutrition: "Number of recorded days in each self-reported adequacy category.",
  intensity: "Scheduled session count by planned intensity, including unspecified intensity.",
};

type Value = {
  label: string;
  value: number | null;
  display: string;
  coverage?: string;
  detailOnly?: boolean;
};
export const metricValues = (metric: Metric, total: MetricsTotal, unit: DurationUnit): Value[] => {
  const { compliance, recovery, nutrition, load, measuredLoad } = total;
  if (isNutritionMeasurement(metric)) {
    const { value, count: recorded } = total.nutritionMeasurements?.[metric] ?? {
      value: null,
      count: 0,
    };
    const details = nutritionDetails[metric];
    const unit =
      value === 1 && (metric === "mealTiming" || metric === "skippedMeals")
        ? details.unit.slice(0, -1)
        : details.unit;
    return [
      {
        label: details.label,
        value,
        display: value === null ? noData : `${count(value)} ${unit}`,
        coverage:
          metric === "mealTiming"
            ? undefined
            : `${recorded} ${recorded === 1 ? "day" : "days"} recorded`,
      },
    ];
  }
  switch (metric) {
    case "duration":
      const aerobicDuration = (label: string, value: number | null, detailOnly = false) => ({
        label,
        value,
        display: duration(value, unit),
        detailOnly,
      });
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
        aerobicDuration("Planned aerobic", compliance.plannedAerobicMinutes),
        {
          label: "Actual aerobic",
          coverage: `${compliance.aerobicCoverage.measured}/${compliance.aerobicCoverage.specified} aerobic components measured in completed sessions`,
          value: compliance.aerobicMinutes,
          display: duration(compliance.aerobicMinutes, unit),
        },
        aerobicDuration("Planned running", compliance.plannedRunningMinutes, true),
        aerobicDuration("Actual running", compliance.actualRunningMinutes, true),
        aerobicDuration("Planned walking", compliance.plannedWalkingMinutes, true),
        aerobicDuration("Actual walking", compliance.actualWalkingMinutes, true),
        aerobicDuration("Longest planned work bout", compliance.plannedContinuousBoutMinutes, true),
        aerobicDuration("Longest recorded bout", compliance.actualContinuousBoutMinutes, true),
        ...Object.entries(compliance.aerobicByModality).map(([modality, value]) =>
          aerobicDuration(`Actual aerobic · ${modality}`, value, true),
        ),
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

export const plotMetricValue = (metric: Metric, value: number | null, unit: DurationUnit) => {
  if (value === null) return null;
  if (metric === "duration" && unit === "hours") return value / 60;
  if (metric === "sleep" && unit === "minutes") return value * 60;
  return value;
};

export const plotMetricUnit = (metric: Metric, unit: DurationUnit) => {
  if (metric === "duration" || metric === "sleep") return unit === "hours" ? "hr" : "min";
  if (metric === "load") return "load points";
  if (isNutritionMeasurement(metric)) return nutritionDetails[metric].unit;
  if (metric === "fatigue" || metric === "soreness") return "/ 5";
};

const summaryTitle: Partial<Record<Metric, string>> = {
  duration: "Training duration",
  completion: "Session adherence",
  load: "Training load",
};

const highlights: Partial<Record<Metric, string>> = {
  duration: "Actual",
  completion: "Adherence",
  load: "Total",
  sleep: "Daily average",
  fatigue: "Daily average",
  soreness: "Daily average",
};

const SummaryCard = ({
  metric,
  total,
  unit,
}: {
  metric: Metric;
  total: MetricsTotal;
  unit: DurationUnit;
}) => {
  const values = metricValues(metric, total, unit);
  const primary = values.find(
    ({ label }) =>
      label ===
      (isNutritionMeasurement(metric) ? nutritionDetails[metric].label : highlights[metric]),
  );
  const supporting = values.filter((value) => !value.detailOnly && value !== primary);
  const distribution = metric === "intensity" || metric === "nutrition";
  const population = distribution
    ? supporting.reduce((sum, { value }) => sum + (value ?? 0), 0)
    : 0;

  return (
    <Panel as="article" p="4" gap="3">
      <Heading as="h3" size="sm">
        {summaryTitle[metric] ?? metricLabels[metric]}
      </Heading>
      <Stack as="dl" gap="2">
        {primary && (
          <Box>
            <Text as="dt" fontSize="xs" color="fg.muted" srOnly={metric === "completion"}>
              {primary.label}
            </Text>
            <Text
              as="dd"
              fontSize={
                primary.display === noData || primary.display === noResolvedSessions ? "sm" : "2xl"
              }
              lineHeight="short"
              fontWeight="bold"
            >
              {primary.display}
            </Text>
            {metric === "completion" && <MetricBar value={total.compliance.adherence} max={1} />}
          </Box>
        )}
        {supporting.map(({ label, display, value }) => (
          <Box key={label}>
            <Flex gap="2" justify="space-between" align="baseline" fontSize="sm">
              <Text as="dt" color="fg.muted">
                {label}
              </Text>
              <Text as="dd" textAlign="end" fontWeight="semibold">
                {display}
              </Text>
            </Flex>
            {population > 0 && <MetricBar value={value} max={population} />}
          </Box>
        ))}
      </Stack>
    </Panel>
  );
};

const SummaryGrid = ({
  metrics,
  total,
  unit,
}: {
  metrics: Metric[];
  total: MetricsTotal;
  unit: DurationUnit;
}) => (
  <Grid
    gap="3"
    templateColumns={{
      base: "minmax(0, 1fr)",
      sm: `repeat(${Math.min(metrics.length, 2)}, minmax(0, 1fr))`,
      xl: `repeat(${metrics.length}, minmax(0, 1fr))`,
    }}
  >
    {metrics.map((metric) => (
      <SummaryCard key={metric} metric={metric} total={total} unit={unit} />
    ))}
  </Grid>
);

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
  const [showTotalsOverride, setShowTotals] = useState<boolean>();
  const { durationUnit, hiddenSummary, hiddenCharts } = preferences;
  const shown = metricKeys.filter((metric) => !hiddenCharts.includes(metric));
  const chart = selected ?? shown.find((metric) => metric === "duration") ?? shown[0];
  const summaries = metricKeys.filter((metric) => {
    const visible =
      (!selected || metric === selected) &&
      (weekly ? !hiddenSummary.includes(metric) : shown.includes(metric));
    return (
      visible &&
      (!isNutritionMeasurement(metric) ||
        selected === metric ||
        !!report.total.nutritionMeasurements?.[metric]?.count)
    );
  });
  const showTotals = showTotalsOverride ?? (!!chart && isNutritionMeasurement(chart));
  const periods = chart && weekly && isCheckInMetric(chart) ? report.days : report.periods;
  const rows = chart
    ? periods.map((period) => ({ period, measurements: metricValues(chart, period, durationUnit) }))
    : [];
  const series = [
    ...new Set(
      rows.flatMap(({ measurements }) =>
        measurements
          .filter(
            ({ label, detailOnly }) =>
              !detailOnly && label !== "Adherence" && label !== "Recorded responses",
          )
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
  const showChanges = plotData.length > 1 && !showTotals;
  const trendData = showChanges
    ? plotData.slice(1).map((point, index) => ({
        label: point.label,
        ...Object.fromEntries(
          [...series.map(({ name }) => name), "adherence"].map((name) => {
            const before = plotData[index][name];
            const after = point[name];
            return [
              name,
              comparisonDelta(
                typeof before === "number" ? before : null,
                typeof after === "number" ? after : null,
              ),
            ];
          }),
        ),
      }))
    : plotData;
  const training = summaries.filter((metric) => !isCheckInMetric(metric));
  const recovery = summaries.filter(isCheckInMetric);
  const coverage = summaries.flatMap((metric) =>
    metricValues(metric, report.total, durationUnit).flatMap(({ label, coverage }) =>
      coverage ? [{ metric, label, coverage }] : [],
    ),
  );

  return (
    <Stack gap={{ base: "5", md: "7" }}>
      {training.length > 0 && (
        <Stack as="section" gap="3">
          <Flex align="baseline" justify="space-between" gap="2" wrap="wrap">
            <Heading as="h2" size="md">
              {weekly ? "Weekly training" : "Training totals"}
            </Heading>
            {report.window && <Badge variant="surface">{windowLabel(report.window)}</Badge>}
          </Flex>
          <SummaryGrid metrics={training} total={report.total} unit={durationUnit} />
        </Stack>
      )}
      {report.unassigned > 0 && (
        <Notice>{report.unassigned} unassigned sessions are included in program totals.</Notice>
      )}
      {chart ? (
        <Panel as="section">
          <Heading as="h2" size="md">
            {weekly && isCheckInMetric(chart) ? "Daily breakdown" : "Period comparison"}
          </Heading>
          {plotData.length > 1 && (
            <Flex gap="1" wrap="wrap" role="group" aria-label="Chart values">
              <Button
                size="sm"
                variant={showChanges ? "solid" : "ghost"}
                aria-pressed={showChanges}
                onClick={() => setShowTotals(false)}
              >
                Change from prior period
              </Button>
              <Button
                size="sm"
                variant={showTotals ? "solid" : "ghost"}
                aria-pressed={showTotals}
                onClick={() => setShowTotals(true)}
              >
                Period values
              </Button>
            </Flex>
          )}
          {!rows.length && <Notice>No comparison periods available.</Notice>}
          {!!rows.length && (
            <>
              <MetricPlot
                title={showChanges ? `Change in ${metricLabels[chart]}` : metricLabels[chart]}
                data={trendData}
                signed={showChanges}
                series={series}
                unit={plotMetricUnit(chart, durationUnit)}
                line={
                  !showChanges &&
                  isCheckInMetric(chart) &&
                  !["nutrition", "mealTiming", "skippedMeals"].includes(chart)
                }
                ceiling={
                  !showChanges && plotMetricUnit(chart, durationUnit) === "/ 5" ? 5 : undefined
                }
              />
              {chart === "completion" && (
                <MetricPlot
                  title={showChanges ? "Change in session adherence" : "Session adherence"}
                  data={trendData}
                  signed={showChanges}
                  series={[{ name: "adherence", label: "Adherence", color: plotColors[0] }]}
                  unit={showChanges ? "percentage points" : "%"}
                  ceiling={showChanges ? undefined : 100}
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
                            {isCheckInMetric(chart) ? "Check-in dates " : ""}
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
          <Disclosure label="How this metric is calculated">
            <Text fontSize="sm" color="fg.muted">
              {isNutritionMeasurement(chart)
                ? nutritionDetails[chart].description
                : descriptions[chart]}
            </Text>
          </Disclosure>
        </Panel>
      ) : (
        <Notice>Enable dashboard charts in Settings to see comparisons.</Notice>
      )}
      {(recovery.length > 0 ||
        !!report.total.foodNutrition?.activePlanDays ||
        !!report.total.foodNutrition?.loggedDays) && (
        <Stack as="section" gap="3">
          <Flex align="baseline" justify="space-between" gap="2" wrap="wrap">
            <Heading as="h2" size="md">
              Recovery and nutrition
            </Heading>
            {training.length === 0 && report.window && (
              <Badge variant="surface">{windowLabel(report.window)}</Badge>
            )}
          </Flex>
          <SummaryGrid metrics={recovery} total={report.total} unit={durationUnit} />
          <FoodNutritionMetrics report={report} weekly={weekly} />
        </Stack>
      )}
      {coverage.length > 0 && (
        <Panel>
          <Disclosure label="Measurement coverage">
            <Stack as="ul" listStyleType="none" gap="2">
              {coverage.map(({ metric, label, coverage }) => (
                <Text key={`${metric}/${label}`} as="li" fontSize="sm">
                  <Text as="span" fontWeight="semibold">
                    {summaryTitle[metric] ?? metricLabels[metric]} · {label}
                  </Text>
                  {" · "}
                  {coverage}
                </Text>
              ))}
            </Stack>
          </Disclosure>
        </Panel>
      )}
      {reviewUrl && report.periods.length > 0 && (
        <Panel as="section">
          <Disclosure label="Weekly reviews">
            <Stack as="ul" listStyleType="none" gap="2">
              {report.periods.map((period) => (
                <li key={period.id}>
                  <Link asChild variant="underline">
                    <RouterLink to={reviewUrl(period.id)}>{period.label}</RouterLink>
                  </Link>
                </li>
              ))}
            </Stack>
          </Disclosure>
        </Panel>
      )}
    </Stack>
  );
};
