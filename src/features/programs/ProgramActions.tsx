import { Button, Flex } from "@chakra-ui/react";
import { Disclosure, Notice } from "../../components/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";
import { useNavigate } from "react-router";
import { calendarKey } from "../calendar/scheduling";
import { metricsKey } from "../compliance/metrics";
import { reviewKey } from "../reviews/reviews";
import { errorMessage, programKeys, programsApi } from "./programs";
import type { ProgramSummary } from "./programs";

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
  type ProgramAction = "archive" | "complete" | "delete" | "duplicate" | "unschedule";
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
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: programKeys.owner(ownerId) }),
          queryClient.invalidateQueries({ queryKey: calendarKey(ownerId) }),
          queryClient.invalidateQueries({ queryKey: metricsKey(ownerId) }),
        ]);
        return;
      }
      await queryClient.invalidateQueries({ queryKey: programKeys.owner(ownerId) });
      if (action === "duplicate") {
        operationId.current = undefined;
        void navigate(`/programs/${id}`);
      }
    },
  });

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
              onClick={() => {
                if (
                  window.confirm(
                    `Mark “${program.name}” complete? Unresolved sessions will keep their current status. You can still record them later.`,
                  )
                )
                  mutation.mutate({ action: "complete" });
              }}
            >
              Mark program complete
            </Button>
          )}
          {program.scheduled && (
            <Button
              size="sm"
              variant="outline"
              disabled={mutation.isPending}
              onClick={() => {
                if (
                  window.confirm(
                    `Unschedule workouts for “${program.name}”? This removes this program’s scheduled workouts from the calendar.`,
                  )
                )
                  mutation.mutate({ action: "unschedule" });
              }}
            >
              Unschedule workouts
            </Button>
          )}
          {program.status !== "archived" && (
            <Button
              size="sm"
              variant="outline"
              disabled={mutation.isPending}
              onClick={() => {
                if (!window.confirm(`Archive “${program.name}”?`)) return;
                const unscheduleWorkouts =
                  program.scheduled &&
                  window.confirm(
                    `Also unschedule this program’s workouts? Choosing “OK” removes scheduled workouts from the calendar. Choosing “Cancel” keeps them scheduled.`,
                  );
                mutation.mutate({ action: "archive", unscheduleWorkouts });
              }}
            >
              Archive
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            colorPalette="red"
            disabled={mutation.isPending}
            onClick={() => {
              if (
                window.confirm(
                  `Permanently delete “${program.name}” and its training plan, scheduled workouts, workout history, and weekly reviews? This cannot be undone.`,
                )
              )
                mutation.mutate({ action: "delete" });
            }}
          >
            Delete program
          </Button>
        </Flex>
      </Disclosure>
      {mutation.isPending && <Notice role="status">Saving…</Notice>}
      {mutation.isError && (
        <Notice role="alert">
          {errorMessage(mutation.error, "Unable to update the program. Try again.")}
        </Notice>
      )}
    </>
  );
};
