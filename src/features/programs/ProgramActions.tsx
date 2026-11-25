import { targetKey } from "../nutrition/targets";
import { Button, Checkbox, Flex } from "@chakra-ui/react";
import { ConfirmationDialog } from "../../components/ConfirmationDialog";
import { Disclosure, Notice } from "../../components/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { useNavigate } from "react-router";
import { calendarKey } from "../calendar/scheduling";
import { metricsKey } from "../compliance/metrics";
import { reviewKey } from "../reviews/reviews";
import { errorMessage, programKeys, programsApi } from "./programs";
import type { ProgramSummary } from "./programs";

const confirmations = {
  complete: {
    title: "Mark program complete?",
    description: (name: string) =>
      `Unresolved sessions in “${name}” will keep their current status. You can still record them later.`,
    confirmLabel: "Mark complete",
    destructive: false,
  },
  unschedule: {
    title: "Unschedule workouts?",
    description: (name: string) =>
      `This removes scheduled workouts for “${name}” from the calendar.`,
    confirmLabel: "Unschedule workouts",
    destructive: true,
  },
  archive: {
    title: "Archive program?",
    description: (name: string) => `Archive “${name}”.`,
    confirmLabel: "Archive",
    destructive: false,
  },
  delete: {
    title: "Permanently delete program?",
    description: (name: string) =>
      `This permanently deletes “${name}” and its training plan, scheduled workouts, workout history, and weekly reviews.`,
    confirmLabel: "Delete program",
    destructive: true,
  },
};

type ConfirmedAction = keyof typeof confirmations;
type ProgramAction = ConfirmedAction | "duplicate";

export const ProgramActions = ({
  program,
  ownerId,
  onDetailPage = false,
}: {
  program: ProgramSummary;
  ownerId: string;
  onDetailPage?: boolean;
}) => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const operationId = useRef<string | undefined>(undefined);
  const [actionToConfirm, setActionToConfirm] = useState<ConfirmedAction>();
  const [unscheduleWorkouts, setUnscheduleWorkouts] = useState(false);
  const confirmationTrigger = useRef<HTMLButtonElement>(null);
  const mutation = useMutation({
    mutationFn: ({
      action,
      unscheduleWorkouts = false,
    }: {
      action: ProgramAction;
      unscheduleWorkouts?: boolean;
    }) => {
      if (action === "duplicate") {
        operationId.current ??= crypto.randomUUID();
        return programsApi.duplicate(program.id, operationId.current);
      }
      if (action === "archive") return programsApi.archive(program.id, unscheduleWorkouts);
      if (action === "complete") return programsApi.complete(program.id);
      if (action === "delete") return programsApi.remove(program.id);
      return programsApi.unschedule(program.id);
    },
    onSuccess: async ({ id }, { action }) => {
      if (action === "delete") {
        if (onDetailPage) void navigate("/programs", { replace: true });
        queryClient.setQueryData<ProgramSummary[]>(programKeys.list(ownerId), (programs) =>
          programs?.filter((program) => program.id !== id),
        );
        queryClient.removeQueries({ queryKey: programKeys.detail(ownerId, id) });
        queryClient.removeQueries({ queryKey: reviewKey(ownerId, id) });
        queryClient.removeQueries({ queryKey: targetKey(ownerId, id) });
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: programKeys.owner(ownerId) }),
          queryClient.invalidateQueries({ queryKey: calendarKey(ownerId) }),
          queryClient.invalidateQueries({ queryKey: metricsKey(ownerId) }),
        ]);
        return;
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: programKeys.owner(ownerId) }),
        queryClient.invalidateQueries({ queryKey: targetKey(ownerId, program.id) }),
      ]);
      if (action === "duplicate") {
        operationId.current = undefined;
        void navigate(`/programs/${id}`);
      }
    },
  });

  const requestConfirmation = (action: ConfirmedAction, trigger: HTMLButtonElement) => {
    confirmationTrigger.current = trigger;
    setUnscheduleWorkouts(false);
    setActionToConfirm(action);
  };
  const confirmation = actionToConfirm && confirmations[actionToConfirm];

  return (
    <>
      <Disclosure label="Program actions">
        <Flex gap="2" wrap="wrap">
          <Button
            size="sm"
            variant="outline"
            disabled={mutation.isPending}
            onClick={() => mutation.mutate({ action: "duplicate" })}
          >
            Duplicate
          </Button>
          {program.scheduled && program.status === "active" && (
            <Button
              size="sm"
              variant="outline"
              disabled={mutation.isPending}
              onClick={(event) => requestConfirmation("complete", event.currentTarget)}
            >
              Mark program complete
            </Button>
          )}
          {program.scheduled && (
            <Button
              size="sm"
              variant="outline"
              disabled={mutation.isPending}
              onClick={(event) => requestConfirmation("unschedule", event.currentTarget)}
            >
              Unschedule workouts
            </Button>
          )}
          {program.status !== "archived" && (
            <Button
              size="sm"
              variant="outline"
              disabled={mutation.isPending}
              onClick={(event) => requestConfirmation("archive", event.currentTarget)}
            >
              Archive
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            colorPalette="red"
            disabled={mutation.isPending}
            onClick={(event) => requestConfirmation("delete", event.currentTarget)}
          >
            Delete program
          </Button>
        </Flex>
      </Disclosure>
      {actionToConfirm && confirmation && (
        <ConfirmationDialog
          {...confirmation}
          description={confirmation.description(program.name)}
          returnFocus={() => confirmationTrigger.current}
          onDismiss={() => setActionToConfirm(undefined)}
          onConfirm={() =>
            mutation.mutate({
              action: actionToConfirm,
              unscheduleWorkouts:
                actionToConfirm === "archive" && program.scheduled && unscheduleWorkouts,
            })
          }
        >
          {actionToConfirm === "archive" && program.scheduled && (
            <Checkbox.Root
              checked={unscheduleWorkouts}
              onCheckedChange={({ checked }) => setUnscheduleWorkouts(checked === true)}
            >
              <Checkbox.HiddenInput />
              <Checkbox.Control />
              <Checkbox.Label>Also unschedule workouts</Checkbox.Label>
            </Checkbox.Root>
          )}
        </ConfirmationDialog>
      )}
      {mutation.isPending && <Notice role="status">Saving…</Notice>}
      {mutation.isError && (
        <Notice role="alert">
          {errorMessage(mutation.error, "Unable to update the program. Try again.")}
        </Notice>
      )}
    </>
  );
};
