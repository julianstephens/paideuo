import { Button, Input, Stack, Tabs, Text } from "@chakra-ui/react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router";
import { FormField, Notice, PageHeader } from "../../components/ui";
import { apiRequest, errorMessage } from "../../lib/api/request";
import { useSession } from "../auth/session";
import { addDays, dateKey, formatDate, localToday, monday, parseDate } from "../calendar/dates";
import { programKeys, programsApi } from "../programs/programs";
import { RecoveryResults } from "../recovery/RecoveryResults";
import { weeklyReviewUrl } from "../reviews/reviews";
import { BlockComparison } from "./BlockComparison";
import { MetricPreferences } from "./MetricPreferences";
import { useCheckInPreferences } from "../recovery/checkInPreferences";
import { FilterFields, FilterSelect, MetricsFilters } from "./MetricsFilters";
import { MetricsCharts } from "./MetricsCharts";
import { sessionTypes } from "../templates/templates";
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
  const checkInDate = dateKey(parseDate(params.get("date")) ?? localToday());
  const loadFilter = sessionTypes.find((type) => type === params.get("sessionType")) ?? "all";
  const overviewFilters = ["program", "week", "block", "start", "end", "metric"];
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

  const hasFilters = (keys: string[]) => keys.some((key) => params.has(key));
  const resetFilters = (keys: string[]) =>
    updateParams(Object.fromEntries(keys.map((key) => [key, null])));

  const programPicker = (
    <FilterSelect
      label={view === "recovery" ? "Program for training comparison" : "Program"}
      value={programFilter || "all"}
      disabled={!dated && !program}
      onChange={(value) => updateParams({ program: value === "all" ? null : value, block: null })}
    >
      {dated && <option value="all">All programs and one-off sessions</option>}
      {!dated && !program && (
        <option value="all">
          {programs.isPending ? "Loading programs…" : "No scheduled programs"}
        </option>
      )}
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
    </FilterSelect>
  );

  return (
    <Stack gap="4">
      <PageHeader title="Metrics" />
      <Tabs.Root
        value={dashboard ? "overview" : view}
        onValueChange={({ value }) => {
          const previousPeriod = periods.find((period) => period === params.get("period"));
          updateParams({
            view: value === "overview" ? (previousPeriod ?? "weekly") : value,
            period: dashboard ? view : (previousPeriod ?? null),
            tab: null,
          });
        }}
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
              <MetricsFilters
                onReset={() => resetFilters(overviewFilters)}
                resetDisabled={!hasFilters(overviewFilters)}
              >
                <FilterFields>
                  <FilterSelect
                    label="Period"
                    value={view}
                    onChange={(value) => updateParams({ view: value, tab: null })}
                  >
                    {periods.map((period) => (
                      <option key={period} value={period}>
                        {views[period]}
                      </option>
                    ))}
                  </FilterSelect>
                  {programPicker}
                  {view === "weekly" && (
                    <FormField as="div" flex="1 1 12rem" minW="0" maxW="sm">
                      <label htmlFor="metrics-week">Date within week</label>
                      <Input
                        id="metrics-week"
                        type="date"
                        min="0001-01-01"
                        max="9999-12-31"
                        value={dateKey(requestedWeek ?? currentWeek)}
                        onChange={({ target }) => updateParams({ week: target.value || null })}
                      />
                    </FormField>
                  )}
                  {view === "block" && (
                    <FilterSelect
                      label="Block"
                      disabled={!report.data?.blocks.length}
                      value={
                        (report.isPlaceholderData && block ? block : report.data?.blockId) ?? ""
                      }
                      onChange={(value) => updateParams({ block: value })}
                    >
                      {!report.data?.blocks.length && (
                        <option value="">
                          {report.isLoading ? "Loading blocks…" : "No blocks available"}
                        </option>
                      )}
                      {report.data?.blocks.map(({ id, label }) => (
                        <option key={id} value={id}>
                          {label}
                        </option>
                      ))}
                    </FilterSelect>
                  )}
                  {view === "custom" &&
                    (
                      [
                        ["start", start],
                        ["end", end],
                      ] as const
                    ).map(([key, value]) => (
                      <FormField as="div" key={key} flex="1 1 12rem" minW="0" maxW="sm">
                        <label htmlFor={`metrics-${key}`}>
                          {key === "start" ? "Start date" : "End date"}
                        </label>
                        <Input
                          id={`metrics-${key}`}
                          type="date"
                          min="0001-01-01"
                          max="9999-12-31"
                          value={value}
                          onChange={({ target }) => updateParams({ [key]: target.value })}
                        />
                      </FormField>
                    ))}
                  <FilterSelect
                    label="Metric"
                    value={selected ?? ""}
                    disabled={!preferences.data}
                    onChange={(value) => updateParams({ metric: value || null })}
                  >
                    <option value="">All visible metrics</option>
                    {metricKeys
                      .filter((key) => !preferences.data?.hiddenCharts.includes(key))
                      .map((key) => (
                        <option key={key} value={key}>
                          {metricLabels[key]}
                        </option>
                      ))}
                  </FilterSelect>
                </FilterFields>
                {view === "weekly" && (
                  <Text color="fg.muted" fontSize="sm">
                    Week of {formatDate(reportWeek, { dateStyle: "medium" })}
                  </Text>
                )}
                {dateError && (
                  <Notice role="alert">Choose valid dates spanning at most 366 days.</Notice>
                )}
              </MetricsFilters>
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
                  selected={selected}
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
          <Stack gap="4">
            <MetricsFilters
              onReset={() => resetFilters(["program", "block", "sessionType"])}
              resetDisabled={!hasFilters(["program", "block", "sessionType"])}
            >
              <FilterFields>
                {programPicker}
                <FilterSelect
                  label="Session type"
                  value={loadFilter}
                  disabled={!program}
                  onChange={(value) =>
                    updateParams({ sessionType: value === "all" ? null : value })
                  }
                >
                  <option value="all">All session types</option>
                  {sessionTypes.map((type) => (
                    <option key={type} value={type}>
                      {type.charAt(0).toUpperCase() + type.slice(1)}
                    </option>
                  ))}
                </FilterSelect>
              </FilterFields>
            </MetricsFilters>
            {program && (
              <TrainingLoad ownerId={ownerId} programId={program.id} filter={loadFilter} />
            )}
            {programs.isPending && <Notice role="status">Loading programs…</Notice>}
            {programs.isSuccess && !program && (
              <Notice>Schedule a program to explore training load.</Notice>
            )}
          </Stack>
        </Tabs.Content>
        <Tabs.Content value="recovery">
          <RecoveryResults
            ownerId={ownerId}
            programId={program?.id}
            date={checkInDate}
            trend={params.get("trend")}
            updateParams={updateParams}
            onReset={() => resetFilters(["date", "trend", "program", "block"])}
            resetDisabled={!hasFilters(["date", "trend", "program", "block"])}
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
