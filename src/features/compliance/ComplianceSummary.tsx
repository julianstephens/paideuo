import { Box, Button, Grid, Heading, Link, Stack, Table, Text } from "@chakra-ui/react";
import type { ReactNode } from "react";
import { Link as RouterLink } from "react-router";
import { Disclosure, Notice, Panel } from "../../components/ui";
import { errorMessage } from "../../lib/api/request";
import { plannedIntensities } from "../programs/programs";
import { useCompliance } from "./compliance";
import type { ComplianceTotals } from "./compliance";
import { hours, percent } from "./format";
import { DurationComparison, MetricBar } from "./MetricBars";

const Stat = ({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) => (
  <Stack as="div" bg="bg.inset" borderRadius="md" p="3" gap="1" minW="0">
    <Text as="dt" fontSize="sm" color="fg.muted">
      {label}
    </Text>
    <Box as="dd" m="0" fontSize="xl" fontWeight="semibold">
      {children}
    </Box>
    {hint && (
      <Text as="dd" m="0" fontSize="xs" color="fg.muted">
        {hint}
      </Text>
    )}
  </Stack>
);

export const ComplianceSummary = ({ total }: { total: ComplianceTotals }) => {
  if (!total.scheduled) return <Notice>No sessions scheduled for this period.</Notice>;
  const partial = total.measuredCompletions < total.completed;
  const sessionCounts = [
    { label: "Completed", count: total.completed },
    { label: "Skipped", count: total.skipped },
    { label: "Pending", count: total.pending },
    { label: "Past unresolved", count: total.unresolved },
    { label: "Shortened", count: total.shortened },
  ];
  return (
    <Stack gap="4">
      <DurationComparison total={total} />
      <Grid as="dl" gap="2" gridTemplateColumns="repeat(2, minmax(0, 1fr))">
        <Stat
          label="Session adherence"
          hint={`${total.completed} of ${total.completed + total.skipped} resolved sessions completed`}
        >
          {percent(total.adherence)}
        </Stat>
        <Stat
          label="Duration attainment"
          hint={
            total.durationAttainment === null
              ? "Requires actual and resolved planned hours"
              : `${hours(total.resolvedPlannedMinutes)} resolved planned${partial ? " · Partial measurement coverage" : ""}`
          }
        >
          {percent(total.durationAttainment)}
        </Stat>
      </Grid>
      <Grid as="dl" gap="2" gridTemplateColumns="repeat(auto-fit, minmax(min(100%, 6rem), 1fr))">
        {sessionCounts.map(({ label, count }) => (
          <Box as="div" key={label} borderWidth="1px" borderRadius="md" px="3" py="2">
            <Text as="dt" fontSize="sm" color="fg.muted">
              {label}
            </Text>
            <Text as="dd" m="0" fontWeight="semibold">
              {count}
            </Text>
          </Box>
        ))}
      </Grid>
      {partial && (
        <Text fontSize="sm" color="fg.muted">
          Actual hours are incomplete. Some completed sessions have no recorded duration.
        </Text>
      )}
      <Disclosure label="Scheduled intensity distribution">
        <Table.Root size="sm" variant="outline">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeader scope="col">Planned intensity</Table.ColumnHeader>
              <Table.ColumnHeader scope="col" textAlign="end">
                Sessions
              </Table.ColumnHeader>
              <Table.ColumnHeader scope="col" textAlign="end">
                Planned hours
              </Table.ColumnHeader>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {[...plannedIntensities, "unspecified" as const].map((key) => (
              <Table.Row key={key}>
                <Table.Cell as="th" scope="row" textTransform="capitalize">
                  {key}
                </Table.Cell>
                <Table.Cell textAlign="end">
                  <Stack gap="1">
                    {total.intensity[key].sessions}
                    <MetricBar value={total.intensity[key].sessions} max={total.scheduled} />
                  </Stack>
                </Table.Cell>
                <Table.Cell textAlign="end">
                  {hours(total.intensity[key].plannedMinutes)}
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Root>
      </Disclosure>
    </Stack>
  );
};

export const ComplianceQueryState = ({ query }: { query: ReturnType<typeof useCompliance> }) => {
  if (query.isPending) return <Notice role="status">Loading compliance…</Notice>;
  if (query.isError)
    return (
      <Stack align="start">
        <Notice role="alert">{errorMessage(query.error, "Unable to load compliance.")}</Notice>
        <Button size="sm" variant="outline" onClick={() => void query.refetch()}>
          Retry compliance
        </Button>
      </Stack>
    );
  return null;
};

export const ProgramCompliance = ({
  ownerId,
  programId,
}: {
  ownerId: string;
  programId: string;
}) => {
  const query = useCompliance(ownerId, programId);
  return (
    <Panel as="section">
      <Heading as="h2" size="lg">
        Program compliance
      </Heading>
      <ComplianceQueryState query={query} />
      {query.data && (
        <>
          <ComplianceSummary total={query.data.program} />
          <Link asChild variant="underline" alignSelf="start">
            <RouterLink
              to={`/metrics?${new URLSearchParams({ view: "program", program: programId })}`}
            >
              Explore program metrics
            </RouterLink>
          </Link>
          {query.data.unassigned > 0 && (
            <Notice>
              Unassigned sessions · {query.data.unassigned} included in program totals. Source block
              and week are unavailable.
            </Notice>
          )}
        </>
      )}
    </Panel>
  );
};
