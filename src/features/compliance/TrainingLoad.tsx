import { Button, Box, Flex, Grid, Heading, NativeSelect, Stack, Text } from "@chakra-ui/react";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Disclosure, FormField, Notice, Panel } from "../../components/ui";
import { apiRequest, errorMessage } from "../../lib/api/request";
import { formatDate, parseDate } from "../calendar/dates";
import { programKeys } from "../programs/programs";
import type { PlannedIntensity } from "../programs/programs";
import { sessionTypes } from "../templates/templates";
import type { SessionType } from "../templates/templates";
import { averageRpe, hours, loadPoints } from "./format";
import { MetricPlot } from "./MetricPlot";

type LoadFilter = "all" | SessionType;
type LoadTotals = {
  load: number | null;
  actualMinutes: number | null;
  plannedMinutes: number | null;
  scheduledSessions: number;
  measuredDurationSessions: number;
  averageRpe: number | null;
  measuredLoadSessions: number;
  completedSessions: number;
  intensity: Record<PlannedIntensity | "unspecified", number>;
};
type LoadWeek = {
  startDate: string;
  endDate: string;
  totals: Record<LoadFilter, LoadTotals>;
};
type LoadReport = { weeks: LoadWeek[] };

const weekDate = (date: string) =>
  formatDate(parseDate(date)!, { month: "short", day: "numeric", year: "numeric" });

export const useTrainingLoad = (ownerId: string, programId?: string) =>
  useQuery({
    queryKey: [...programKeys.detail(ownerId, programId ?? ""), "training-load"],
    queryFn: ({ signal }) =>
      apiRequest<LoadReport>(
        `/api/paideuo/programs/${encodeURIComponent(programId ?? "")}/training-load`,
        "GET",
        undefined,
        signal,
      ),
    enabled: Boolean(programId),
    retry: false,
  });

export const TrainingLoad = ({ ownerId, programId }: { ownerId: string; programId: string }) => {
  const [filter, setFilter] = useState<LoadFilter>("all");
  const query = useTrainingLoad(ownerId, programId);
  const weeks = query.data?.weeks ?? [];

  return (
    <Panel as="section">
      <Heading as="h2" size="lg">
        Training load
      </Heading>
      <Disclosure label="How training load is calculated">
        <Text color="fg.muted" fontSize="sm">
          Load points = actual minutes × session RPE. Weekly totals follow scheduled dates.
        </Text>
      </Disclosure>
      {query.isPending && <Notice role="status">Loading training load…</Notice>}
      {query.isError && (
        <Stack align="start">
          <Notice role="alert">{errorMessage(query.error, "Unable to load training load.")}</Notice>
          <Button size="sm" variant="outline" onClick={() => void query.refetch()}>
            Retry
          </Button>
        </Stack>
      )}
      {query.data && (
        <>
          <FormField as="div" maxW="sm">
            <label htmlFor="load-session-type">Session type</label>
            <NativeSelect.Root>
              <NativeSelect.Field
                id="load-session-type"
                value={filter}
                onChange={(event) => setFilter(event.target.value as LoadFilter)}
              >
                <option value="all">All session types</option>
                {sessionTypes.map((type) => (
                  <option key={type} value={type}>
                    {type.charAt(0).toUpperCase() + type.slice(1)}
                  </option>
                ))}
              </NativeSelect.Field>
              <NativeSelect.Indicator />
            </NativeSelect.Root>
          </FormField>
          {weeks.length === 0 && <Notice>No weeks available.</Notice>}
          {weeks.length > 0 && (
            <MetricPlot
              title="Weekly training load"
              data={weeks.map(({ startDate, totals }) => ({
                label: formatDate(parseDate(startDate)!, { month: "short", day: "numeric" }),
                load: totals[filter].load,
              }))}
              series={[{ name: "load", label: "Training load", color: "teal.solid" }]}
              unit="load points"
            />
          )}
          <Stack as="ul" listStyle="none" gap="2">
            {weeks.map(({ startDate, endDate, totals }) => {
              const {
                load,
                actualMinutes,
                averageRpe: rpe,
                measuredLoadSessions,
                completedSessions,
                intensity,
              } = totals[filter];
              return (
                <Stack as="li" key={startDate} gap="2" borderWidth="1px" borderRadius="md" p="3">
                  <Flex wrap="wrap" justify="space-between" gap="2">
                    <Heading as="h3" size="sm">
                      {weekDate(startDate)} – {weekDate(endDate)}
                    </Heading>
                    <Text fontWeight="semibold">
                      {load === null ? "No measured load" : loadPoints(load)}
                    </Text>
                  </Flex>
                  <Grid
                    as="dl"
                    gap="3"
                    templateColumns="repeat(auto-fit, minmax(min(100%, 8rem), 1fr))"
                  >
                    {[
                      ["Actual duration", hours(actualMinutes)],
                      ["Average session RPE", averageRpe(rpe)],
                      ["Completions with load", `${measuredLoadSessions} / ${completedSessions}`],
                    ].map(([label, value]) => (
                      <Box key={label}>
                        <Text as="dt" fontSize="xs" color="fg.muted">
                          {label}
                        </Text>
                        <Text as="dd" fontWeight="semibold" fontVariantNumeric="tabular-nums">
                          {value}
                        </Text>
                      </Box>
                    ))}
                  </Grid>
                  <Disclosure label="Planned intensity">
                    <Flex as="dl" gapX="4" gapY="2" wrap="wrap" fontSize="sm">
                      {Object.entries(intensity).map(([level, count]) => (
                        <Box key={level}>
                          <Text as="dt" color="fg.muted" textTransform="capitalize">
                            {level}
                          </Text>
                          <Text as="dd" fontWeight="semibold">
                            {count}
                          </Text>
                        </Box>
                      ))}
                    </Flex>
                  </Disclosure>
                </Stack>
              );
            })}
          </Stack>
        </>
      )}
    </Panel>
  );
};
