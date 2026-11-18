import { Flex, Heading, Link, Stack, Text } from "@chakra-ui/react";
import { Link as RouterLink } from "react-router";
import type { ComponentProps } from "react";
import { Panel } from "../../components/ui";
import type { ComplianceTotals } from "./compliance";
import { DurationComparison } from "./MetricBars";
import { percent } from "./format";

export const CalendarCompliance = ({
  total,
  week,
  ...layout
}: { total: ComplianceTotals; week: string } & Pick<
  ComponentProps<typeof Panel>,
  "gridColumn" | "gridRow"
>) => (
  <Panel as="section" {...layout}>
    <Heading as="h3" size="md">
      Week summary
    </Heading>
    {total.scheduled ? (
      <>
        <Flex gap="4" wrap="wrap">
          <Stack gap="0">
            <Text fontSize="xs" color="fg.muted">
              Session adherence
            </Text>
            <Text fontSize="xl" fontWeight="semibold">
              {percent(total.adherence)}
            </Text>
          </Stack>
          <Stack gap="0">
            <Text fontSize="xs" color="fg.muted">
              Duration attainment
            </Text>
            <Text fontSize="xl" fontWeight="semibold">
              {percent(total.durationAttainment)}
            </Text>
          </Stack>
        </Flex>
        <DurationComparison total={total} />
        <Text fontSize="sm" color="fg.muted">
          {total.completed} completed · {total.skipped} skipped · {total.pending} pending ·{" "}
          {total.unresolved} past unresolved · {total.shortened} shortened
        </Text>
      </>
    ) : (
      <Text fontSize="sm" color="fg.muted">
        No sessions scheduled this week.
      </Text>
    )}
    <Link asChild fontSize="sm" variant="underline" alignSelf="start">
      <RouterLink to={`/metrics?${new URLSearchParams({ view: "weekly", week, program: "all" })}`}>
        Explore metrics
      </RouterLink>
    </Link>
  </Panel>
);
