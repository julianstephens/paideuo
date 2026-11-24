import { Button, Flex, Heading, Input, Link, Stack, Text, chakra } from "@chakra-ui/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link as RouterLink } from "react-router";
import { FormField, Notice, Panel } from "../../components/ui";
import { errorMessage } from "../../lib/api/request";
import { metricsKey } from "../compliance/metrics";
import { isProgramEditable, programKeys } from "../programs/programs";
import type { Program } from "../programs/programs";
import { fullDate, parseDate } from "./dates";
import { ScheduleRevisionReview } from "./ScheduleRevisionReview";
import { calendarKey, schedulingApi } from "./scheduling";
import type { SchedulePreview } from "./scheduling";

export const ProgramScheduling = ({ program, ownerId }: { program: Program; ownerId: string }) => {
  const [open, setOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);

  const editable = isProgramEditable(program.status);
  if (program.schedule) {
    return (
      <Stack align="start">
        <Text>
          Starts {fullDate(program.schedule.startDate)} · {program.schedule.timezone}
        </Text>
        <Link asChild variant="underline">
          <RouterLink to={`/?date=${program.schedule.startDate}`}>View in Calendar</RouterLink>
        </Link>
        {program.pendingScheduleChanges && (
          <Notice>
            Programming changes are pending. Calendar sessions use the confirmed schedule.
          </Notice>
        )}
        {editable &&
          (reviewOpen ? (
            <ScheduleRevisionReview
              ownerId={ownerId}
              programId={program.id}
              close={() => setReviewOpen(false)}
            />
          ) : (
            <Button variant="outline" onClick={() => setReviewOpen(true)}>
              Review calendar changes
            </Button>
          ))}
      </Stack>
    );
  }
  if (!editable) return null;
  return open ? (
    <ScheduleForm programId={program.id} ownerId={ownerId} close={() => setOpen(false)} />
  ) : (
    <Button alignSelf="start" onClick={() => setOpen(true)}>
      Schedule program
    </Button>
  );
};

const ScheduleForm = ({
  programId,
  ownerId,
  close,
}: {
  programId: string;
  ownerId: string;
  close: () => void;
}) => {
  const [startDate, setStartDate] = useState("");
  const [timezone, setTimezone] = useState(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  );
  const [review, setReview] = useState<SchedulePreview>();
  const queryClient = useQueryClient();
  const fields = { startDate, timezone: timezone.trim() };
  const preview = useMutation({
    mutationFn: () => schedulingApi.preview(programId, fields),
    onSuccess: setReview,
  });
  const confirm = useMutation({
    mutationFn: (revision: string) => schedulingApi.confirm(programId, fields, revision),
    onSuccess: async (schedule) => {
      queryClient.setQueryData<Program>(
        programKeys.detail(ownerId, programId),
        (program) =>
          program && {
            ...program,
            scheduled: true,
            status: program.status === "draft" ? "active" : program.status,
            schedule,
            pendingScheduleChanges: false,
          },
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: programKeys.owner(ownerId) }),
        queryClient.invalidateQueries({ queryKey: calendarKey(ownerId) }),
        queryClient.invalidateQueries({ queryKey: metricsKey(ownerId) }),
      ]);
      close();
    },
  });
  const busy = preview.isPending || confirm.isPending;
  const invalidStart = !!startDate && parseDate(startDate)?.getUTCDay() !== 1;
  const resetReview = () => {
    setReview(undefined);
    preview.reset();
    confirm.reset();
  };

  return (
    <Panel as="section">
      <Heading as="h2" size="md">
        Schedule program
      </Heading>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy && !invalidStart && !review) preview.mutate();
        }}
      >
        <Stack gap="3">
          <Flex gap="3" wrap="wrap">
            <FormField>
              Monday start date
              <Input
                type="date"
                required
                value={startDate}
                disabled={busy}
                onChange={(event) => {
                  setStartDate(event.target.value);
                  resetReview();
                }}
              />
            </FormField>
            <FormField>
              Timezone
              <Input
                required
                maxLength={100}
                value={timezone}
                disabled={busy}
                onChange={(event) => {
                  setTimezone(event.target.value);
                  resetReview();
                }}
              />
            </FormField>
          </Flex>
          {invalidStart && <Notice role="alert">Choose a Monday start date.</Notice>}
          {preview.isError && (
            <Notice role="alert">
              {errorMessage(preview.error, "Unable to preview the schedule. Try again.")}
            </Notice>
          )}
          {confirm.isError && (
            <Notice role="alert">
              {errorMessage(confirm.error, "Unable to confirm the schedule. Try again.")}
            </Notice>
          )}
          {review && (
            <Stack gap="2">
              <Heading as="h3" size="sm">
                Schedule preview · {review.sessions.length} sessions
              </Heading>
              <Stack as="ol" gap="0" listStyleType="none" divideY="1px">
                {review.sessions.map(({ sourcePrescriptionId, scheduledDate, prescription }) => (
                  <Flex
                    as="li"
                    key={sourcePrescriptionId}
                    py="2"
                    gap="2"
                    wrap="wrap"
                    justify="space-between"
                  >
                    <chakra.time dateTime={scheduledDate}>{fullDate(scheduledDate)}</chakra.time>
                    <Text fontWeight="medium">{prescription.title}</Text>
                  </Flex>
                ))}
              </Stack>
            </Stack>
          )}
          <Flex gap="2" wrap="wrap">
            {review ? (
              <>
                <Button
                  type="button"
                  loading={confirm.isPending}
                  onClick={() => confirm.mutate(review.revision)}
                >
                  Confirm schedule
                </Button>
                {confirm.isError && (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy}
                    onClick={() => {
                      resetReview();
                      preview.mutate();
                    }}
                  >
                    Refresh preview
                  </Button>
                )}
              </>
            ) : (
              <Button
                type="submit"
                loading={preview.isPending}
                disabled={!startDate || !fields.timezone || invalidStart}
              >
                Preview schedule
              </Button>
            )}
            <Button type="button" variant="outline" disabled={busy} onClick={close}>
              Cancel
            </Button>
          </Flex>
        </Stack>
      </form>
    </Panel>
  );
};
