import { Heading, Stack, Table, Text } from "@chakra-ui/react";
import { Disclosure, Panel } from "../../components/ui";
import { formatDate, parseDate } from "../calendar/dates";
import { macroLabels, targetMacros } from "../nutrition/targets";
import type { FoodNutrition, MetricsReport } from "./metrics";

const number = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
const percentage = new Intl.NumberFormat(undefined, { style: "percent", maximumFractionDigits: 1 });
const valueLabel = (value: number | null) => (value === null ? "—" : number.format(value));
const dayLabel = (days: number) => `${days} ${days === 1 ? "day" : "days"}`;

type Measurement = FoodNutrition["macros"]["calories"]["planned"];
const MeasurementCell = ({
  value,
  daily,
}: {
  value: Omit<Measurement, "partialDays"> & { partialDays?: number };
  daily: boolean;
}) => (
  <Table.Cell textAlign="end" fontVariantNumeric="tabular-nums">
    {valueLabel(value.total)}
    {!daily && value.days > 0 && (
      <Text fontSize="xs" color="fg.muted">
        {valueLabel(value.average)}/day · {dayLabel(value.days)}
      </Text>
    )}
    {!!value.partialDays && (
      <Text fontSize="xs" color="fg.muted">
        {daily ? "Unknown macro values" : `${dayLabel(value.partialDays)} with unknown values`}
      </Text>
    )}
  </Table.Cell>
);

type NutritionRow = { label: string; summary: FoodNutrition; daily?: boolean };

const NutritionTable = ({
  rows,
  label,
  showPlan,
}: {
  rows: NutritionRow[];
  label: string;
  showPlan: boolean;
}) => (
  <Table.ScrollArea w="full">
    <Table.Root
      size="sm"
      aria-label={label}
      w="full"
      tableLayout="fixed"
      minW={showPlan ? "52rem" : undefined}
      css={{ "& th, & td": { verticalAlign: "top", overflowWrap: "anywhere" } }}
    >
      <Table.ColumnGroup>
        <Table.Column width={showPlan ? "8rem" : "29%"} />
        <Table.Column width={showPlan ? "10rem" : "35%"} />
      </Table.ColumnGroup>
      <Table.Header>
        <Table.Row>
          <Table.ColumnHeader scope="col">Period</Table.ColumnHeader>
          <Table.ColumnHeader scope="col">Macro</Table.ColumnHeader>
          <Table.ColumnHeader scope="col" textAlign="end">
            Food logs
          </Table.ColumnHeader>
          {showPlan && (
            <>
              <Table.ColumnHeader scope="col" textAlign="end">
                Planned food
              </Table.ColumnHeader>
              <Table.ColumnHeader scope="col" textAlign="end">
                Target
              </Table.ColumnHeader>
              <Table.ColumnHeader scope="col" textAlign="end">
                Target attainment
              </Table.ColumnHeader>
              <Table.ColumnHeader scope="col" textAlign="end">
                Actual minus planned
              </Table.ColumnHeader>
            </>
          )}
        </Table.Row>
      </Table.Header>
      {rows.map(({ label, summary, daily = false }) => (
        <Table.Body key={label}>
          {targetMacros.map((key, index) => {
            const { consumed, planned, target, attainment, planDifference } = summary.macros[key];
            return (
              <Table.Row key={key}>
                {index === 0 && (
                  <Table.Cell as="th" scope="rowgroup" rowSpan={targetMacros.length}>
                    {label}
                    {daily && (
                      <Text fontSize="xs" color="fg.muted">
                        {summary.loggedDays ? "Logged" : "No food logs"}
                      </Text>
                    )}
                  </Table.Cell>
                )}
                <Table.Cell as="th" scope="row">
                  {macroLabels[key]}
                </Table.Cell>
                <MeasurementCell value={consumed} daily={daily} />
                {showPlan && (
                  <>
                    <MeasurementCell value={planned} daily={daily} />
                    <MeasurementCell value={target} daily={daily} />
                    <Table.Cell textAlign="end" fontVariantNumeric="tabular-nums">
                      {attainment.ratio === null ? "—" : percentage.format(attainment.ratio)}
                      {!daily && attainment.days > 0 && (
                        <Text fontSize="xs" color="fg.muted">
                          {dayLabel(attainment.days)} matched
                        </Text>
                      )}
                    </Table.Cell>
                    <MeasurementCell value={planDifference} daily={daily} />
                  </>
                )}
              </Table.Row>
            );
          })}
        </Table.Body>
      ))}
    </Table.Root>
  </Table.ScrollArea>
);

export const FoodNutritionMetrics = ({
  report,
  weekly,
}: {
  report: MetricsReport;
  weekly: boolean;
}) => {
  const summary = report.total.foodNutrition;
  if (!summary || (!summary.loggedDays && !summary.activePlanDays)) return null;
  const showPlan = summary.activePlanDays > 0;
  const range = { label: "Selected range", summary };
  const dailyRows = (report.nutritionDays ?? []).map(({ date, foodNutrition }) => ({
    label: formatDate(parseDate(date)!, { month: "short", day: "numeric", year: "numeric" }),
    summary: foodNutrition,
    daily: true,
  }));
  return (
    <Panel>
      <Stack gap="3">
        <Heading as="h3" size="sm">
          Food totals
        </Heading>
        <Text fontSize="sm" color="fg.muted">
          Food logged on {summary.loggedDays} of {dayLabel(summary.days)}
          {showPlan && ` · Plan active on ${dayLabel(summary.activePlanDays)}`}
        </Text>
        <NutritionTable
          rows={weekly ? [range, ...dailyRows] : [range]}
          label={weekly ? "Selected range and daily food totals" : "Selected range food totals"}
          showPlan={showPlan}
        />
        {!weekly && dailyRows.length > 0 && (
          <Disclosure label="Daily food totals">
            <NutritionTable rows={dailyRows} label="Daily food totals" showPlan={showPlan} />
          </Disclosure>
        )}
      </Stack>
    </Panel>
  );
};
