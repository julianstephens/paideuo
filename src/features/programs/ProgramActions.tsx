import { Button, Flex } from "@chakra-ui/react";
import { Disclosure, Notice } from "../../components/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";
import { useNavigate } from "react-router";
import { errorMessage, programKeys, programsApi } from "./programs";
import type { ProgramSummary } from "./programs";

export const ProgramActions = ({
  program,
  ownerId,
}: {
  program: ProgramSummary;
  ownerId: string;
}) => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const operationId = useRef<string | undefined>(undefined);
  type ProgramAction = "archive" | "complete" | "duplicate" | "unschedule";
  const mutation = useMutation({
    mutationFn: ({ action, unscheduleWorkouts = false }: {
      action: ProgramAction;
      unscheduleWorkouts?: boolean;
    }) => {
      if (action === "duplicate") {
        operationId.current ??= crypto.randomUUID();
        return programsApi.duplicate(program.id, operationId.current);
      }
      if (action === "archive") return programsApi.archive(program.id, unscheduleWorkouts);
      if (action === "complete") return programsApi.complete(program.id);
      return programsApi.unschedule(program.id);
    },
    onSuccess: async ({ id }, { action }) => {
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
