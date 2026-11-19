import {
  Box,
  Button,
  Flex,
  Heading,
  Link,
  NativeSelect,
  Stack,
  Table,
  Text,
} from "@chakra-ui/react";
import { useMutation } from "@tanstack/react-query";
import { errorMessage } from "../../lib/api/request";
import { useId, useState } from "react";
import { useSearchParams } from "react-router";
import { Disclosure, FormField, Notice, Panel } from "../../components/ui";
import { ComplianceQueryState, ComplianceSummary } from "../compliance/ComplianceSummary";
import { useCompliance } from "../compliance/compliance";
import { plannedIntensities } from "../programs/programs";
import type {
  BlockDetail,
  PlannedIntensity,
  PrescriptionSummary,
  ProgramWeek,
  Slot,
  blocksApi,
} from "../programs/programs";
import { WeekComparison } from "./WeekComparison";
import { WeekProgramming, weekTitle } from "./WeekProgramming";
import type { ProgrammingSelection } from "./WeekProgramming";

export const weekdays = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

type Workload = {
  minutes: number;
  incomplete: number;
  intensities: Record<PlannedIntensity | "unspecified", number>;
};

const emptyWorkload = (): Workload => ({
  minutes: 0,
  incomplete: 0,
  intensities: { easy: 0, moderate: 0, hard: 0, maximal: 0, unspecified: 0 },
});

const hours = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
const formatHours = (minutes: number) => `${hours.format(minutes / 60)} h`;

const WeeklyWorkload = ({ workload }: { workload: Workload }) => (
  <Stack as="div" gap="1" fontSize="xs" fontWeight="normal">
    <Text>{formatHours(workload.minutes)} planned</Text>
    {workload.incomplete > 0 && <Text>{workload.incomplete} missing duration</Text>}
    <Text textTransform="capitalize">
      {[...plannedIntensities, "unspecified" as const]
        .map((level) => `${level} ${workload.intensities[level]}`)
        .join(" · ")}
    </Text>
  </Stack>
);

const CellButton = ({
  week,
  slot,
  session,
  open,
}: {
  week: ProgramWeek;
  slot: Slot;
  session?: PrescriptionSummary;
  open: (week: ProgramWeek, slot: Slot) => void;
}) => (
  <Button
    variant="ghost"
    size="sm"
    minH="10"
    h="auto"
    w="full"
    px="1"
    py="2"
    justifyContent="start"
    whiteSpace="normal"
    textAlign="start"
    overflowWrap="anywhere"
    aria-label={`${session ? "Edit" : "Create"} ${slot.label} in Week ${week.position}`}
    onClick={() => open(week, slot)}
  >
    {session ? (
      <Stack gap="0" align="start" minW="0">
        <Text fontWeight="semibold">{session.title}</Text>
        <Text fontSize="xs" color="fg.muted" textTransform="capitalize">
          {session.plannedDurationMin === null
            ? "Duration missing"
            : `${session.plannedDurationMin} min`}
          {" · "}
          {session.plannedIntensity ?? "Intensity unspecified"}
        </Text>
      </Stack>
    ) : (
      <Text color="fg.muted">No prescription</Text>
    )}
  </Button>
);

const pinnedColumn = {
  position: "sticky",
  insetInlineStart: "0",
  zIndex: "1",
  bg: "bg.inset",
  w: "10rem",
  minW: "8rem",
  maxW: "12rem",
  borderInlineEndWidth: "1px",
} as const;

export const BlockWeeks = ({
  block,
  ownerId,
  programId,
  api,
  cacheKey,
  sync,
}: {
  block: BlockDetail;
  ownerId: string;
  programId: string;
  api: ReturnType<typeof blocksApi>;
  cacheKey: readonly string[];
  sync: () => Promise<void>;
}) => {
  const initialization = useMutation({ mutationFn: api.initializeWeeks, onSuccess: sync });
  const weekSelectId = useId();
  const [params, setParams] = useSearchParams();
  const selected = params.get("week");
  const setSelected = (id: string) => {
    const next = new URLSearchParams(params);
    next.set("week", id);
    setParams(next, { replace: true });
  };
  const [pair, setPair] = useState<[string, string]>();
  const compare = pair && block.weeks.length >= 2;
  const compliance = useCompliance(ownerId, programId, block.scheduled);
  const report = compliance.data?.blocks.find(({ id }) => id === block.id);
  const historicalWeeks = report?.weeks.filter((entry) => entry.historical) ?? [];
  const weekOptions = [...block.weeks, ...historicalWeeks];
  const selectedWeek = weekOptions.find(({ id }) => id === selected) ?? weekOptions[0];
  const week = block.weeks.find(({ id }) => id === selectedWeek?.id);
  const weeklyCompliance = report?.weeks.find(({ id }) => id === selectedWeek?.id);
  const [programming, setProgramming] = useState<ProgrammingSelection>();
  const openWeek = (entry: ProgramWeek) => {
    setSelected(entry.id);
    setProgramming({ mode: "week", week: entry });
  };
  const openCell = (entry: ProgramWeek, slot: Slot) =>
    setProgramming({ mode: "cell", week: entry, slot });
  const sessions = new Map(
    block.prescriptions.map((session) => [`${session.weekId}/${session.slotId}`, session]),
  );
  const workloads = new Map(block.weeks.map((entry) => [entry.id, emptyWorkload()]));
  let totalMinutes = 0;
  let totalIncomplete = 0;
  for (const session of block.prescriptions) {
    const workload = workloads.get(session.weekId);
    if (!workload) continue;
    workload.intensities[session.plannedIntensity ?? "unspecified"]++;
    if (session.plannedDurationMin === null) {
      workload.incomplete++;
      totalIncomplete++;
    } else {
      workload.minutes += session.plannedDurationMin;
      totalMinutes += session.plannedDurationMin;
    }
  }
  const workloadFor = (week: ProgramWeek) => workloads.get(week.id) ?? emptyWorkload();

  return (
    <Panel as="section">
      <Flex gap="3" wrap="wrap" justify="space-between" align="center">
        <Heading as="h2" size="lg">
          Weeks
        </Heading>
        {block.weeks.length >= 2 && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              if (compare) setPair(undefined);
              else {
                const index = block.weeks.findIndex(({ id }) => id === week?.id);
                setPair(
                  index > 0
                    ? [block.weeks[index - 1].id, block.weeks[index].id]
                    : [block.weeks[0].id, block.weeks[1].id],
                );
              }
            }}
          >
            {compare ? "Back to week grid" : "Compare weeks"}
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          loading={initialization.isPending}
          disabled={!block.slots.some((slot) => slot.baselineName)}
          onClick={() => initialization.mutate()}
        >
          Initialize weeks
        </Button>
      </Flex>
      {initialization.isError && (
        <Notice role="alert">
          {errorMessage(initialization.error, "Unable to initialize weeks. Try again.")}
        </Notice>
      )}
      {initialization.data && (
        <Notice role="status">
          {initialization.data.created === 0
            ? "No empty cells with assigned baselines."
            : `Created ${initialization.data.created} ${initialization.data.created === 1 ? "prescription" : "prescriptions"}.`}
        </Notice>
      )}
      <Text fontWeight="semibold">
        Block total · {formatHours(totalMinutes)} planned
        {totalIncomplete > 0 && ` · ${totalIncomplete} missing duration`}
      </Text>
      {selectedWeek && (
        <Stack
          gap="1.5"
          maxW="sm"
          display={block.scheduled ? "flex" : { base: "flex", md: "none" }}
        >
          <FormField htmlFor={weekSelectId}>Week</FormField>
          <NativeSelect.Root>
            <NativeSelect.Field
              id={weekSelectId}
              value={selectedWeek.id}
              onChange={(event) => setSelected(event.target.value)}
            >
              {weekOptions.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {weekTitle(entry)}
                  {"historical" in entry ? " (historical)" : ""}
                </option>
              ))}
            </NativeSelect.Field>
            <NativeSelect.Indicator />
          </NativeSelect.Root>
        </Stack>
      )}
      {block.scheduled && (
        <>
          <ComplianceQueryState query={compliance} />
          {report && (
            <Disclosure label="Block compliance">
              <ComplianceSummary total={report.total} />
            </Disclosure>
          )}
          {weeklyCompliance && (
            <Disclosure label="Week compliance">
              <Heading as="h3" size="sm" mb="2">
                {weekTitle(weeklyCompliance)}
                {weeklyCompliance.historical ? " (historical)" : ""}
              </Heading>
              <ComplianceSummary total={weeklyCompliance.total} />
            </Disclosure>
          )}
        </>
      )}
      {compare && (
        <WeekComparison {...{ block, api, cacheKey, pair, setPair, openCell, weekdays }} />
      )}
      {!compare && block.weeks.length > 0 && (
        <Box
          display={{ base: "none", md: "block" }}
          overflowX="auto"
          borderWidth="1px"
          borderRadius="md"
          role="region"
          aria-label="Weekly schedule"
          tabIndex={0}
        >
          <Table.Root size="sm">
            <Table.Header bg="bg.inset">
              <Table.Row>
                <Table.ColumnHeader scope="col" {...pinnedColumn}>
                  Session slot
                </Table.ColumnHeader>
                {block.weeks.map((entry) => (
                  <Table.ColumnHeader
                    scope="col"
                    minW="8rem"
                    key={entry.id}
                    bg={entry.id === selected ? "teal.subtle" : undefined}
                  >
                    <Button
                      size="sm"
                      variant="ghost"
                      whiteSpace="normal"
                      textAlign="start"
                      h="auto"
                      px="0"
                      justifyContent="start"
                      onClick={() => openWeek(entry)}
                    >
                      {weekTitle(entry)}
                    </Button>
                    <WeeklyWorkload workload={workloadFor(entry)} />
                  </Table.ColumnHeader>
                ))}
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {block.slots.map((slot) => (
                <Table.Row key={slot.id}>
                  <Table.Cell as="th" scope="row" {...pinnedColumn} verticalAlign="top">
                    <Text fontSize="xs" color="fg.muted">
                      {weekdays[slot.weekday - 1]}
                    </Text>
                    <Text fontWeight="semibold">{slot.label}</Text>
                  </Table.Cell>
                  {block.weeks.map((entry) => (
                    <Table.Cell key={entry.id} maxW="16rem" verticalAlign="top">
                      <CellButton
                        week={entry}
                        slot={slot}
                        session={sessions.get(`${entry.id}/${slot.id}`)}
                        open={openCell}
                      />
                    </Table.Cell>
                  ))}
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Root>
        </Box>
      )}
      {!compare && week && (
        <Stack display={{ base: "flex", md: "none" }} gap="4">
          <Button alignSelf="start" variant="outline" size="sm" onClick={() => openWeek(week)}>
            Edit {weekTitle(week)}
          </Button>
          <WeeklyWorkload workload={workloadFor(week)} />
          {weekdays.map((day, index) => {
            const slots = block.slots.filter(({ weekday }) => weekday === index + 1);
            if (slots.length === 0) return null;
            return (
              <Box key={day}>
                <Heading as="h3" size="sm" mb="2">
                  {day}
                </Heading>
                <Stack as="ul" listStyleType="none" gap="2">
                  {slots.map((slot) => (
                    <Box as="li" key={slot.id} bg="bg.inset" borderRadius="md" p="3">
                      <Text fontSize="sm" color="fg.muted">
                        {slot.label}
                      </Text>
                      <CellButton
                        week={week}
                        slot={slot}
                        session={sessions.get(`${week.id}/${slot.id}`)}
                        open={openCell}
                      />
                    </Box>
                  ))}
                </Stack>
              </Box>
            );
          })}
          <Link href="#weekly-session-slots" alignSelf="start" minH="11" variant="underline">
            Edit weekly slots
          </Link>
        </Stack>
      )}
      {programming && (
        <WeekProgramming
          selection={programming}
          weeks={block.weeks}
          slots={block.slots}
          api={api}
          cacheKey={cacheKey}
          sync={sync}
          close={() => setProgramming(undefined)}
          copy={(week, slot) => setProgramming({ mode: "copy", week, slot })}
        />
      )}
      {block.slots.length === 0 && <Notice>No weekly session slots yet.</Notice>}
    </Panel>
  );
};
