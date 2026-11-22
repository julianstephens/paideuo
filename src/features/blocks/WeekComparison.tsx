import { Badge, Button, Flex, Grid, Heading, NativeSelect, Stack, Text } from "@chakra-ui/react";
import { useQuery } from "@tanstack/react-query";
import { useId } from "react";
import { Disclosure, FormField, Notice, Panel } from "../../components/ui";
import { errorMessage } from "../../lib/api/request";
import { PrescriptionSnapshot } from "../calendar/PrescriptionSnapshot";
import { PrescriptionChangeBadges, PrescriptionDiff } from "../prescriptions/PrescriptionDiff";
import { prescriptionChanges } from "../prescriptions/prescriptionChanges";
import type { BlockDetail, ProgramWeek, Slot, blocksApi } from "../programs/programs";
import { weekTitle } from "./WeekProgramming";

const columns = { base: "minmax(0, 1fr)", md: "repeat(2, minmax(0, 1fr))" };

export const WeekComparison = ({
  block,
  api,
  cacheKey,
  pair,
  setPair,
  openCell,
  weekdays,
}: {
  block: BlockDetail;
  api: ReturnType<typeof blocksApi>;
  cacheKey: readonly string[];
  pair: [string, string];
  setPair: (pair: [string, string]) => void;
  weekdays: readonly string[];
  openCell: (week: ProgramWeek, slot: Slot) => void;
}) => {
  const id = useId();
  const left = block.weeks.find((week) => week.id === pair[0]) ?? block.weeks[0];
  const right =
    block.weeks.find((week) => week.id === pair[1] && week.id !== left.id) ??
    block.weeks.find((week) => week.id !== left.id)!;
  const weeks = [left, right] as const;
  const report = useQuery({
    queryKey: [...cacheKey, "compare-weeks", left.id, right.id],
    queryFn: ({ signal }) => api.compareWeeks(left.id, right.id, signal),
    retry: false,
  });
  const sessions = new Map(
    report.data?.map((session) => [`${session.weekId}/${session.slotId}`, session]),
  );

  const entries = block.slots.map((slot) => {
    const first = sessions.get(`${left.id}/${slot.id}`);
    const second = sessions.get(`${right.id}/${slot.id}`);
    const changes =
      first && second ? prescriptionChanges(first, second) : { fields: [], components: [] };
    const status =
      first && second
        ? changes.fields.length || changes.components.length
          ? "Changed"
          : "Unchanged"
        : first
          ? "Removed"
          : second
            ? "Added"
            : "Empty";
    return { slot, first, second, changes, status };
  });
  const changed = entries.filter(({ status }) => status !== "Unchanged" && status !== "Empty");
  const unchanged = entries.filter(({ status }) => status === "Unchanged" || status === "Empty");
  const slotCard = ({ slot, first, second, changes, status }: (typeof entries)[number]) => (
    <Panel key={slot.id}>
      <Flex justify="space-between" gap="2" wrap="wrap" align="baseline">
        <Heading size="sm">
          {weekdays[slot.weekday - 1]} · {slot.label}
        </Heading>
        {status === "Changed" ? (
          <PrescriptionChangeBadges changes={changes} />
        ) : (
          <Badge
            colorPalette={status === "Removed" ? "red" : status === "Added" ? "green" : "gray"}
          >
            {status === "Added" || status === "Removed"
              ? `Workout ${status.toLowerCase()}`
              : status}
          </Badge>
        )}
      </Flex>
      {(!first || !second) && (first || second) && (
        <Text fontWeight="semibold">{(second ?? first)?.title}</Text>
      )}
      {status === "Changed" && <PrescriptionDiff changes={changes} />}
      <Disclosure label="View full prescriptions">
        <Grid templateColumns={columns} gap="3">
          {weeks.map((week, index) => {
            const session = index === 0 ? first : second;
            return (
              <Stack key={week.id} bg="bg.inset" p="3" borderRadius="md" minW="0">
                <Heading size="xs">{weekTitle(week)}</Heading>
                {session ? (
                  <>
                    <Text fontWeight="semibold">{session.title}</Text>
                    <Text textTransform="capitalize">{session.sessionType}</Text>
                    <PrescriptionSnapshot prescription={session} />
                  </>
                ) : (
                  <Text>No prescription</Text>
                )}
                <Button
                  alignSelf="start"
                  size="sm"
                  variant="outline"
                  onClick={() => openCell(week, slot)}
                  aria-label={`${session ? "Edit" : "Create"} ${slot.label} in ${weekTitle(week)}`}
                >
                  {session ? "Edit prescription" : "Create prescription"}
                </Button>
              </Stack>
            );
          })}
        </Grid>
      </Disclosure>
    </Panel>
  );

  return (
    <Stack gap="3" aria-label="Week comparison">
      <Grid templateColumns={columns} gap="3">
        {weeks.map((week, index) => (
          <Panel key={index}>
            <FormField as="div">
              <label htmlFor={`${id}-${index}`}>{index === 0 ? "First week" : "Second week"}</label>
              <NativeSelect.Root>
                <NativeSelect.Field
                  id={`${id}-${index}`}
                  value={week.id}
                  onChange={({ target }) =>
                    setPair(index === 0 ? [target.value, right.id] : [left.id, target.value])
                  }
                >
                  {block.weeks.map((option) => (
                    <option
                      key={option.id}
                      value={option.id}
                      disabled={option.id === weeks[1 - index].id}
                    >
                      {weekTitle(option)}
                    </option>
                  ))}
                </NativeSelect.Field>
                <NativeSelect.Indicator />
              </NativeSelect.Root>
            </FormField>
          </Panel>
        ))}
      </Grid>
      {report.isPending && <Notice role="status">Loading prescriptions…</Notice>}
      {report.isError && (
        <Stack align="start">
          <Notice role="alert">{errorMessage(report.error, "Unable to compare weeks.")}</Notice>
          <Button size="sm" onClick={() => void report.refetch()}>
            Retry
          </Button>
        </Stack>
      )}
      {(left.weekType !== right.weekType || left.focus !== right.focus) && (
        <Panel>
          <Heading size="sm">Week context changes</Heading>
          {left.weekType !== right.weekType && (
            <Text textTransform="capitalize">
              {left.weekType} → {right.weekType} week
            </Text>
          )}
          {left.focus !== right.focus && (
            <Disclosure label="Training focus changed">
              <Grid templateColumns={columns} gap="3">
                {weeks.map((week) => (
                  <Stack key={week.id} gap="1">
                    <Heading size="xs">{weekTitle(week)}</Heading>
                    <Text whiteSpace="pre-wrap">{week.focus || "No focus specified"}</Text>
                  </Stack>
                ))}
              </Grid>
            </Disclosure>
          )}
        </Panel>
      )}
      {report.data && (
        <>
          <Heading as="h3" size="sm">
            {changed.length} {changed.length === 1 ? "changed slot" : "changed slots"}
          </Heading>
          {changed.map(slotCard)}
          {unchanged.length > 0 && (
            <Disclosure label={`Unchanged and empty slots (${unchanged.length})`}>
              <Stack gap="3">{unchanged.map(slotCard)}</Stack>
            </Disclosure>
          )}
        </>
      )}
    </Stack>
  );
};
