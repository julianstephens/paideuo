import {
  Badge,
  Box,
  Button,
  Dialog,
  Flex,
  Grid,
  Heading,
  Input,
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
import { FormField, Notice, PageHeader, Panel } from "../../components/ui";
import { errorMessage } from "../../lib/api/request";
import { CalendarCompliance } from "../compliance/CalendarCompliance";
import { formatPlannedDuration, formatPlannedRpe } from "../prescriptions/format";
import { metricsKey } from "../compliance/metrics";
import { useSession } from "../auth/session";
import { programKeys } from "../programs/programs";
import { CheckInDialog } from "../recovery/CheckInDialog";
import { reviewKey } from "../reviews/reviews";
import { PrescriptionSnapshot } from "./PrescriptionSnapshot";
import { CompletionForm, CompletionResults } from "./SessionCompletion";
import { WorkoutDialog } from "./WorkoutDialog";
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
const palettes = { planned: "gray", completed: "green", skipped: "orange", rest: "blue" };

const calendarRange = (date: Date, view: View) => {
  const first = monday(view === "month" ? monthStart(date) : date);
  if (view === "week") return { first, last: addDays(first, 6) };
  const lastInMonth = new Date(date);
  lastInMonth.setUTCMonth(lastInMonth.getUTCMonth() + 1, 0);
  return { first, last: addDays(monday(lastInMonth), 6) };
};

const StatusBadge = ({ status }: { status: CalendarSession["status"] }) => (
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
  const selectSession = (id?: string) => {
    const next = new URLSearchParams(params);
    if (id) next.set("session", id);
    else next.delete("session");
    setParams(next, { replace: true });
  };
  const [checkInDate, setCheckInDate] = useState<string>();
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
      Add workout
    </Button>
  );
  const checkInTrigger = useRef<HTMLButtonElement>(null);
  const checkInButton = (date: string) => (
    <Button
      type="button"
      variant="ghost"
      size="xs"
      alignSelf="start"
      maxW="100%"
      aria-label={`Check in for ${fullDate(date)}`}
      onClick={(event) => {
        checkInTrigger.current = event.currentTarget;
        setCheckInDate(date);
      }}
    >
      Check in
    </Button>
  );
  const desktop = useBreakpointValue({ base: false, md: true });
  const requestedView = params.get("view");
  const view: View = requestedView === "month" ? "month" : "week";
  const today = localToday();
  const date = parseDate(params.get("date")) ?? today;
  const { first, last } = calendarRange(date, view);
  const start = dateKey(first);
  const end = dateKey(last);
  const queryClient = useQueryClient();
  const queryKey = [...calendarKey(ownerId), start, end] as const;
  const query = useQuery({
    queryKey,
    queryFn: ({ signal }) => schedulingApi.calendar(start, end, signal),
    refetchInterval: 60_000,
    retry: false,
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
  const selected = selectedCalendarSession(query.data?.sessions, params);
  const navigate = (nextDate: Date, nextView: View) => {
    setCheckInDate(undefined);
    setWorkoutDate(undefined);
    setParams({ date: dateKey(nextDate), view: nextView });
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
    <Stack gap="3">
      <PageHeader title="Calendar" />
      <Flex justify="space-between" wrap="wrap" gap="2" align="center">
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
            ? { base: "minmax(0, 1fr)", xl: "minmax(0, 1fr) 15rem" }
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
              : { base: "1fr", lg: "repeat(7, minmax(0, 1fr))" }
          }
          gap={desktopMonth ? "1px" : "1"}
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
                  variant={key === dateKey(date) ? "solid" : "outline"}
                  h="12"
                  px="0"
                  minW="0"
                  flexDirection="column"
                  gap="0"
                  aria-current={current ? "date" : undefined}
                  aria-pressed={key === dateKey(date)}
                  aria-label={`${fullDate(key)}, ${sessions.length} sessions`}
                  opacity={outside ? 0.65 : 1}
                  onClick={() => navigate(day, view)}
                >
                  {day.getUTCDate()}
                  {sessions.length > 0 && (
                    <Text fontSize="2xs">
                      {sessions.length} {sessions.length === 1 ? "session" : "sessions"}
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
                borderRadius={desktopMonth ? undefined : "md"}
                overflow="clip"
                minH={desktopMonth ? "20" : { base: "auto", lg: "32" }}
                bg={outside ? "bg.inset" : "bg.panel"}
              >
                <Flex
                  align="center"
                  px="2"
                  py={desktopMonth ? "0.5" : "1.5"}
                  bg={current ? "teal.solid" : "bg.inset"}
                  color={current ? "teal.contrast" : outside ? "fg.muted" : "fg"}
                  borderBottomWidth="1px"
                  gap="2"
                >
                  <chakra.time
                    dateTime={key}
                    fontSize="sm"
                    fontWeight="semibold"
                    truncate={isMonth ? undefined : { base: false, lg: true }}
                    aria-current={current ? "date" : undefined}
                  >
                    {isMonth
                      ? day.getUTCDate()
                      : formatDate(day, { ...dayOptions, weekday: "short" })}
                  </chakra.time>
                  {current && (
                    <Text fontSize="xs" fontWeight="medium" hideFrom={isMonth ? undefined : "lg"}>
                      Today
                    </Text>
                  )}
                </Flex>
                <Stack gap={desktopMonth ? "0.5" : "1.5"} p={desktopMonth ? "1" : "2"}>
                  {!sessions.some((session) => session.status === "rest") && (
                    <>
                      {checkInButton(key)}
                      {addWorkoutButton(key)}
                    </>
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
          {checkInButton(dateKey(date))}
          {addWorkoutButton(dateKey(date))}
          {query.isSuccess && !byDay.has(dateKey(date)) && <Text>No sessions scheduled.</Text>}
          <SessionButtons sessions={byDay.get(dateKey(date)) ?? []} select={selectSession} />
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
      {checkInDate && (
        <CheckInDialog
          key={checkInDate}
          date={checkInDate}
          ownerId={ownerId}
          close={() => setCheckInDate(undefined)}
          trigger={() => checkInTrigger.current}
        />
      )}
      {selected && (
        <SessionDetail
          key={selected.id}
          session={selected}
          ownerId={ownerId}
          close={() => selectSession(undefined)}
          onMoved={(date) => navigate(new Date(date + "T00:00:00Z"), view)}
          onExecuted={(state) =>
            queryClient.setQueryData<CalendarReport>(
              queryKey,
              (report) =>
                report && {
                  ...report,
                  sessions: report.sessions.map((session) =>
                    session.id === selected.id ? { ...session, ...state } : session,
                  ),
                },
            )
          }
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
    const palette = palettes[session.status];
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
        h={compact ? "6" : "auto"}
        minW="0"
        w="full"
        gap="0.5"
        px="1.5"
        py={compact ? "0" : "1.5"}
        onClick={() => select(session.id)}
        aria-label={compact ? `${title}, ${session.status}` : undefined}
        title={compact ? `${title} · ${session.status}` : undefined}
      >
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
              {sessionType} · {session.status}
            </Text>
            {(planned !== null || actual != null) && (
              <Text as="span" fontWeight="normal" fontSize="xs" color="fg.muted">
                {[planned && `${planned} planned`, actual != null && `${actual} min actual`]
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
  ownerId,
  close,
  onMoved,
  onExecuted,
  reload,
}: {
  session: CalendarSession;
  ownerId: string;
  close: () => void;
  onMoved: (date: string) => void;
  onExecuted: (state: SessionExecutionState) => void;
  reload: () => Promise<CalendarSession | undefined>;
}) => {
  const { prescription } = session;
  const [moveDate, setMoveDate] = useState<string>();
  const [editing, setEditing] = useState<CalendarSession>();
  const past = session.scheduledDate < todayInTimezone(session.timezone);
  const [completionRevision, setCompletionRevision] = useState<string>();
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
    onSuccess: async (state) => {
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
  const confirmDelete = () => {
    const details = session.completion ? " This also deletes its completion details." : "";
    if (
      window.confirm(
        `Delete “${prescription.title}” on ${fullDate(session.scheduledDate)}?${details}`,
      )
    ) {
      remove.mutate();
    }
  };
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
                        : "Complete session"
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
                        Planned workout
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
                      Mark complete
                    </Button>
                  )}
                {session.status === "skipped" && !past && (
                  <Button
                    disabled={busy || executionConflict}
                    onClick={() => toggleStatus("restore")}
                  >
                    Restore to planned
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
                    <Button variant="ghost" disabled={busy}>
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
                      <Menu.Item value="delete" color="fg.error" onSelect={confirmDelete}>
                        Delete workout
                      </Menu.Item>
                    </Menu.Content>
                  </Menu.Positioner>
                </Menu.Root>
              </Dialog.Footer>
            )}
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
};
