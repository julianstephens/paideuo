import { Button, Flex, Input, NativeSelect, Stack, Tabs } from "@chakra-ui/react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router";
import { FormField, Notice, PageHeader, Panel } from "../../components/ui";
import { apiRequest, errorMessage } from "../../lib/api/request";
import { useSession } from "../auth/session";
import { addDays, dateKey, localToday, monday, parseDate } from "../calendar/dates";
import { programKeys, programsApi } from "../programs/programs";
import { RecoveryResults } from "../recovery/RecoveryResults";
import { weeklyReviewUrl } from "../reviews/reviews";
import { BlockComparison } from "./BlockComparison";
import { MetricPreferences } from "./MetricPreferences";
import { useCheckInPreferences } from "../recovery/checkInPreferences";
import { MetricsCharts } from "./MetricsCharts";
import { TrainingLoad } from "./TrainingLoad";
import { metricKeys, metricLabels, metricsKey } from "./metrics";
import type { MetricsReport } from "./metrics";

const views = {
  weekly: "Weekly",
  block: "Block",
  program: "Program",
  custom: "Custom range",
  compare: "Compare blocks",
  load: "Training load",
  recovery: "Recovery & nutrition",
  settings: "Settings",
} as const;

const periods = ["weekly", "block", "program", "custom"] as const;
const sections = {
  overview: "Overview",
  compare: views.compare,
  load: views.load,
  recovery: views.recovery,
  settings: views.settings,
} as const;

export const MetricsPage = () => {
  const session = useSession();
  return session.status === "signed-in" ? (
    <Metrics key={session.ownerId} ownerId={session.ownerId} />
  ) : null;
};

const Metrics = ({ ownerId }: { ownerId: string }) => {
  const [params, setParams] = useSearchParams();
  const programs = useQuery({
    queryKey: programKeys.list(ownerId),
    queryFn: ({ signal }) => programsApi.list(signal),
    retry: false,
  });
  const preferences = useCheckInPreferences(ownerId);
  const scheduled = programs.data?.filter(({ scheduled }) => scheduled) ?? [];
  const requestedProgram = params.get("program");
  const tab = params.get("tab") ?? "";
  const requested = params.get("view") ?? tab;
  const view =
    requested === "compliance"
      ? "program"
      : requested === "check-in"
        ? "recovery"
        : Object.hasOwn(views, requested)
          ? (requested as keyof typeof views)
          : "weekly";
  const dashboard =
    view === "weekly" || view === "block" || view === "program" || view === "custom";
  const requiresProgram = view === "block" || view === "program";
  const dated = view === "weekly" || view === "custom";
  const selectedProgram = scheduled.find(({ id }) => id === requestedProgram);
  const program = selectedProgram ?? (dated ? undefined : scheduled[0]);
  const programFilter = dated && requestedProgram !== "all" ? requestedProgram : program?.id;
  const needsPrograms = view !== "settings";
  const currentWeek = monday(localToday());
  const requestedWeek = parseDate(params.get("week"));
  const reportWeek = requestedWeek ? monday(requestedWeek) : currentWeek;
  const start = params.get("start") ?? dateKey(reportWeek);
  const end = params.get("end") ?? dateKey(addDays(reportWeek, 6));
  const block = params.get("block") ?? "";
  const first = parseDate(start);
  const last = parseDate(end);
  const dateError =
    view === "custom" &&
    (!first || !last || +last - +first < 0 || +last - +first >= 366 * 86_400_000);
  const checkInDate = params.get("date");
  const selected =
    metricKeys.find(
      (key) => key === params.get("metric") && !preferences.data?.hiddenCharts.includes(key),
    ) ?? null;

  const updateParams = (changes: Record<string, string | null>) =>
    setParams((current) => {
      const next = new URLSearchParams(current);
      for (const [key, value] of Object.entries(changes)) {
        if (value === null) next.delete(key);
        else next.set(key, value);
      }
      return next;
    });

  const filters = new URLSearchParams({ view });
  if (programFilter) filters.set("program", programFilter);
  if (view === "weekly") filters.set("start", dateKey(reportWeek));
  if (view === "custom") {
    filters.set("start", start);
    filters.set("end", end);
  }
  if (view === "block" && block) filters.set("block", block);
  const report = useQuery<MetricsReport>({
    queryKey: [...metricsKey(ownerId), view, filters.get("program"), filters.toString()],
    placeholderData: (previous, previousQuery) =>
      view === "block" &&
      previousQuery?.queryKey[2] === view &&
      previousQuery.queryKey[3] === filters.get("program")
        ? previous
        : undefined,
    queryFn: ({ signal }) =>
      apiRequest<MetricsReport>(`/api/paideuo/v1/metrics?${filters}`, "GET", undefined, signal),
    enabled:
      dashboard && (dated || programs.isSuccess) && (!requiresProgram || !!program) && !dateError,
    retry: false,
  });

  const programPicker = (dated || program) && (
    <FormField as="div" flex="1 1 12rem" minW="0" maxW="sm">
      <label htmlFor="metrics-program">Program</label>
      <NativeSelect.Root>
        <NativeSelect.Field
          id="metrics-program"
          value={programFilter || "all"}
          onChange={({ target }) =>
            updateParams({
              program: target.value,
              block: null,
            })
          }
        >
          {dated && <option value="all">All programs and one-off sessions</option>}
          {dated && programFilter && !selectedProgram && (
            <option value={programFilter}>
              {programs.isPending ? "Loading program…" : "Selected program"}
            </option>
          )}
          {scheduled.map(({ id, name }) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </NativeSelect.Field>
        <NativeSelect.Indicator />
      </NativeSelect.Root>
    </FormField>
  );

  return (
    <Stack gap="4">
      <PageHeader title="Metrics" />
      <Tabs.Root
        value={dashboard ? "overview" : view}
        onValueChange={({ value }) =>
          updateParams({ view: value === "overview" ? "weekly" : value, tab: null })
        }
        variant="line"
        lazyMount
        unmountOnExit
      >
        <Tabs.List aria-label="Metrics views" flexWrap="wrap">
          {Object.entries(sections).map(([key, label]) => (
            <Tabs.Trigger key={key} value={key}>
              {label}
            </Tabs.Trigger>
          ))}
        </Tabs.List>
        {needsPrograms && programs.isError && (
          <Stack align="start" mt="4">
            <Notice role="alert">{errorMessage(programs.error, "Unable to load programs.")}</Notice>
            <Button size="sm" onClick={() => void programs.refetch()}>
              Retry
            </Button>
          </Stack>
        )}
        {dashboard && (
          <Tabs.Content value="overview">
            <Stack gap={{ base: "4", md: "6" }}>
              <Panel gap="4">
                <Flex gap="1" wrap="wrap" role="group" aria-label="Report period">
                  {periods.map((period) => (
                    <Button
                      key={period}
                      size="sm"
                      variant={view === period ? "solid" : "ghost"}
                      aria-pressed={view === period}
                      onClick={() => updateParams({ view: period, tab: null })}
                    >
                      {views[period]}
                    </Button>
                  ))}
                </Flex>
                <Flex gap="3" wrap="wrap" align="end">
                  {programPicker}
                  {view === "weekly" && (
                    <FormField as="div" flex="1 1 12rem" minW="0" maxW="sm">
                      <label htmlFor="metrics-week">Date within week</label>
                      <Input
                        id="metrics-week"
                        type="date"
                        value={dateKey(requestedWeek ?? currentWeek)}
                        onChange={({ target }) => updateParams({ week: target.value || null })}
                      />
                    </FormField>
                  )}
                  {view === "block" && !!report.data?.blocks.length && (
                    <FormField as="div" flex="1 1 12rem" minW="0" maxW="sm">
                      <label htmlFor="metrics-block">Block</label>
                      <NativeSelect.Root>
                        <NativeSelect.Field
                          id="metrics-block"
                          value={
                            (report.isPlaceholderData && block ? block : report.data.blockId) ?? ""
                          }
                          onChange={({ target }) => updateParams({ block: target.value })}
                        >
                          {report.data.blocks.map(({ id, label }) => (
                            <option key={id} value={id}>
                              {label}
                            </option>
                          ))}
                        </NativeSelect.Field>
                        <NativeSelect.Indicator />
                      </NativeSelect.Root>
                    </FormField>
                  )}
                  {view === "custom" && (
                    <>
                      {(
                        [
                          ["start", start],
                          ["end", end],
                        ] as const
                      ).map(([key, value]) => (
                        <FormField as="div" key={key} flex="1 1 10rem" minW="0">
                          <label htmlFor={`metrics-${key}`}>
                            {key === "start" ? "Start date" : "End date"}
                          </label>
                          <Input
                            id={`metrics-${key}`}
                            type="date"
                            value={value}
                            onChange={({ target }) => updateParams({ [key]: target.value })}
                          />
                        </FormField>
                      ))}
                      <FormField as="div" flex="1 1 12rem" minW="0">
                        <label htmlFor="metrics-chart">Filter metrics</label>
                        <NativeSelect.Root>
                          <NativeSelect.Field
                            id="metrics-chart"
                            value={selected ?? ""}
                            onChange={({ target }) =>
                              updateParams({ metric: target.value || null })
                            }
                          >
                            <option value="">All visible metrics</option>
                            {metricKeys
                              .filter((key) => !preferences.data?.hiddenCharts.includes(key))
                              .map((key) => (
                                <option key={key} value={key}>
                                  {metricLabels[key]}
                                </option>
                              ))}
                          </NativeSelect.Field>
                          <NativeSelect.Indicator />
                        </NativeSelect.Root>
                      </FormField>
                    </>
                  )}
                </Flex>
                {dateError && (
                  <Notice role="alert">Choose valid dates spanning at most 366 days.</Notice>
                )}
              </Panel>
              {((requiresProgram && programs.isPending) ||
                report.isLoading ||
                report.isPlaceholderData ||
                preferences.isPending) && <Notice role="status">Loading metrics…</Notice>}
              {requiresProgram && programs.isSuccess && !program && (
                <Notice>Schedule a program to see this report.</Notice>
              )}
              {report.isError && (
                <Stack align="start">
                  <Notice role="alert">
                    {errorMessage(report.error, "Unable to load metrics.")}
                  </Notice>
                  <Button size="sm" onClick={() => void report.refetch()}>
                    Retry
                  </Button>
                </Stack>
              )}
              {preferences.isError && !preferences.data && (
                <Stack align="start">
                  <Notice role="alert">Unable to load metric preferences.</Notice>
                  <Button size="sm" onClick={() => void preferences.refetch()}>
                    Retry preferences
                  </Button>
                </Stack>
              )}
              {report.data && !report.isPlaceholderData && preferences.data && !dateError && (
                <MetricsCharts
                  report={report.data}
                  preferences={preferences.data}
                  reviewUrl={
                    view === "block" && program
                      ? (weekId) => weeklyReviewUrl(program.id, weekId)
                      : undefined
                  }
                  weekly={view === "weekly"}
                  selected={view === "custom" ? selected : null}
                />
              )}
            </Stack>
          </Tabs.Content>
        )}
        <Tabs.Content value="compare">
          {programs.isPending && <Notice role="status">Loading programs…</Notice>}
          {programs.isSuccess && (
            <BlockComparison
              ownerId={ownerId}
              params={params}
              programs={programs.data}
              updateParams={updateParams}
              unit={preferences.data?.durationUnit ?? "hours"}
            />
          )}
        </Tabs.Content>
        <Tabs.Content value="load">
          {program ? (
            <Stack gap="3">
              <Flex>{programPicker}</Flex>
              <TrainingLoad key={program.id} ownerId={ownerId} programId={program.id} />
            </Stack>
          ) : (
            programs.isSuccess && <Notice>Schedule a program to explore training load.</Notice>
          )}
        </Tabs.Content>
        <Tabs.Content value="recovery">
          <RecoveryResults
            key={checkInDate}
            ownerId={ownerId}
            programId={program?.id}
            initialDate={checkInDate}
            programPicker={programPicker}
          />
        </Tabs.Content>
        <Tabs.Content value="settings">
          <MetricPreferences ownerId={ownerId} />
        </Tabs.Content>
      </Tabs.Root>
    </Stack>
  );
};
