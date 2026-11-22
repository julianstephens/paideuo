import {
  Badge,
  Box,
  Button,
  Flex,
  Heading,
  Link,
  NativeSelect,
  Stack,
  Text,
} from "@chakra-ui/react";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { Link as RouterLink, useSearchParams } from "react-router";
import { FormField, Notice, PageHeader, Panel } from "../../components/ui";
import { errorMessage } from "../../lib/api/request";
import { useSession } from "../auth/session";
import { addDays, dateKey, formatDate, localToday, monday } from "../calendar/dates";
import { calendarKey } from "../calendar/scheduling";
import { blockEditorPath, programKeys } from "../programs/programs";
import { calendarWeekPath, getAnnualPlan, programLanes, yearKey, yearTimeline } from "./annualPlan";
import type { Span } from "./annualPlan";
import "./annual-plan.scss";

const palettes = ["blue", "teal", "orange", "purple"];
const quarterLabels = ["Jan–Mar", "Apr–Jun", "Jul–Sep", "Oct–Dec"];
const hoursFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
const dateRange = ({ start, end }: Span) =>
  [start, end].map((date) => formatDate(new Date(date), { dateStyle: "medium" })).join(" – ");
const weekTitle = (week: { position: number; label: string; recovery: boolean }) =>
  `Week ${week.position}${week.label ? " · " + week.label : ""}${week.recovery ? " · Recovery" : ""}`;

export const AnnualPlanPage = () => {
  const session = useSession();
  return session.status === "signed-in" ? (
    <AnnualPlan key={session.ownerId} ownerId={session.ownerId} />
  ) : null;
};

const AnnualPlan = ({ ownerId }: { ownerId: string }) => {
  const [params, setParams] = useSearchParams();
  const [selectedId, select] = useState<string>();
  const [hoverWeek, setHoverWeek] = useState<{ start: string; scope: string }>();
  const today = localToday();
  const currentMonday = monday(today);
  const currentStart = dateKey(currentMonday);
  const currentEnd = dateKey(addDays(currentMonday, 6));
  const requestedYear = params.get("year") ?? "";
  const year =
    /^\d{4}$/.test(requestedYear) && Number(requestedYear)
      ? Number(requestedYear)
      : today.getUTCFullYear();
  const requestedQuarter = params.get("quarter") ?? "";
  const quarter = /^[1-4]$/.test(requestedQuarter) ? Number(requestedQuarter) : 0;
  const requestedMonth = params.get("month") ?? "";
  const month = /^(?:[1-9]|1[0-2])$/.test(requestedMonth) ? Number(requestedMonth) : 0;
  const scope = `${year}/${quarter}/${month}`;
  if (hoverWeek && hoverWeek.scope !== scope) setHoverWeek(undefined);
  const showHours = params.get("hours") === "true";
  const timeline = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (timeline.current) timeline.current.scrollLeft = 0;
  }, [year, quarter, month]);

  const setView = (nextYear: number, hours: boolean, nextQuarter = quarter, nextMonth = month) =>
    setParams({
      year: yearKey(nextYear),
      ...(hours ? { hours: "true" } : {}),
      ...(nextMonth
        ? { month: String(nextMonth) }
        : nextQuarter
          ? { quarter: String(nextQuarter) }
          : {}),
    });

  const plan = useQuery({
    queryKey: [...programKeys.owner(ownerId), "annual-plan", year],
    queryFn: ({ signal }) => getAnnualPlan(year, false, signal),
  });
  const hours = useQuery({
    queryKey: [...calendarKey(ownerId), "annual-plan-hours", year],
    queryFn: ({ signal }) => getAnnualPlan(year, true, signal),
    enabled: showHours,
  });

  const { columns, place, visible, months, weeks } = yearTimeline(year, quarter, month);
  const yearMonths = yearTimeline(year).months;
  const allPrograms = plan.data?.programs ?? [];
  const programs = allPrograms.filter(visible);
  const zoom = month ? `month-${month}` : quarter ? `quarter-${quarter}` : "year";
  const zoomed = month > 0 || quarter > 0;
  const lanes = programLanes(programs);
  const selectedProgram = programs.find((program) =>
    program.blocks.some((block) => block.id === selectedId && visible(block)),
  );
  const selectedBlock = selectedProgram?.blocks.find(({ id }) => id === selectedId);
  const workload = new Map(hours.data?.workload.map((total) => [total.start, total]));
  const maxMinutes = Math.max(1, ...Array.from(workload.values(), ({ minutes }) => minutes));
  const current = (week: Span) => week.start <= currentEnd && week.end >= currentStart;
  const inspectedWeek = weeks.find(({ start }) => start === hoverWeek?.start);
  const workloadLabel = (week: Span) => {
    const total = workload.get(week.start);
    if (!total) return "No scheduled prescriptions";
    const missing = total.missing ? ` · ${total.missing} missing duration` : "";
    return `${hoursFormat.format(total.minutes / 60)} h with known duration${missing}`;
  };

  return (
    <Stack gap="5">
      <PageHeader title="Annual Training Plan" />
      <Panel gap="4">
        <Flex justify="space-between" align="center" wrap="wrap" gap="3">
          <Flex gap="2" align="center" role="group" aria-label="Year navigation">
            <Button
              size="sm"
              variant="outline"
              aria-label="Previous year"
              disabled={year === 1}
              onClick={() => setView(year - 1, showHours)}
            >
              ‹
            </Button>
            <Heading as="h2" size="lg" aria-live="polite">
              {yearKey(year)}
            </Heading>
            <Button
              size="sm"
              variant="outline"
              aria-label="Next year"
              disabled={year === 9999}
              onClick={() => setView(year + 1, showHours)}
            >
              ›
            </Button>
            {year !== today.getUTCFullYear() && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setView(today.getUTCFullYear(), showHours)}
              >
                This year
              </Button>
            )}
          </Flex>
          <Button
            size="sm"
            variant={showHours ? "solid" : "outline"}
            aria-expanded={showHours}
            aria-controls="annual-hours-overlay"
            onClick={() => setView(year, !showHours)}
          >
            {showHours ? "Hide weekly planned hours" : "Show weekly planned hours"}
          </Button>
        </Flex>
        <Flex gap="3" align="end" wrap="wrap">
          <FormField as="div" w={{ base: "full", sm: "16rem" }}>
            <label htmlFor="annual-timeline-zoom">Timeline zoom</label>
            <NativeSelect.Root>
              <NativeSelect.Field
                id="annual-timeline-zoom"
                value={zoom}
                onChange={({ target }) => {
                  const [scale, index] = target.value.split("-");
                  setView(
                    year,
                    showHours,
                    scale === "quarter" ? Number(index) : 0,
                    scale === "month" ? Number(index) : 0,
                  );
                }}
              >
                <option value="year">Full year</option>
                <optgroup label="Quarters">
                  {quarterLabels.map((label, index) => (
                    <option key={label} value={`quarter-${index + 1}`}>
                      {label}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Months">
                  {yearMonths.map(({ date }, index) => (
                    <option key={index} value={`month-${index + 1}`}>
                      {formatDate(date, { month: "long" })}
                    </option>
                  ))}
                </optgroup>
              </NativeSelect.Field>
              <NativeSelect.Indicator />
            </NativeSelect.Root>
          </FormField>
          {zoomed && (
            <Button size="sm" variant="ghost" onClick={() => setView(year, showHours, 0, 0)}>
              Back to full year
            </Button>
          )}
        </Flex>
        <Flex gap="2" wrap="wrap">
          <Badge colorPalette="teal">Current week</Badge>
          <Badge className="annual-recovery" variant="outline">
            Recovery week
          </Badge>
        </Flex>
        {plan.isPending && <Notice role="status">Loading scheduled programs…</Notice>}
        {plan.isError && (
          <Notice role="alert">
            {errorMessage(plan.error, "Unable to load scheduled programs.")}{" "}
            <Button size="xs" onClick={() => void plan.refetch()}>
              Retry
            </Button>
          </Notice>
        )}
        {plan.isSuccess && !programs.length && (
          <Notice>No programs scheduled in this period.</Notice>
        )}
        {showHours && hours.isPending && <Notice role="status">Loading planned hours…</Notice>}
        {showHours && hours.isError && (
          <Notice role="alert">
            {errorMessage(hours.error, "Unable to load planned hours.")}{" "}
            <Button size="xs" onClick={() => void hours.refetch()}>
              Retry
            </Button>
          </Notice>
        )}
        {showHours && hours.isSuccess && (
          <Text fontSize="sm" color="fg.muted">
            {inspectedWeek
              ? `${dateRange(inspectedWeek)} · ${workloadLabel(inspectedWeek)}`
              : "Bars show known hours in each visible week. An amber mark indicates missing durations."}
          </Text>
        )}
        <Box
          ref={timeline}
          className="annual-scroll"
          tabIndex={0}
          role="region"
          aria-label="Scrollable annual timeline"
        >
          <Box
            className={`annual-timeline${month ? " annual-month" : quarter ? " annual-quarter" : ""}`}
            style={{ "--annual-days": columns } as CSSProperties}
          >
            <Box className="annual-row annual-gridlines" aria-hidden="true">
              {(zoomed ? weeks : months).map((span) => (
                <Box key={span.start} gridColumn={place(span)} className="annual-divider" />
              ))}
            </Box>
            <Box className="annual-row annual-gridlines" aria-hidden="true">
              {weeks.filter(current).map((week) => (
                <Box key={week.start} gridColumn={place(week)} className="annual-current" />
              ))}
            </Box>
            <Box className="annual-row annual-months">
              {months.map(({ date, ...span }) => {
                const label = formatDate(date, { month: month ? "long" : "short" });
                return month ? (
                  <Text key={span.start} gridColumn={place(span)} py="2">
                    {label}
                  </Text>
                ) : (
                  <Button
                    key={span.start}
                    gridColumn={place(span)}
                    size="xs"
                    variant="ghost"
                    px="0"
                    minW="0"
                    aria-label={`Zoom to ${formatDate(date, { month: "long" })}`}
                    onClick={() => {
                      setView(year, showHours, 0, date.getUTCMonth() + 1);
                      document.getElementById("annual-timeline-zoom")?.focus();
                    }}
                  >
                    {label}
                  </Button>
                );
              })}
            </Box>
            <Box className="annual-row annual-weeks">
              {weeks.map((week) => (
                <Link
                  key={week.start}
                  asChild
                  gridColumn={place(week)}
                  aria-current={current(week) ? "date" : undefined}
                  aria-label={`${dateRange(week)}${showHours && hours.isSuccess ? " · " + workloadLabel(week) : ""}`}
                  title={dateRange(week)}
                  onFocus={() => setHoverWeek({ start: week.start, scope })}
                  onMouseEnter={() => setHoverWeek({ start: week.start, scope })}
                >
                  <RouterLink to={calendarWeekPath(week.start)}>
                    {zoomed || current(week) ? new Date(week.start).getUTCDate() : "·"}
                  </RouterLink>
                </Link>
              ))}
            </Box>
            <Box id="annual-hours-overlay" hidden={!showHours || !hours.isSuccess}>
              <Box className="annual-row annual-hours" aria-hidden="true">
                {weeks.map((week) => {
                  const total = workload.get(week.start);
                  return (
                    <Box
                      key={week.start}
                      gridColumn={place(week)}
                      className="annual-hours-cell"
                      onMouseEnter={() => setHoverWeek({ start: week.start, scope })}
                    >
                      {!!total?.missing && <span className="annual-missing" />}
                      {!!total?.minutes && (
                        <span
                          className="annual-hours-bar"
                          style={{ height: `${(100 * total.minutes) / maxMinutes}%` }}
                        />
                      )}
                    </Box>
                  );
                })}
              </Box>
            </Box>
            {lanes.map((lane) => (
              <Box key={lane[0].id} className="annual-programs">
                <Box className="annual-row">
                  {lane.map((program) => {
                    const palette = palettes[allPrograms.indexOf(program) % palettes.length];
                    return (
                      <Link
                        key={program.id}
                        asChild
                        gridColumn={place(program)}
                        className="annual-program-bar"
                        bg={`${palette}.solid`}
                        color={`${palette}.contrast`}
                        title={`${program.name} · ${dateRange(program)}`}
                      >
                        <RouterLink to={`/programs/${program.id}`}>
                          <span>{program.name}</span>
                        </RouterLink>
                      </Link>
                    );
                  })}
                </Box>
                <Box className="annual-row">
                  {lane.flatMap((program) =>
                    program.blocks.filter(visible).map((block) => (
                      <Button
                        key={block.id}
                        size="xs"
                        colorPalette={palettes[allPrograms.indexOf(program) % palettes.length]}
                        variant="subtle"
                        className="annual-block"
                        gridColumn={place(block)}
                        title={`${block.name} · ${dateRange(block)}`}
                        aria-pressed={selectedBlock?.id === block.id}
                        onClick={() => select(block.id)}
                      >
                        <span>{block.name}</span>
                      </Button>
                    )),
                  )}
                </Box>
                <Box className="annual-row">
                  {lane.flatMap((program) =>
                    program.blocks.filter(visible).flatMap((block) =>
                      block.weeks.filter(visible).map((week) => (
                        <Link
                          key={week.id}
                          asChild
                          gridColumn={place(week)}
                          className={
                            week.recovery
                              ? "annual-training-week annual-recovery"
                              : "annual-training-week"
                          }
                          aria-label={`${block.name} · ${weekTitle(week)} · ${dateRange(week)}`}
                          title={`${weekTitle(week)} · ${dateRange(week)}`}
                        >
                          <RouterLink
                            to={`${blockEditorPath(program.id, block.id)}?week=${week.id}`}
                          >
                            {week.recovery ? "R" : week.position}
                          </RouterLink>
                        </Link>
                      )),
                    ),
                  )}
                </Box>
              </Box>
            ))}
          </Box>
        </Box>
        {selectedProgram && selectedBlock && (
          <Stack
            as="section"
            aria-label="Selected block"
            aria-live="polite"
            gap="2"
            borderTopWidth="1px"
            pt="4"
          >
            <Flex justify="space-between" wrap="wrap" align="center" gap="2">
              <Heading as="h3" size="md">
                {selectedBlock.name}
              </Heading>
              <Badge>
                {selectedBlock.durationWeeks} {selectedBlock.durationWeeks === 1 ? "week" : "weeks"}
              </Badge>
            </Flex>
            <Text fontSize="sm" color="fg.muted">
              {selectedProgram.name} · {dateRange(selectedBlock)}
            </Text>
            <Text>{selectedBlock.objective || "No objective set."}</Text>
            <Flex gap="2" wrap="wrap">
              <Button asChild size="sm" variant="outline">
                <RouterLink to={blockEditorPath(selectedProgram.id, selectedBlock.id)}>
                  Open block editor
                </RouterLink>
              </Button>
              <Button asChild size="sm" variant="ghost">
                <RouterLink to={calendarWeekPath(selectedBlock.start)}>
                  Open first calendar week
                </RouterLink>
              </Button>
            </Flex>
          </Stack>
        )}
      </Panel>
    </Stack>
  );
};
