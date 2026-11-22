import { Badge, Flex, Heading, Link, Stack, Text } from "@chakra-ui/react";
import { Link as RouterLink } from "react-router";
import type { ComponentProps } from "react";
import { Panel } from "../../components/ui";
import type { ComplianceTotals } from "./compliance";
import { MetricBar } from "./MetricBars";
import { hours, percent } from "./format";

export const CalendarCompliance = ({
  total,
  week,
  ...layout
}: { total: ComplianceTotals; week: string } & Pick<
  ComponentProps<typeof Panel>,
  "gridColumn" | "gridRow"
>) => {
  const statuses = [
    { label: "upcoming", count: total.pending, palette: "gray" },
    { label: "skipped", count: total.skipped, palette: "orange" },
    { label: "need logging", count: total.unresolved, palette: "orange" },
    { label: "shortened", count: total.shortened, palette: "blue" },
  ];
  const metrics = [
    { label: "Adherence", value: total.adherence, format: percent },
    { label: "Duration attainment", value: total.durationAttainment, format: percent },
    { label: "Target time", value: total.plannedMinutes, format: hours },
    { label: "Logged time", value: total.actualMinutes, format: hours },
  ].filter(({ value }) => value !== null);

  return (
    <Panel as="section" {...layout} gap="3">
      <Heading as="h3" size="md">
        Week summary
      </Heading>
      {total.scheduled > 0 ? (
        <>
          <Stack gap="1.5">
            <Text fontSize="sm" color="fg.muted">
              <Text as="span" fontSize="xl" fontWeight="bold" color="fg">
                {total.completed}
              </Text>
              {" of "}
              {total.scheduled} completed
            </Text>
            <MetricBar value={total.completed} max={total.scheduled} />
          </Stack>
          {statuses.some(({ count }) => count > 0) && (
            <Flex gap="1.5" wrap="wrap">
              {statuses
                .filter(({ count }) => count > 0)
                .map(({ label, count, palette }) => (
                  <Badge key={label} colorPalette={palette}>
                    {count} {label}
                  </Badge>
                ))}
            </Flex>
          )}
          {metrics.length > 0 && (
            <Stack as="dl" gap="1.5" borderTopWidth="1px" pt="3">
              {metrics.map(({ label, value, format }) => (
                <Flex key={label} gap="2" wrap="wrap" justify="space-between" fontSize="sm">
                  <Text as="dt" color="fg.muted">
                    {label}
                  </Text>
                  <Text as="dd" fontWeight="semibold">
                    {format(value)}
                  </Text>
                </Flex>
              ))}
            </Stack>
          )}
        </>
      ) : (
        <Text fontSize="sm" color="fg.muted">
          No sessions scheduled this week.
        </Text>
      )}
      <Link asChild fontSize="sm" variant="underline" alignSelf="start">
        <RouterLink
          to={`/metrics?${new URLSearchParams({ view: "weekly", week, program: "all" })}`}
        >
          Explore metrics
        </RouterLink>
      </Link>
    </Panel>
  );
};
