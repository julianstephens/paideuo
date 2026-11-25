import {
  Badge,
  Box,
  Button,
  Dialog,
  Flex,
  Grid,
  Heading,
  Input,
  Link,
  Menu,
  Portal,
  Stack,
  Text,
  chakra,
  useBreakpointValue,
} from "@chakra-ui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ClientResponseError } from "pocketbase";
import { useEffect, useRef, useState } from "react";
import { Link as RouterLink, useSearchParams } from "react-router";
import { AppIcon } from "../../app/AppIcon";
import { ConfirmationDialog } from "../../components/ConfirmationDialog";
import { Disclosure, FormField, Notice, PageHeader, Panel } from "../../components/ui";
import { errorMessage } from "../../lib/api/request";
import { CalendarCompliance } from "../compliance/CalendarCompliance";
import { formatPlannedDuration, formatPlannedRpe } from "../prescriptions/format";
import { metricsKey } from "../compliance/metrics";
import { useSession } from "../auth/session";
import { programKeys, programsApi } from "../programs/programs";
import { TargetValues } from "../nutrition/ProgramTargets";
import { targetKey, targetsApi } from "../nutrition/targets";
import { CheckInDialog } from "../recovery/CheckInDialog";
import { checkInApi, checkInKey, checkInSections, hasCheckInResponse } from "../recovery/recovery";
import type { CheckInSection } from "../recovery/recovery";
import { reviewKey } from "../reviews/reviews";
import { PrescriptionSnapshot } from "./PrescriptionSnapshot";
import {
  CompletionForm,
  CompletionResults,
  clearCompletionDraft,
  completionDraftKey,
} from "./SessionCompletion";
import { WorkoutDialog } from "./WorkoutDialog";
import { workoutTypes } from "../prescriptions/workoutTypes";
import type { SessionType } from "../templates/templates";
import {
  addDays,
  dateKey,
  formatDate,
  fullDate,
  localToday,
  monday,
  monthStart,
  parseDate,
  todayInTimezone,
} from "./dates";
import { selectedCalendarSession } from "./session-links";
import { calendarKey, schedulingApi } from "./scheduling";
import type {
  CalendarReport,
  CalendarSession,
  SessionExecution,
  SessionExecutionState,
} from "./scheduling";

type View = "month" | "week";
const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const monthSessionLimit = 2;
const dayOptions = { month: "short", day: "numeric" } as const;
const palettes = { completed: "green", skipped: "orange", rest: "blue" };
const sessionPalette = (type: SessionType, status: CalendarSession["status"]) =>
  status === "completed" ? palettes.completed : workoutTypes[type].palette;

const calendarRange = (date: Date, view: View) => {
  const first = monday(view === "month" ? monthStart(date) : date);
  if (view === "week") return { first, last: addDays(first, 6) };
  const lastInMonth = new Date(date);
  lastInMonth.setUTCMonth(lastInMonth.getUTCMonth() + 1, 0);
  return { first, last: addDays(monday(lastInMonth), 6) };
};

const StatusBadge = ({ status }: { status: CalendarSession["status"] }) =>
  status === "planned" ? null : (
    <Badge colorPalette={palettes[status]} variant="subtle" textTransform="capitalize">
      {status}
    </Badge>
  );

export const CalendarPage = () => {
  const session = useSession();
  return session.status === "signed-in" ? (
    <Calendar key={session.ownerId} ownerId={session.ownerId} />
  ) : null;
};

const Calendar = ({ ownerId }: { ownerId: string }) => {
  const [params, setParams] = useSearchParams();
  const selectSession = (id?: string, log = false) => {
    const next = new URLSearchParams(params);
    if (id) next.set("session", id);
    else next.delete("session");
    if (id && log) next.set("log", "true");
    else next.delete("log");
    setParams(next, { replace: true });
  };
  const [checkIn, setCheckIn] = useState<{ date: string; section: CheckInSection }>();
  const checkInSection = checkIn?.section ?? checkInSections[0];
  const [workoutDate, setWorkoutDate] = useState<string>();
  const workoutTrigger = useRef<HTMLButtonElement>(null);
  const addWorkoutButton = (date: string) => (
    <Button
      type="button"
      variant="ghost"
      size="xs"
      alignSelf="start"
      maxW="100%"
      aria-label={`Add workout for ${fullDate(date)}`}
      onClick={(event) => {
        workoutTrigger.current = event.currentTarget;
        setWorkoutDate(date);
      }}
    >
      <AppIcon name="plus" size={15} />
      Add workout
    </Button>
  );
  const checkInTrigger = useRef<HTMLButtonElement>(null);
  const desktop = useBreakpointValue({ base: false, md: true });
  const requestedView = params.get("view");
  const view: View = requestedView === "month" ? "month" : "week";
  const today = localToday();
  const date = parseDate(params.get("date")) ?? today;
  const { first, last } = calendarRange(date, view);
  const start = dateKey(first);
  const end = dateKey(last);
  const queryClient = useQueryClient();
  const targetProgramId = params.get("program") ?? "";
  const targetProgram = useQuery({
    queryKey: programKeys.detail(ownerId, targetProgramId),
    queryFn: ({ signal }) => programsApi.get(targetProgramId, signal),
    enabled: !!targetProgramId,
    retry: false,
  });
  const targets = useQuery({
    queryKey: [...targetKey(ownerId, targetProgramId), "calendar", start, end],
    queryFn: ({ signal }) => targetsApi.bulk(targetProgramId, start, end, signal),
    enabled: !!targetProgramId,
    retry: false,
  });
  const targetsByDate = new Map(targets.data?.days.map(({ date, target }) => [date, target]));
  const clearTargetProgram = () => {
    const next = new URLSearchParams(params);
    next.delete("program");
    setParams(next);
  };
  const queryKey = [...calendarKey(ownerId), start, end] as const;
  const query = useQuery({
    queryKey,
    queryFn: ({ signal }) => schedulingApi.calendar(start, end, signal),
    refetchInterval: 60_000,
    retry: false,
  });
  const checkIns = useQuery({
    queryKey: [...checkInKey(ownerId), start, end],
    queryFn: ({ signal }) => checkInApi.list(start, end, signal),
    retry: false,
  });
  const checkInsByDate = new Map(checkIns.data?.map((entry) => [entry.date, entry]));
  const checkInButtons = (date: string) =>
    checkInSections.map((section) => {
      const complete = hasCheckInResponse(checkInsByDate.get(date), section);
      const nutrition = section.id === "nutrition";
      return (
        <Button
          key={section.id}
          type="button"
          variant={complete ? "subtle" : "ghost"}
          colorPalette={complete ? "green" : undefined}
          size="xs"
          alignSelf="start"
          maxW="100%"
          aria-label={
            complete
              ? `${section.title} complete for ${fullDate(date)}. Edit entry`
              : `${section.title} for ${fullDate(date)}`
          }
          onClick={(event) => {
            checkInTrigger.current = event.currentTarget;
            setCheckIn({ date, section });
          }}
        >
          <AppIcon name={complete ? "check" : nutrition ? "nutrition" : "checkIn"} size={15} />
          {nutrition
            ? complete
              ? "Nutrition logged"
              : "Log nutrition"
            : complete
              ? "Check-in complete"
              : section.title}
        </Button>
      );
    });
  const days = Array.from(
    { length: Math.round((last.getTime() - first.getTime()) / 86400000) + 1 },
    (_, index) => addDays(first, index),
  );
  const byDay = new Map<string, CalendarSession[]>();
  for (const session of query.data?.sessions ?? []) {
    if (!byDay.has(session.scheduledDate)) byDay.set(session.scheduledDate, []);
    byDay.get(session.scheduledDate)?.push(session);
  }
  const todayKey = dateKey(today);
  const todaySessions = byDay.get(todayKey) ?? [];
  const leadSession = todaySessions.find(({ status }) => status === "planned") ?? todaySessions[0];
  const unresolved = (query.data?.sessions ?? []).filter(
    ({ status, scheduledDate, timezone }) =>
      status === "planned" && scheduledDate < todayInTimezone(timezone),
  );
  const selected = selectedCalendarSession(query.data?.sessions, params);
  const navigate = (nextDate: Date, nextView: View) => {
    setCheckIn(undefined);
    setWorkoutDate(undefined);
    const next = new URLSearchParams({ date: dateKey(nextDate), view: nextView });
    if (targetProgramId) next.set("program", targetProgramId);
    setParams(next);
  };
  const move = (direction: number) =>
    navigate(view === "month" ? monthStart(date, direction) : addDays(date, direction * 7), view);
  const period =
    view === "month"
      ? formatDate(date, { month: "long", year: "numeric" })
      : `${formatDate(first, { ...dayOptions, ...(first.getUTCFullYear() !== last.getUTCFullYear() ? { year: "numeric" } : {}) })} – ${formatDate(last, { ...dayOptions, year: "numeric" })}`;
  const isMonth = view === "month";
  const compactMonth = isMonth && !desktop;
  const desktopMonth = isMonth && desktop;

  return (
    <Stack gap={{ base: "4", md: "5" }}>
      <PageHeader title="Calendar" />
      {targetProgramId && (
        <Flex align="center" gap="2" wrap="wrap">
          {targetProgram.data && (
            <Link asChild variant="underline">
              <RouterLink to={`/programs/${targetProgramId}`}>
                {targetProgram.data.name} nutrition targets
              </RouterLink>
            </Link>
          )}
          {targets.isFetching && <Text role="status">Loading nutrition targets…</Text>}
          {targets.isError && (
            <Notice role="alert">
              {errorMessage(targets.error, "Unable to load nutrition targets.")}
            </Notice>
          )}
          <Button variant="ghost" size="sm" onClick={clearTargetProgram}>
            Hide nutrition targets
          </Button>
        </Flex>
      )}
      {query.isSuccess && start <= todayKey && todayKey <= end && (
        <Panel as="section" gap="3">
          <Flex justify="space-between" align="baseline" gap="2" wrap="wrap">
            <Heading as="h2" size="md">
              Today
            </Heading>
            <Text fontSize="sm" color="fg.muted">
              {fullDate(todayKey)}
            </Text>
          </Flex>
          {leadSession ? (
            <Flex
              justify="space-between"
              gap="3"
              align={{ base: "start", sm: "center" }}
              wrap="wrap"
            >
              <Stack gap="1">
                <Flex align="baseline" gap="2" wrap="wrap">
                  <Heading as="h3" size="lg">
                    {leadSession.prescription.title}
                  </Heading>
                  <StatusBadge status={leadSession.status} />
                </Flex>
                <Text fontSize="sm" color="fg.muted">
                  {[
                    workoutTypes[leadSession.prescription.sessionType].label,
                    formatPlannedDuration(
                      leadSession.prescription.plannedDurationMin,
                      leadSession.prescription.plannedDurationMax,
                    ),
                    formatPlannedRpe(
                      leadSession.prescription.plannedRpeMin,
                      leadSession.prescription.plannedRpeMax,
                    ) ?? leadSession.prescription.plannedIntensity,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </Text>
              </Stack>
              <Flex gap="2" wrap="wrap">
                {leadSession.status === "planned" && (
                  <Button size="sm" onClick={() => selectSession(leadSession.id, true)}>
                    Log workout
                  </Button>
                )}
                <Button size="sm" variant="outline" onClick={() => selectSession(leadSession.id)}>
                  View workout
                </Button>
              </Flex>
            </Flex>
          ) : (
            <Text color="fg.muted">No workouts scheduled today.</Text>
          )}
          {todaySessions.length > 1 && (
            <Disclosure label={`Other workouts today (${todaySessions.length - 1})`}>
              <SessionButtons
                sessions={todaySessions.filter(({ id }) => id !== leadSession?.id)}
                select={selectSession}
              />
            </Disclosure>
          )}
          <Flex gap="2" wrap="wrap">
            {checkInButtons(todayKey)}
            {!leadSession && addWorkoutButton(todayKey)}
          </Flex>
        </Panel>
      )}
      {unresolved.length > 0 && (
        <Panel py="3">
          <Disclosure label={`Past workouts to log (${unresolved.length})`}>
            <Stack gap="2">
              {unresolved.map((session) => (
                <Flex key={session.id} gap="2" justify="space-between" align="center" wrap="wrap">
                  <Stack gap="0">
                    <Text fontWeight="semibold">{session.prescription.title}</Text>
                    <Text fontSize="sm" color="fg.muted">
                      {fullDate(session.scheduledDate)}
                    </Text>
                  </Stack>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => selectSession(session.id, true)}
                  >
                    Log workout
                  </Button>
                </Flex>
              ))}
            </Stack>
          </Disclosure>
        </Panel>
      )}
      <Panel as="section" aria-label="Calendar controls" py={{ base: "3", md: "4" }}>
        <Flex justify="space-between" wrap="wrap" gap="3" align="center">
          <Heading as="h2" size="lg" aria-live="polite" me="auto">
            {period}
          </Heading>
          <Flex gap="2" wrap="wrap" aria-label="Calendar navigation" role="group">
            <Button size="sm" variant="outline" onClick={() => move(-1)}>
              Previous
            </Button>
            <Button size="sm" variant="outline" onClick={() => navigate(today, view)}>
              Today
            </Button>
            <Button size="sm" variant="outline" onClick={() => move(1)}>
              Next
            </Button>
          </Flex>
          <Flex gap="2" aria-label="Calendar view" role="group">
            <Button
              size="sm"
              aria-pressed={view === "month"}
              variant={view === "month" ? "solid" : "outline"}
              onClick={() => navigate(date, "month")}
            >
              Month
            </Button>
            <Button
              size="sm"
              aria-pressed={view === "week"}
              variant={view === "week" ? "solid" : "outline"}
              onClick={() => navigate(date, "week")}
            >
              Week
            </Button>
          </Flex>
        </Flex>
      </Panel>
      {query.isPending && <Notice role="status">Loading scheduled sessions…</Notice>}
      {query.isError && (
        <Flex align="center" gap="2" wrap="wrap">
          <Notice role="alert">
            {errorMessage(query.error, "Unable to load scheduled sessions.")}
          </Notice>
          <Button size="sm" onClick={() => void query.refetch()}>
            Retry
          </Button>
        </Flex>
      )}
      {query.isSuccess && params.has("session") && !selected && (
        <Flex align="center" gap="2" wrap="wrap">
          <Notice>The selected session is unavailable in this calendar period.</Notice>
          <Button size="sm" onClick={() => selectSession()}>
            Dismiss
          </Button>
        </Flex>
      )}
      {view === "month" && query.data?.sessions.length === 0 && (
        <Notice>No sessions scheduled in this view.</Notice>
      )}
      <Grid
        gap="3"
        alignItems="start"
        templateColumns={
          view === "week"
            ? { base: "minmax(0, 1fr)", xl: "minmax(0, 1fr) minmax(15rem, 22%)" }
            : "minmax(0, 1fr)"
        }
      >
        {view === "week" && query.data && (
          <CalendarCompliance
            total={query.data.summary}
            week={start}
            gridColumn={{ xl: 2 }}
            gridRow={1}
          />
        )}
        <Grid
          gridColumn={1}
          gridRow={view === "week" && query.data ? { base: 2, xl: 1 } : undefined}
          templateColumns={
            view === "month"
              ? "repeat(7, minmax(0, 1fr))"
              : {
                  base: "minmax(0, 1fr)",
                  md: "repeat(2, minmax(0, 1fr))",
                  "2xl": "repeat(3, minmax(0, 1fr))",
                }
          }
          gap={desktopMonth ? "1px" : isMonth ? "1" : "3"}
          bg={desktopMonth ? "border" : undefined}
          borderWidth={desktopMonth ? "1px" : undefined}
          borderRadius={desktopMonth ? "md" : undefined}
        >
          {isMonth &&
            weekdays.map((name) => (
              <Text
                key={name}
                bg={desktopMonth ? "bg.inset" : undefined}
                textAlign={desktopMonth ? "start" : "center"}
                px={desktopMonth ? "2" : "1"}
                py="1.5"
                fontSize="xs"
                fontWeight="semibold"
                color="fg.muted"
              >
                {name}
              </Text>
            ))}
          {days.map((day) => {
            const key = dateKey(day);
            const sessions = byDay.get(key) ?? [];
            const current = key === dateKey(today);
            const outside = isMonth && day.getUTCMonth() !== date.getUTCMonth();
            const extraSessions = sessions.length - monthSessionLimit;
            if (compactMonth) {
              return (
                <Button
                  key={key}
                  variant={key === dateKey(date) ? "surface" : "outline"}
                  h="auto"
                  minH="20"
                  px="0.5"
                  py="1"
                  minW="0"
                  flexDirection="column"
                  justifyContent="start"
                  gap="0.5"
                  aria-current={current ? "date" : undefined}
                  aria-pressed={key === dateKey(date)}
                  aria-label={`${fullDate(key)}, ${sessions.length ? sessions.map(({ prescription }) => workoutTypes[prescription.sessionType].label).join(", ") : "no sessions"}`}
                  opacity={outside ? 0.65 : 1}
                  onClick={() => navigate(day, view)}
                >
                  <Text as="span" lineHeight="short">
                    {day.getUTCDate()}
                  </Text>
                  {sessions.slice(0, monthSessionLimit).map(({ id, prescription, status }) => {
                    const type = workoutTypes[prescription.sessionType];
                    return (
                      <Badge
                        as="span"
                        key={id}
                        colorPalette={sessionPalette(prescription.sessionType, status)}
                        variant="subtle"
                        justifyContent="center"
                        fontSize="xs"
                        px="0"
                        w="full"
                      >
                        {type.short}
                      </Badge>
                    );
                  })}
                  {extraSessions > 0 && (
                    <Text as="span" fontSize="xs" lineHeight="1">
                      +{extraSessions}
                    </Text>
                  )}
                </Button>
              );
            }
            return (
              <Stack
                as="section"
                aria-label={fullDate(key)}
                key={key}
                minW="0"
                gap="0"
                borderWidth={desktopMonth ? undefined : "1px"}
                borderColor={current ? "teal.border" : "border"}
                borderRadius={desktopMonth ? undefined : "xl"}
                overflow="clip"
                minH={desktopMonth ? "20" : undefined}
                bg={outside ? "bg.inset" : "bg.panel"}
              >
                <Flex
                  align="center"
                  px={desktopMonth ? "2" : "4"}
                  py={desktopMonth ? "1" : "2.5"}
                  bg={current ? "teal.subtle" : "bg.inset"}
                  color={current ? "teal.fg" : outside ? "fg.muted" : "fg"}
                  borderBottomWidth="1px"
                  gap="2"
                >
                  <chakra.time
                    dateTime={key}
                    fontSize={desktopMonth ? "sm" : "md"}
                    fontWeight="bold"
                    aria-current={current ? "date" : undefined}
                  >
                    {isMonth
                      ? day.getUTCDate()
                      : formatDate(day, { ...dayOptions, weekday: "short" })}
                  </chakra.time>
                  {current && (
                    <Badge colorPalette="teal" variant="solid" ms="auto">
                      Today
                    </Badge>
                  )}
                </Flex>
                <Stack gap="2" p={desktopMonth ? "1.5" : "3"} flex="1">
                  {!desktopMonth && query.isSuccess && sessions.length === 0 && (
                    <Text color="fg.muted" fontSize="sm" px="1">
                      No sessions scheduled
                    </Text>
                  )}
                  <SessionButtons
                    sessions={desktopMonth ? sessions.slice(0, monthSessionLimit) : sessions}
                    select={selectSession}
                    compact={desktopMonth}
                  />
                  {desktopMonth && extraSessions > 0 && (
                    <Button
                      variant="ghost"
                      size="xs"
                      color="teal.fg"
                      h="5"
                      px="1.5"
                      alignSelf="start"
                      aria-label={`+${extraSessions} more sessions on ${fullDate(key)}`}
                      onClick={() => navigate(day, "week")}
                    >
                      +{extraSessions} more
                    </Button>
                  )}
                  <TargetValues target={targetsByDate.get(key)} />
                  <Flex gap="1" wrap="wrap" mt="auto">
                    {checkInButtons(key)}
                    {addWorkoutButton(key)}
                  </Flex>
                </Stack>
              </Stack>
            );
          })}
        </Grid>
      </Grid>
      {compactMonth && (
        <Panel as="section">
          <Heading as="h3" size="sm">
            {fullDate(dateKey(date))}
          </Heading>
          {query.isSuccess && !byDay.has(dateKey(date)) && <Text>No sessions scheduled.</Text>}
          <SessionButtons sessions={byDay.get(dateKey(date)) ?? []} select={selectSession} />
          <TargetValues target={targetsByDate.get(dateKey(date))} />
          <Flex gap="2" wrap="wrap">
            {checkInButtons(dateKey(date))}
            {addWorkoutButton(dateKey(date))}
          </Flex>
        </Panel>
      )}
      {workoutDate && (
        <WorkoutDialog
          key={workoutDate}
          date={workoutDate}
          ownerId={ownerId}
          close={() => setWorkoutDate(undefined)}
          trigger={() => workoutTrigger.current}
        />
      )}
      {checkIn && (
        <CheckInDialog
          key={`${checkIn.date}/${checkInSection.id}`}
          date={checkIn.date}
          isTrainingDay={
            query.data
              ? (byDay.get(checkIn.date) ?? []).some(
                  ({ status }) => status === "planned" || status === "completed",
                )
              : undefined
          }
          section={checkInSection}
          ownerId={ownerId}
          close={() => setCheckIn(undefined)}
          trigger={() => checkInTrigger.current}
        />
      )}
      {selected && (
        <SessionDetail
          key={selected.id}
          session={selected}
          startLogging={params.get("log") === "true"}
          ownerId={ownerId}
          close={() => selectSession(undefined)}
          onMoved={(date) => navigate(new Date(date + "T00:00:00Z"), view)}
          onExecuted={(state) => {
            selectSession(selected.id);
            queryClient.setQueryData<CalendarReport>(
              queryKey,
              (report) =>
                report && {
                  ...report,
                  sessions: report.sessions.map((session) =>
                    session.id === selected.id ? { ...session, ...state } : session,
                  ),
                },
            );
          }}
          reload={async () => {
            const { data, error } = await query.refetch();
            if (error) throw error;
            return data?.sessions.find(({ id }) => id === selected.id);
          }}
        />
      )}
    </Stack>
  );
};

const SessionButtons = ({
  sessions,
  select,
  compact = false,
}: {
  sessions: CalendarSession[];
  select: (id: string) => void;
  compact?: boolean;
}) =>
  sessions.map((session) => {
    const { title, sessionType, plannedDurationMin, plannedDurationMax } = session.prescription;
    const planned = formatPlannedDuration(plannedDurationMin, plannedDurationMax);
    const actual = session.completion?.actualDurationMin;
    const type = workoutTypes[sessionType];
    const palette = sessionPalette(sessionType, session.status);
    const status = session.status === "planned" ? null : session.status;
    return (
      <Button
        key={session.id}
        size="sm"
        variant="subtle"
        colorPalette={palette}
        color="fg"
        borderInlineStartWidth="2px"
        borderInlineStartColor={`${palette}.solid`}
        display="flex"
        flexDir="column"
        alignItems="stretch"
        textAlign="start"
        h="auto"
        minW="0"
        w="full"
        gap="0.5"
        px={compact ? "1.5" : "3"}
        py={compact ? "1" : "2.5"}
        onClick={() => select(session.id)}
        aria-label={
          compact ? [`${type.label}: ${title}`, status].filter(Boolean).join(", ") : undefined
        }
        title={compact ? [type.label, title, status].filter(Boolean).join(" · ") : undefined}
      >
        {compact && (
          <Text as="span" fontSize="xs" color="colorPalette.fg" lineHeight="short">
            {type.label}
          </Text>
        )}
        <Text
          as="span"
          truncate={compact}
          overflowWrap="anywhere"
          fontSize={compact ? "xs" : "sm"}
          fontWeight="semibold"
        >
          {title}
        </Text>
        {!compact && (
          <>
            <Text as="span" fontWeight="normal" fontSize="xs" textTransform="capitalize">
              {status ? `${type.label} · ${status}` : type.label}
            </Text>
            {(planned !== null || actual != null) && (
              <Text as="span" fontWeight="normal" fontSize="xs" color="fg.muted">
                {[
                  planned && (status === "completed" ? `${planned} target` : planned),
                  actual != null && `${actual} min actual`,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </Text>
            )}
          </>
        )}
      </Button>
    );
  });

const SessionDetail = ({
  session,
  startLogging,
  ownerId,
  close,
  onMoved,
  onExecuted,
  reload,
}: {
  session: CalendarSession;
  startLogging: boolean;
  ownerId: string;
  close: () => void;
  onMoved: (date: string) => void;
  onExecuted: (state: SessionExecutionState) => void;
  reload: () => Promise<CalendarSession | undefined>;
}) => {
  const { prescription } = session;
  const [moveDate, setMoveDate] = useState<string>();
  const [editing, setEditing] = useState<CalendarSession>();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const actionsTrigger = useRef<HTMLButtonElement>(null);
  const past = session.scheduledDate < todayInTimezone(session.timezone);
  const [completionRevision, setCompletionRevision] = useState<string | undefined>(() =>
    startLogging && session.status !== "rest" ? session.revision : undefined,
  );
  const queryClient = useQueryClient();
  const sync = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: calendarKey(ownerId) }),
      queryClient.invalidateQueries({ queryKey: metricsKey(ownerId) }),
      session.programId &&
        queryClient.invalidateQueries({ queryKey: programKeys.detail(ownerId, session.programId) }),
      session.programId &&
        queryClient.invalidateQueries({ queryKey: reviewKey(ownerId, session.programId) }),
    ]);
  const execute = useMutation({
    mutationFn: ({ revision, execution }: { revision: string; execution: SessionExecution }) =>
      schedulingApi.execute(session.id, revision, execution),
    onSuccess: async (state, { revision }) => {
      clearCompletionDraft(completionDraftKey(ownerId, session.id, completionRevision ?? revision));
      await queryClient.cancelQueries({ queryKey: calendarKey(ownerId) });
      onExecuted(state);
      setCompletionRevision(undefined);
      await sync();
    },
  });
  const reloadSession = useMutation({
    mutationFn: reload,
    onSuccess: (latest) => {
      if (latest && completionRevision) setCompletionRevision(latest.revision);
      execute.reset();
    },
  });
  const executionConflict =
    execute.error instanceof ClientResponseError && execute.error.status === 409;
  const toggleStatus = (action: "skip" | "restore") => {
    reloadSession.reset();
    execute.mutate({ revision: session.revision, execution: { action } });
  };
  const openCompletion = () => {
    execute.reset();
    reloadSession.reset();
    setCompletionRevision(session.revision);
  };
  const move = useMutation({
    mutationFn: (date: string) => schedulingApi.reschedule(session, date),
    onSuccess: async ({ scheduledDate }) => {
      onMoved(scheduledDate);
      await sync();
    },
  });
  const remove = useMutation({
    mutationFn: () => schedulingApi.deleteSession(session),
    onSuccess: async () => {
      close();
      await sync();
    },
    onError: async (error) => {
      if (error instanceof ClientResponseError && [404, 409].includes(error.status)) {
        await queryClient.invalidateQueries({ queryKey: calendarKey(ownerId) });
      }
    },
  });
  const busy = move.isPending || execute.isPending || reloadSession.isPending || remove.isPending;

  const screen =
    completionRevision !== undefined
      ? "completion"
      : moveDate !== undefined && session.status === "planned"
        ? "reschedule"
        : "overview";
  const screenTitle = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    screenTitle.current?.focus();
  }, [screen, editing]);

  const executionFeedback = execute.isError && (
    <Stack align="start">
      <Notice role="alert">
        {errorMessage(execute.error, "Unable to save the session. Try again.")}
      </Notice>
      {executionConflict && (
        <Button
          size="sm"
          variant="outline"
          loading={reloadSession.isPending}
          onClick={() => reloadSession.mutate()}
        >
          Reload session
        </Button>
      )}
      {reloadSession.isError && (
        <Notice role="alert">Unable to reload the session. Try again.</Notice>
      )}
    </Stack>
  );

  if (editing) {
    return (
      <WorkoutDialog
        date={editing.scheduledDate}
        session={editing}
        ownerId={ownerId}
        close={() => setEditing(undefined)}
        onSaved={sync}
      />
    );
  }

  return (
    <Dialog.Root
      open
      onOpenChange={({ open }) => {
        if (!open && !busy) close();
      }}
      closeOnEscape={!busy}
      closeOnInteractOutside={!busy}
      initialFocusEl={() => screenTitle.current}
      placement="center"
      scrollBehavior="inside"
    >
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner p={{ base: "3", md: "6" }}>
          <Dialog.Content maxH={{ base: "100%", md: "calc(100dvh - 4rem)" }}>
            <Dialog.Header
              alignItems="start"
              justifyContent="space-between"
              px={{ base: "4", md: "6" }}
              pt="4"
              pb="3"
              borderBottomWidth="1px"
            >
              <Stack gap="1.5" minW="0" overflowWrap="anywhere">
                <Dialog.Title ref={screenTitle} tabIndex={-1}>
                  {screen === "reschedule"
                    ? "Reschedule session"
                    : screen === "completion"
                      ? session.status === "completed"
                        ? "Edit completion details"
                        : "Log workout"
                      : prescription.title}
                </Dialog.Title>
                {screen !== "overview" && (
                  <Text fontSize="sm" color="fg.muted">
                    {prescription.title}
                  </Text>
                )}
                <Flex align="center" gapX="2" gapY="1" wrap="wrap">
                  <Text color="fg.muted" fontSize="sm">
                    {fullDate(session.scheduledDate)}
                  </Text>
                  {screen === "overview" && <StatusBadge status={session.status} />}
                </Flex>
              </Stack>
              <Dialog.CloseTrigger asChild position="static">
                <Button aria-label="Close" variant="ghost" size="sm" disabled={busy}>
                  <Text as="span" aria-hidden="true" fontSize="2xl" lineHeight="none">
                    ×
                  </Text>
                </Button>
              </Dialog.CloseTrigger>
            </Dialog.Header>
            <Dialog.Body px={{ base: "4", md: "6" }} py="4" overflowWrap="anywhere" key={screen}>
              <Stack gap="4">
                {executionFeedback}
                {execute.isSuccess && screen === "overview" && (
                  <Notice role="status">
                    {session.status === "skipped"
                      ? "Workout marked skipped."
                      : session.status === "completed"
                        ? "Workout saved."
                        : "Workout restored."}
                  </Notice>
                )}
                {remove.isError && screen === "overview" && (
                  <Notice role="alert">
                    {errorMessage(remove.error, "Unable to delete the workout. Try again.")}
                  </Notice>
                )}
                {screen === "reschedule" && moveDate !== undefined && (
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      if (
                        !move.isPending &&
                        parseDate(moveDate) &&
                        moveDate !== session.scheduledDate
                      ) {
                        move.mutate(moveDate);
                      }
                    }}
                  >
                    <Stack gap="3">
                      <FormField>
                        New session date
                        <Input
                          type="date"
                          required
                          value={moveDate}
                          disabled={move.isPending}
                          onChange={(event) => {
                            setMoveDate(event.target.value);
                            move.reset();
                          }}
                        />
                      </FormField>
                      {move.isError && (
                        <Notice role="alert">
                          {errorMessage(move.error, "Unable to reschedule. Try again.")}
                        </Notice>
                      )}
                      <Flex gap="2" wrap="wrap">
                        <Button
                          type="submit"
                          loading={move.isPending}
                          disabled={!parseDate(moveDate) || moveDate === session.scheduledDate}
                        >
                          Save new date
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          disabled={move.isPending}
                          onClick={() => setMoveDate(undefined)}
                        >
                          Cancel rescheduling
                        </Button>
                      </Flex>
                    </Stack>
                  </form>
                )}
                {screen === "completion" && completionRevision !== undefined && (
                  <>
                    {reloadSession.isSuccess && session.status === "completed" && (
                      <Box bg="bg.inset" borderRadius="md" p="3">
                        <CompletionResults
                          title="Latest saved completion"
                          completion={session.completion}
                          sessionLoad={session.sessionLoad}
                          componentResults={session.componentResults}
                          prescription={prescription}
                        />
                      </Box>
                    )}
                    <CompletionForm
                      key={completionRevision}
                      session={session}
                      draftKey={completionDraftKey(ownerId, session.id, completionRevision)}
                      pending={busy}
                      canSave={!executionConflict}
                      save={({ componentResults, ...completion }) => {
                        reloadSession.reset();
                        execute.mutate({
                          revision: completionRevision,
                          execution: {
                            action: session.status === "completed" ? "edit-completion" : "complete",
                            completion,
                            componentResults,
                          },
                        });
                      }}
                      skip={session.status === "planned" ? () => toggleStatus("skip") : undefined}
                      cancel={() => {
                        execute.reset();
                        reloadSession.reset();
                        setCompletionRevision(undefined);
                      }}
                    />
                  </>
                )}
                {screen === "overview" && (
                  <>
                    {session.programId && session.programName && (
                      <Link asChild variant="underline" alignSelf="start" fontSize="sm">
                        <RouterLink to={`/programs/${session.programId}`}>
                          {session.programName}
                        </RouterLink>
                      </Link>
                    )}
                    {session.status === "completed" && (
                      <Box bg="bg.inset" borderRadius="md" p="3">
                        <CompletionResults
                          completion={session.completion}
                          sessionLoad={session.sessionLoad}
                          componentResults={session.componentResults}
                          prescription={prescription}
                        />
                      </Box>
                    )}
                    <Stack gap="2">
                      <Heading as="h3" size="sm">
                        Workout prescription
                      </Heading>
                      <Text color="fg.muted" textTransform="capitalize">
                        {[
                          prescription.sessionType,
                          formatPlannedDuration(
                            prescription.plannedDurationMin,
                            prescription.plannedDurationMax,
                          ),
                          formatPlannedRpe(
                            prescription.plannedRpeMin,
                            prescription.plannedRpeMax,
                          ) ?? prescription.plannedIntensity,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </Text>
                      <PrescriptionSnapshot prescription={prescription} compact />
                    </Stack>
                    {(session.manuallyMoved || session.originalDate !== session.scheduledDate) && (
                      <Text fontSize="xs" color="fg.muted">
                        Originally scheduled for {fullDate(session.originalDate)}
                      </Text>
                    )}
                  </>
                )}
              </Stack>
            </Dialog.Body>
            {screen === "overview" && (
              <Dialog.Footer
                px={{ base: "4", md: "6" }}
                pt="3"
                pb="4"
                borderTopWidth="1px"
                justifyContent="space-between"
                gap="2"
                flexWrap="wrap"
              >
                {session.status !== "rest" &&
                  (session.status === "planned" || session.status === "skipped") && (
                    <Button disabled={busy || executionConflict} onClick={openCompletion}>
                      Log workout
                    </Button>
                  )}
                {session.status === "skipped" && !past && (
                  <Button
                    disabled={busy || executionConflict}
                    onClick={() => toggleStatus("restore")}
                  >
                    Restore to schedule
                  </Button>
                )}
                {session.status === "completed" && (
                  <Button
                    variant="outline"
                    disabled={busy || executionConflict}
                    onClick={openCompletion}
                  >
                    Edit completion details
                  </Button>
                )}
                <Menu.Root positioning={{ placement: "top-end", strategy: "fixed" }}>
                  <Menu.Trigger asChild>
                    <Button ref={actionsTrigger} variant="ghost" disabled={busy}>
                      More actions
                    </Button>
                  </Menu.Trigger>
                  <Menu.Positioner>
                    <Menu.Content>
                      {session.status === "planned" && (
                        <>
                          <Menu.Item
                            value="edit"
                            disabled={executionConflict}
                            onSelect={() => setEditing(session)}
                          >
                            Edit workout
                          </Menu.Item>
                          <Menu.Item
                            value="reschedule"
                            disabled={executionConflict}
                            onSelect={() => {
                              move.reset();
                              setMoveDate(session.scheduledDate);
                            }}
                          >
                            Reschedule
                          </Menu.Item>
                          <Menu.Item
                            value="skip"
                            disabled={executionConflict}
                            onSelect={() => toggleStatus("skip")}
                          >
                            Mark skipped
                          </Menu.Item>
                        </>
                      )}
                      {session.programId && (
                        <Menu.Item asChild value="program">
                          <RouterLink to={`/programs/${session.programId}`}>
                            Open {session.programName}
                          </RouterLink>
                        </Menu.Item>
                      )}
                      <Menu.Item
                        value="delete"
                        color="fg.error"
                        onSelect={() => setConfirmDelete(true)}
                      >
                        Delete workout
                      </Menu.Item>
                    </Menu.Content>
                  </Menu.Positioner>
                </Menu.Root>
              </Dialog.Footer>
            )}
            {confirmDelete && (
              <ConfirmationDialog
                title="Delete workout?"
                description={`Delete “${prescription.title}” on ${fullDate(session.scheduledDate)}?${session.completion ? " This also deletes its completion details." : ""}`}
                confirmLabel="Delete workout"
                destructive
                returnFocus={() => actionsTrigger.current}
                onDismiss={() => setConfirmDelete(false)}
                onConfirm={() => remove.mutate()}
              />
            )}
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
};
