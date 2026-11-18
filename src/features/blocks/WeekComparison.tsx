import { Button, Grid, Heading, NativeSelect, Stack, Text } from "@chakra-ui/react";
import { useQuery } from "@tanstack/react-query";
import { useId } from "react";
import { FormField, Notice, Panel } from "../../components/ui";
import { errorMessage } from "../../lib/api/request";
import { PrescriptionSnapshot } from "../calendar/PrescriptionSnapshot";
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
            <Text textTransform="capitalize">{week.weekType} week</Text>
            {week.focus && (
              <Text whiteSpace="pre-wrap" overflowWrap="anywhere">
                {week.focus}
              </Text>
            )}
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
      {report.data &&
        block.slots.map((slot) => (
          <Panel key={slot.id}>
            <Heading size="sm">
              {weekdays[slot.weekday - 1]}
              {" · "}
              {slot.label}
            </Heading>
            <Grid templateColumns={columns} gap="3">
              {weeks.map((week) => {
                const session = sessions.get(`${week.id}/${slot.id}`);
                return (
                  <Stack
                    key={week.id}
                    bg="bg.inset"
                    p="3"
                    borderRadius="md"
                    minW="0"
                    overflowWrap="anywhere"
                  >
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
          </Panel>
        ))}
    </Stack>
  );
};
