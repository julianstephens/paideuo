import { Badge, Box, Button, Flex, Heading, Link, Stack, Text } from "@chakra-ui/react";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { CSSProperties } from "react";
import { Link as RouterLink, useSearchParams } from "react-router";
import { Notice, PageHeader, Panel } from "../../components/ui";
import { errorMessage } from "../../lib/api/request";
import { useSession } from "../auth/session";
import { addDays, dateKey, formatDate, localToday, monday } from "../calendar/dates";
import { calendarKey } from "../calendar/scheduling";
import { blockEditorPath, programKeys } from "../programs/programs";
import { calendarWeekPath, getAnnualPlan, programLanes, yearKey, yearTimeline } from "./annualPlan";
import type { Span } from "./annualPlan";
import "./annual-plan.scss";

const palettes = ["blue", "teal", "orange", "purple"];
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
  const [hoverWeek, setHoverWeek] = useState<string>();
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
  const showHours = params.get("hours") === "true";
  const setView = (nextYear: number, hours: boolean, nextQuarter = quarter) =>
    setParams({
      year: yearKey(nextYear),
      ...(hours ? { hours: "true" } : {}),
      ...(nextQuarter ? { quarter: String(nextQuarter) } : {}),
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

  const { columns, place, visible, months, weeks } = yearTimeline(year, quarter);
  const programs = (plan.data?.programs ?? []).filter(visible);
  const lanes = programLanes(programs);
  const selectedProgram = programs.find((program) =>
    program.blocks.some((block) => block.id === selectedId && visible(block)),
  );
  const selectedBlock = selectedProgram?.blocks.find(({ id }) => id === selectedId);
  const workload = new Map(hours.data?.workload.map((total) => [total.start, total]));
  const maxMinutes = Math.max(1, ...Array.from(workload.values(), ({ minutes }) => minutes));
  const current = (week: Span) => week.start <= currentEnd && week.end >= currentStart;
  const inspectedWeek = weeks.find(({ start }) => start === hoverWeek);
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
            aria-pressed={showHours}
            onClick={() => setView(year, !showHours)}
          >
            Planned hours
          </Button>
        </Flex>
        <Flex gap="1" wrap="wrap" role="group" aria-label="Timeline scale">
          {["Full year", "Jan–Mar", "Apr–Jun", "Jul–Sep", "Oct–Dec"].map((label, index) => (
            <Button
              key={label}
              size="xs"
              variant={quarter === index ? "subtle" : "ghost"}
              aria-pressed={quarter === index}
              onClick={() => setView(year, showHours, index)}
            >
              {label}
            </Button>
          ))}
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
          className="annual-scroll"
          tabIndex={0}
          role="region"
          aria-label="Scrollable annual timeline"
        >
          <Box
            className={quarter ? "annual-timeline annual-quarter" : "annual-timeline"}
            style={{ "--annual-days": columns } as CSSProperties}
          >
            <Box className="annual-row annual-gridlines" aria-hidden="true">
              {(quarter ? weeks : months).map((span) => (
                <Box key={span.start} gridColumn={place(span)} className="annual-divider" />
              ))}
            </Box>
            <Box className="annual-row annual-gridlines" aria-hidden="true">
              {weeks.filter(current).map((week) => (
                <Box key={week.start} gridColumn={place(week)} className="annual-current" />
              ))}
            </Box>
            <Box className="annual-row annual-months">
              {months.map((month) => (
                <Text key={month.start} gridColumn={place(month)}>
                  {formatDate(month.date, { month: "short" })}
                </Text>
              ))}
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
                  onFocus={() => setHoverWeek(week.start)}
                  onMouseEnter={() => setHoverWeek(week.start)}
                >
                  <RouterLink to={calendarWeekPath(week.start)}>
                    {quarter || current(week) ? new Date(week.start).getUTCDate() : "·"}
                  </RouterLink>
                </Link>
              ))}
            </Box>
            {showHours && hours.isSuccess && (
              <Box className="annual-row annual-hours" aria-hidden="true">
                {weeks.map((week) => {
                  const total = workload.get(week.start);
                  return (
                    <Box
                      key={week.start}
                      gridColumn={place(week)}
                      className="annual-hours-cell"
                      onMouseEnter={() => setHoverWeek(week.start)}
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
            )}
            {lanes.map((lane) => (
              <Box key={lane[0].id} className="annual-programs">
                <Box className="annual-row">
                  {lane.map((program) => {
                    const palette = palettes[programs.indexOf(program) % palettes.length];
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
                        colorPalette={palettes[programs.indexOf(program) % palettes.length]}
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
