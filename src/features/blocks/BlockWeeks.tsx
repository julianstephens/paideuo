import {
  Badge,
  Box,
  Button,
  Flex,
  Heading,
  Link,
  NativeSelect,
  Popover,
  Portal,
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
import { MetricBar } from "../compliance/MetricBars";
import { useCompliance } from "../compliance/compliance";
import { formatPlannedDuration, formatPlannedRpe } from "../prescriptions/format";
import { workoutTypes } from "../prescriptions/workoutTypes";
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
  minMinutes: number;
  maxMinutes: number;
  sessions: number;
  rest: number;
  incomplete: number;
  intensities: Record<PlannedIntensity | "unspecified", number>;
};

const emptyWorkload = (): Workload => ({
  minMinutes: 0,
  maxMinutes: 0,
  sessions: 0,
  rest: 0,
  incomplete: 0,
  intensities: { easy: 0, moderate: 0, hard: 0, maximal: 0, unspecified: 0 },
});

const hours = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
const formatHours = (minutes: number) => `${hours.format(minutes / 60)} h`;

const formatWorkloadHours = ({ minMinutes, maxMinutes }: Workload) =>
  minMinutes === maxMinutes
    ? formatHours(minMinutes)
    : `${hours.format(minMinutes / 60)}–${hours.format(maxMinutes / 60)} h`;

const intensityPalette = {
  easy: "blue",
  moderate: "teal",
  hard: "orange",
  maximal: "red",
  unspecified: "gray",
} as const;

const WeeklyWorkload = ({ workload, max }: { workload: Workload; max: number }) => (
  <Stack gap="2" fontWeight="normal">
    <Flex gap="1" wrap="wrap" align="baseline" justify="space-between">
      <Text fontWeight="bold">{formatWorkloadHours(workload)}</Text>
      <Text fontSize="xs" color="fg.muted">
        {workload.sessions} {workload.sessions === 1 ? "workout" : "workouts"}
        {workload.rest > 0 && ` · ${workload.rest} rest`}
      </Text>
    </Flex>
    <MetricBar value={workload.maxMinutes} max={max} />
    <Flex gap="1" wrap="wrap">
      {[...plannedIntensities, "unspecified" as const].map((level) =>
        workload.intensities[level] > 0 ? (
          <Badge key={level} colorPalette={intensityPalette[level]} textTransform="capitalize">
            {workload.intensities[level]} {level === "unspecified" ? "no intensity" : level}
          </Badge>
        ) : null,
      )}
    </Flex>
    {workload.incomplete > 0 && (
      <Text fontSize="xs" color="fg.muted">
        {workload.incomplete} missing duration
      </Text>
    )}
  </Stack>
);

const WeekContext = ({ week }: { week: ProgramWeek }) => (
  <Stack gap="1" mb="2" align="start">
    {week.weekType === "recovery" && <Badge colorPalette="blue">Recovery</Badge>}
    {week.focus && (
      <Text fontSize="sm" color="fg.muted" fontWeight="normal">
        {week.focus}
      </Text>
    )}
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
}) => {
  const type = session?.sessionType ? workoutTypes[session.sessionType] : undefined;
  const intensity = session?.plannedIntensity;
  const duration =
    session && formatPlannedDuration(session.plannedDurationMin, session.plannedDurationMax);
  const rpe = session && formatPlannedRpe(session.plannedRpeMin, session.plannedRpeMax);
  return (
    <Button
      variant={session ? "subtle" : "outline"}
      colorPalette={type?.palette ?? "gray"}
      color="fg"
      borderInlineStartWidth={session ? "3px" : undefined}
      borderInlineStartColor={session ? "colorPalette.solid" : undefined}
      borderStyle={session ? undefined : "dashed"}
      size="sm"
      minH="11"
      h="auto"
      w="full"
      px="3"
      py="2"
      justifyContent="start"
      whiteSpace="normal"
      textAlign="start"
      overflowWrap="anywhere"
      aria-label={`${session ? `Edit ${session.title}` : `Add prescription for ${slot.label}`}, ${weekTitle(week)}${type ? `, ${type.label}` : ""}${duration ? `, ${duration}` : ""}${rpe ? `, ${rpe}` : ""}${intensity ? `, ${intensity} intensity` : ""}`}
      onClick={() => open(week, slot)}
    >
      {session ? (
        <Stack as="span" gap="1.5" align="start" minW="0">
          {type && (
            <Text as="span" fontSize="xs" color="colorPalette.fg">
              {type.label}
            </Text>
          )}
          <Text as="span" fontWeight="bold" lineHeight="short">
            {session.title}
          </Text>
          {session.sessionType !== "rest" && (
            <Flex as="span" gap="1" wrap="wrap">
              <Badge as="span" colorPalette="gray" variant="surface">
                {duration ?? "No duration"}
              </Badge>
              {rpe && (
                <Badge as="span" colorPalette="gray" variant="surface">
                  {rpe}
                </Badge>
              )}
              {intensity && (
                <Badge
                  as="span"
                  colorPalette={intensityPalette[intensity]}
                  textTransform="capitalize"
                >
                  {intensity}
                </Badge>
              )}
            </Flex>
          )}
        </Stack>
      ) : (
        <Text as="span" color="fg.muted">
          Add prescription
        </Text>
      )}
    </Button>
  );
};

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
  const total = emptyWorkload();
  for (const session of block.prescriptions) {
    const workload = workloads.get(session.weekId);
    if (!workload) continue;
    for (const summary of [workload, total]) {
      if (session.sessionType === "rest") {
        summary.rest++;
        continue;
      }
      summary.sessions++;
      summary.intensities[session.plannedIntensity ?? "unspecified"]++;
      const min = session.plannedDurationMin;
      const max = session.plannedDurationMax ?? min;
      if (max == null) summary.incomplete++;
      else {
        summary.minMinutes += min ?? 0;
        summary.maxMinutes += max;
      }
    }
  }
  const hasWeekContext = block.weeks.some((entry) => entry.focus || entry.weekType === "recovery");
  const workloadFor = (week: ProgramWeek) => workloads.get(week.id) ?? emptyWorkload();
  const maxWeekMinutes = Math.max(
    0,
    ...Array.from(workloads.values(), ({ maxMinutes }) => maxMinutes),
  );

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
        <Flex gap="1" align="center">
          <Button
            size="sm"
            variant="outline"
            loading={initialization.isPending}
            disabled={!block.slots.some((slot) => slot.baselineName)}
            onClick={() => initialization.mutate()}
          >
            Initialize weeks
          </Button>
          <Popover.Root positioning={{ placement: "bottom-end" }}>
            <Popover.Trigger asChild>
              <Button size="sm" variant="ghost" aria-label="Help for Initialize weeks">
                ?
              </Button>
            </Popover.Trigger>
            <Portal>
              <Popover.Positioner>
                <Popover.Content>
                  <Popover.Body>
                    <Popover.Title>Initialize weeks</Popover.Title>
                    <Stack gap="2" mt="2" fontSize="sm">
                      <Text>
                        Fill empty session cells across all existing weeks with copies of each
                        slot’s assigned baseline, including its session details and components.
                        Existing prescriptions and the number of weeks stay the same.
                      </Text>
                      <Text>
                        Slots without a baseline are skipped. Assign a baseline to at least one slot
                        to enable the button.
                      </Text>
                    </Stack>
                  </Popover.Body>
                </Popover.Content>
              </Popover.Positioner>
            </Portal>
          </Popover.Root>
        </Flex>
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
      <Flex gapX="4" gapY="1" wrap="wrap" align="baseline" bg="bg.inset" borderRadius="lg" p="3">
        <Text fontWeight="bold">{formatWorkloadHours(total)} prescribed</Text>
        <Text fontSize="sm" color="fg.muted">
          {total.sessions} {total.sessions === 1 ? "workout" : "workouts"}
          {total.rest > 0 && ` · ${total.rest} rest`}
          {total.incomplete > 0 && ` · ${total.incomplete} missing duration`}
        </Text>
      </Flex>
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
                <Table.ColumnHeader
                  scope="col"
                  {...pinnedColumn}
                  rowSpan={hasWeekContext ? 3 : 2}
                  verticalAlign="top"
                >
                  Session slot
                </Table.ColumnHeader>
                {block.weeks.map((entry) => (
                  <Table.ColumnHeader
                    scope="col"
                    minW="12rem"
                    borderBottomWidth="0"
                    pb="0"
                    verticalAlign="top"
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
                  </Table.ColumnHeader>
                ))}
              </Table.Row>
              {hasWeekContext && (
                <Table.Row>
                  {block.weeks.map((entry) => (
                    <Table.Cell
                      key={entry.id}
                      verticalAlign="top"
                      borderBottomWidth="0"
                      py="0"
                      bg={entry.id === selected ? "teal.subtle" : undefined}
                    >
                      <WeekContext week={entry} />
                    </Table.Cell>
                  ))}
                </Table.Row>
              )}
              <Table.Row>
                {block.weeks.map((entry) => (
                  <Table.Cell
                    key={entry.id}
                    verticalAlign="top"
                    bg={entry.id === selected ? "teal.subtle" : undefined}
                  >
                    <WeeklyWorkload workload={workloadFor(entry)} max={maxWeekMinutes} />
                  </Table.Cell>
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
                    {slot.baselineName && (
                      <Text fontSize="xs" color="fg.muted">
                        Baseline: {slot.baselineName}
                      </Text>
                    )}
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
          <WeekContext week={week} />
          <WeeklyWorkload workload={workloadFor(week)} max={maxWeekMinutes} />
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
