import { Box, Flex, Stack, Text } from "@chakra-ui/react";
import type { ComplianceTotals } from "./compliance";
import { hours } from "./format";

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
    borderRadius="full"
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

export const DurationComparison = ({ total }: { total: ComplianceTotals }) => {
  const max = Math.max(total.plannedMinutes ?? 0, total.actualMinutes ?? 0);
  return (
    <Stack gap="2" borderWidth="1px" borderRadius="md" p="3">
      {[
        { label: "Planned hours", value: total.plannedMinutes, muted: true },
        { label: "Measured actual hours", value: total.actualMinutes, muted: false },
      ].map(({ label, value, muted }) => (
        <Stack key={label} gap="1">
          <Flex justify="space-between" align="baseline" gap="2">
            <Text fontSize="sm" color="fg.muted">
              {label}
            </Text>
            <Text fontWeight="semibold">{hours(value)}</Text>
          </Flex>
          <MetricBar value={value} max={max} muted={muted} />
        </Stack>
      ))}
      <Text fontSize="xs" color="fg.muted">
        {total.specifiedDurations} of {total.scheduled} sessions have a planned duration
      </Text>
      <Text fontSize="xs" color="fg.muted">
        {total.measuredCompletions} of {total.completed} completed sessions measured
      </Text>
    </Stack>
  );
};
