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
  const mutation = useMutation({
    mutationFn: (action: "archive" | "duplicate") => {
      if (action === "archive") return programsApi.archive(program.id);
      operationId.current ??= crypto.randomUUID();
      return programsApi.duplicate(program.id, operationId.current);
    },
    onSuccess: async ({ id }, action) => {
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
            onClick={() => mutation.mutate("duplicate")}
          >
            Duplicate
          </Button>
          {program.status !== "archived" && (
            <Button
              size="sm"
              variant="outline"
              disabled={mutation.isPending}
              onClick={() => {
                if (window.confirm(`Archive “${program.name}”?`)) mutation.mutate("archive");
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
