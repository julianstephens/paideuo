import { Box, Stack, Text } from "@chakra-ui/react";
import { NumericChange } from "../../components/ComparisonChange";
import type { DurationUnit } from "../recovery/recovery";
import type { ComplianceTotals } from "./compliance";

export const MetricBar = ({
  value,
  max,
  muted = false,
}: {
  value: number | null;
  max: number;
  muted?: boolean;
}) => (
  <Box
    as="span"
    display="block"
    aria-hidden="true"
    h="1.5"
    bg="bg.inset"
    borderRadius="xs"
    overflow="hidden"
  >
    {value !== null && max > 0 && (
      <Box
        as="span"
        display="block"
        h="full"
        w={`${(value / max) * 100}%`}
        bg={muted ? "fg.muted" : "teal.solid"}
      />
    )}
  </Box>
);

export const DurationComparison = ({
  total,
  unit = "hours",
}: {
  total: ComplianceTotals;
  unit?: DurationUnit;
}) => {
  const convert = (minutes: number | null) =>
    minutes === null ? null : unit === "hours" ? minutes / 60 : minutes;
  return (
    <Stack gap="2">
      <NumericChange
        label="Duration · planned to measured actual"
        first={convert(total.plannedMinutes)}
        second={convert(total.actualMinutes)}
        unit={unit === "hours" ? "h" : "min"}
        comparable={
          total.specifiedDurations === total.scheduled &&
          total.measuredCompletions === total.completed &&
          total.pending === 0 &&
          total.unresolved === 0
        }
      />
      <Text fontSize="xs" color="fg.muted">
        {total.specifiedDurations} of {total.scheduled} scheduled durations specified ·{" "}
        {total.measuredCompletions} of {total.completed} completions measured
      </Text>
    </Stack>
  );
};
