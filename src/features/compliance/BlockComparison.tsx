import { Button, Flex, Grid, Heading, NativeSelect, Stack, Text } from "@chakra-ui/react";
import { useQuery } from "@tanstack/react-query";
import { useId, useState } from "react";
import { Disclosure, FormField, Notice, Panel } from "../../components/ui";
import { apiRequest, errorMessage } from "../../lib/api/request";
import type { ProgramSummary } from "../programs/programs";
import type { DurationUnit } from "../recovery/recovery";
import { MetricPlot, plotColors } from "./MetricPlot";
import { metricValues, plotMetricUnit, plotMetricValue, windowLabel } from "./MetricsCharts";
import { metricKeys, metricLabels, metricsKey } from "./metrics";
import type { ComparedBlock, Metric, MetricsPeriod, MetricsReport } from "./metrics";

type UpdateParams = (changes: Record<string, string | null>) => void;

const PickBlock = ({
  ownerId,
  side,
  params,
  programs,
  updateParams,
}: {
  ownerId: string;
  side: "left" | "right";
  params: URLSearchParams;
  programs: ProgramSummary[];
  updateParams: UpdateParams;
}) => {
  const id = useId();
  const programKey = `${side}Program`;
  const blockKey = `${side}Block`;
  const program = params.get(programKey) ?? "";
  const block = params.get(blockKey) ?? "";
  const validProgram = programs.some(({ id }) => id === program);
  const filters = new URLSearchParams({ view: "program", program });
  const report = useQuery({
    queryKey: [...metricsKey(ownerId), "program", program, filters.toString()],
    queryFn: ({ signal }) =>
      apiRequest<MetricsReport>(`/api/paideuo/metrics?${filters}`, "GET", undefined, signal),
    enabled: validProgram,
    retry: false,
  });
  const blocks = report.data?.blocks ?? [];

  return (
    <Panel>
      <Heading size="sm">{side === "left" ? "First block" : "Second block"}</Heading>
      <FormField as="div">
        <label htmlFor={`${id}-program`}>Program</label>
        <NativeSelect.Root>
          <NativeSelect.Field
            id={`${id}-program`}
            value={program}
            onChange={({ target }) =>
              updateParams({ [programKey]: target.value || null, [blockKey]: null })
            }
          >
            <option value="">Select a program</option>
            {program && !validProgram && <option value={program}>Program unavailable</option>}
            {programs.map(({ id, name, status }) => (
              <option key={id} value={id}>
                {name} ({status})
              </option>
            ))}
          </NativeSelect.Field>
          <NativeSelect.Indicator />
        </NativeSelect.Root>
      </FormField>
      <FormField as="div">
        <label htmlFor={`${id}-block`}>Block</label>
        <NativeSelect.Root disabled={!report.isSuccess || !validProgram}>
          <NativeSelect.Field
            id={`${id}-block`}
            value={block}
            onChange={({ target }) => updateParams({ [blockKey]: target.value || null })}
          >
            <option value="">
              {validProgram && report.isPending ? "Loading blocks…" : "Select a block"}
            </option>
            {block && !blocks.some(({ id }) => id === block) && (
              <option value={block}>
                {report.isPending && validProgram ? "Loading selection…" : "Block unavailable"}
              </option>
            )}
            {blocks.map(({ id, label }) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </NativeSelect.Field>
          <NativeSelect.Indicator />
        </NativeSelect.Root>
      </FormField>
      {report.isError && (
        <Stack align="start">
          <Notice role="alert">{errorMessage(report.error, "Unable to load blocks.")}</Notice>
          <Button size="sm" onClick={() => void report.refetch()}>
            Retry loading blocks
          </Button>
        </Stack>
      )}
      {report.isSuccess && !blocks.length && <Notice>No blocks available.</Notice>}
    </Panel>
  );
};

const PeriodMetrics = ({ period, unit }: { period: MetricsPeriod; unit: DurationUnit }) => (
  <Stack gap="3" as="dl">
    {metricKeys
      .filter((metric) => metric !== "intensity")
      .map((metric) => {
        const dateBased =
          metric === "sleep" ||
          metric === "fatigue" ||
          metric === "soreness" ||
          metric === "nutrition";
        return (
          <Stack key={metric} gap="1">
            <Text as="dt" fontWeight="semibold">
              {metricLabels[metric]}
            </Text>
            {dateBased && !period.window ? (
              <Text as="dd">Date window unavailable</Text>
            ) : (
              metricValues(metric, period, unit).map(({ label, display, coverage }) => (
                <Text key={label} as="dd" fontSize="sm">
                  {label} · {display}
                  {coverage && ` · ${coverage}`}
                </Text>
              ))
            )}
            {metric === "nutrition" && period.window && (
              <Text as="dd" fontSize="sm">
                {Object.values(period.nutrition).reduce((sum, count) => sum + count, 0)} days
                recorded
              </Text>
            )}
          </Stack>
        );
      })}
  </Stack>
);

const columns = { base: "minmax(0, 1fr)", md: "repeat(2, minmax(0, 1fr))" };
const comparisonMetrics = metricKeys.filter((metric) => metric !== "intensity");
const isRecoveryMetric = (metric: Metric) =>
  metric === "sleep" || metric === "fatigue" || metric === "soreness" || metric === "nutrition";

const ComparisonCharts = ({
  blocks,
  positions,
  unit,
}: {
  blocks: [ComparedBlock, ComparedBlock];
  positions: number[];
  unit: DurationUnit;
}) => {
  const id = useId();
  const [metric, setMetric] = useState<Metric>("duration");
  const measurements = (period: MetricsPeriod) => {
    if (isRecoveryMetric(metric) && !period.window) return [];
    return metricValues(metric, period, unit).flatMap(({ label, value, detailOnly }) =>
      detailOnly || label === "Recorded responses"
        ? []
        : [
            {
              label,
              value:
                label === "Adherence"
                  ? period.compliance.adherence === null
                    ? null
                    : period.compliance.adherence * 100
                  : plotMetricValue(metric, value, unit),
            },
          ],
    );
  };
  const totals = blocks.map(measurements);
  const weeks = positions.map((position) => ({
    label: `Week ${position}`,
    values: blocks.map(({ weeks }) => {
      const matching = weeks.filter((entry) => entry.position === position);
      const week = matching.find((entry) => entry.window) ?? matching[0];
      return week ? measurements(week) : [];
    }),
  }));
  const series = blocks.map(({ label }, index) => ({
    name: index === 0 ? "first" : "second",
    label: `${index === 0 ? "First" : "Second"} · ${label}`,
    color: plotColors[index],
  }));
  const labels = [
    ...new Set(
      [...totals, ...weeks.flatMap(({ values }) => values)].flatMap((values) =>
        values.map(({ label }) => label),
      ),
    ),
  ];
  const valueFor = (values: ReturnType<typeof measurements> | undefined, label: string) =>
    values?.find((measurement) => measurement.label === label)?.value ?? null;
  const measures = labels.filter((label) => label !== "Adherence");
  const measureUnit = plotMetricUnit(metric, unit);
  return (
    <Stack gap="4">
      <Panel as="section">
        <Flex justify="space-between" align="end" wrap="wrap" gap="3">
          <Heading as="h2" size="md">
            Block totals
          </Heading>
          <FormField as="div" maxW="sm" flex="1 1 15rem">
            <label htmlFor={id}>Compare metric</label>
            <NativeSelect.Root>
              <NativeSelect.Field
                id={id}
                value={metric}
                onChange={({ target }) => {
                  const selected = comparisonMetrics.find((key) => key === target.value);
                  if (selected) setMetric(selected);
                }}
              >
                {comparisonMetrics.map((key) => (
                  <option key={key} value={key}>
                    {metricLabels[key]}
                  </option>
                ))}
              </NativeSelect.Field>
              <NativeSelect.Indicator />
            </NativeSelect.Root>
          </FormField>
        </Flex>
        <MetricPlot
          title={`${metricLabels[metric]} block totals`}
          data={measures.map((label) => ({
            label,
            first: valueFor(totals[0], label),
            second: valueFor(totals[1], label),
          }))}
          series={series}
          unit={measureUnit}
        />
        {metric === "completion" && (
          <MetricPlot
            title="Block adherence"
            data={[
              {
                label: "Adherence",
                first: valueFor(totals[0], "Adherence"),
                second: valueFor(totals[1], "Adherence"),
              },
            ]}
            series={series}
            unit="%"
            ceiling={100}
          />
        )}
      </Panel>
      {weeks.length > 0 && (
        <Panel as="section">
          <Heading as="h2" size="md">
            Week-by-week comparison
          </Heading>
          {labels.length === 0 && <Notice>No measurements to chart.</Notice>}
          {labels.map((label) => (
            <Stack key={label} gap="2">
              <Heading as="h3" size="sm">
                {label}
              </Heading>
              <MetricPlot
                title={`Weekly ${label} by block`}
                data={weeks.map(({ label: week, values }) => ({
                  label: week,
                  first: valueFor(values[0], label),
                  second: valueFor(values[1], label),
                }))}
                series={series}
                unit={label === "Adherence" ? "%" : measureUnit}
                ceiling={label === "Adherence" ? 100 : undefined}
                line={isRecoveryMetric(metric) && metric !== "nutrition"}
              />
            </Stack>
          ))}
        </Panel>
      )}
    </Stack>
  );
};

export const BlockComparison = ({
  ownerId,
  params,
  programs,
  updateParams,
  unit,
}: {
  ownerId: string;
  params: URLSearchParams;
  programs: ProgramSummary[];
  updateParams: UpdateParams;
  unit: DurationUnit;
}) => {
  const historical = programs.filter(
    ({ scheduled, status }) => scheduled && (status === "completed" || status === "archived"),
  );
  const filters = new URLSearchParams({ view: "compare" });
  for (const key of ["leftProgram", "leftBlock", "rightProgram", "rightBlock"]) {
    const value = params.get(key);
    if (value) filters.set(key, value);
  }
  const complete = filters.size === 5;
  const duplicate = complete && filters.get("leftBlock") === filters.get("rightBlock");
  const report = useQuery({
    queryKey: [...metricsKey(ownerId), "compare", filters.toString()],
    queryFn: ({ signal }) =>
      apiRequest<[ComparedBlock, ComparedBlock]>(
        `/api/paideuo/metrics?${filters}`,
        "GET",
        undefined,
        signal,
      ),
    enabled: complete && !duplicate,
    retry: false,
  });
  const positions = [
    ...new Set(report.data?.flatMap(({ weeks }) => weeks.map(({ position }) => position))),
  ].sort((a, b) => a - b);

  return (
    <Stack gap="4">
      {!historical.length && (
        <Notice>Complete or archive a scheduled program to compare its blocks.</Notice>
      )}
      <Grid templateColumns={columns} gap="3">
        <PickBlock {...{ ownerId, params, updateParams }} programs={historical} side="left" />
        <PickBlock {...{ ownerId, params, updateParams }} programs={historical} side="right" />
      </Grid>
      {duplicate && <Notice>Choose two distinct blocks.</Notice>}
      {complete && !duplicate && report.isPending && (
        <Notice role="status">Loading comparison…</Notice>
      )}
      {report.isError && (
        <Stack align="start">
          <Notice role="alert">{errorMessage(report.error, "Unable to compare blocks.")}</Notice>
          <Button size="sm" onClick={() => void report.refetch()}>
            Retry comparison
          </Button>
        </Stack>
      )}
      {report.data && (
        <>
          <ComparisonCharts blocks={report.data} positions={positions} unit={unit} />
          <Disclosure label="Detailed block totals">
            <Grid templateColumns={columns} gap="3">
              {report.data.map((block, index) => (
                <Panel key={block.id}>
                  <Heading size="sm">
                    {index === 0 ? "First" : "Second"} block · {block.label}
                  </Heading>
                  <Text>
                    {block.durationWeeks === null
                      ? "Duration unavailable"
                      : `${block.durationWeeks} weeks`}
                  </Text>
                  {block.window && <Text fontSize="sm">{windowLabel(block.window)}</Text>}
                  <PeriodMetrics period={block} unit={unit} />
                </Panel>
              ))}
            </Grid>
          </Disclosure>
          {!!positions.length && (
            <Disclosure label="Detailed weekly totals">
              <Stack gap="4">
                {positions.map((position) => (
                  <Panel key={position}>
                    <Heading size="sm">Week {position}</Heading>
                    <Grid templateColumns={columns} gap="3">
                      {report.data.map(({ id, label, weeks }, index) => {
                        const matchingWeeks = weeks.filter((entry) => entry.position === position);
                        return (
                          <Stack key={id} minW="0" gap="2">
                            <Heading size="xs">
                              {index === 0 ? "First" : "Second"} block · {label}
                            </Heading>
                            {!matchingWeeks.length && <Text>No data for this week</Text>}
                            {matchingWeeks.map((week) => (
                              <Stack key={week.id} gap="2">
                                <Text fontSize="sm">{week.label}</Text>
                                {week.window && (
                                  <Text fontSize="sm">{windowLabel(week.window)}</Text>
                                )}
                                <PeriodMetrics period={week} unit={unit} />
                              </Stack>
                            ))}
                          </Stack>
                        );
                      })}
                    </Grid>
                  </Panel>
                ))}
              </Stack>
            </Disclosure>
          )}
        </>
      )}
    </Stack>
  );
};
