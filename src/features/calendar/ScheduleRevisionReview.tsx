import { Button, Flex, Heading, Stack, Text } from "@chakra-ui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Disclosure, Notice, Panel } from "../../components/ui";
import { errorMessage } from "../../lib/api/request";
import { metricsKey } from "../compliance/metrics";
import { programKeys } from "../programs/programs";
import { fullDate } from "./dates";
import { PrescriptionSnapshot } from "./PrescriptionSnapshot";
import { calendarKey, schedulingApi } from "./scheduling";
import type { ApplyRevisions, RevisionPreview, ScheduleChange } from "./scheduling";

const reviewKey = (ownerId: string, programId: string) =>
  [...calendarKey(ownerId), "revisions", programId] as const;

export const ScheduleRevisionReview = ({
  ownerId,
  programId,
  close,
}: {
  ownerId: string;
  programId: string;
  close: () => void;
}) => {
  const [applied, setApplied] = useState<number>();
  const query = useQuery({
    queryKey: reviewKey(ownerId, programId),
    queryFn: ({ signal }) => schedulingApi.previewRevisions(programId, signal),
    retry: false,
  });

  return (
    <Panel as="section" alignSelf="stretch">
      <Heading as="h2" size="md">
        Review calendar changes
      </Heading>
      {query.isPending && <Notice role="status">Loading calendar changes…</Notice>}
      {query.isError && (
        <Notice role="alert">
          {errorMessage(query.error, "Unable to load calendar changes.")}
        </Notice>
      )}
      {applied !== undefined && (
        <Notice role="status">
          {applied} calendar {applied === 1 ? "change" : "changes"} applied.
        </Notice>
      )}
      {query.data?.changes.length === 0 && <Notice>No calendar changes to review.</Notice>}
      {query.data && query.data.changes.length > 0 && (
        <RevisionSelection
          key={query.data.revision}
          review={query.data}
          ownerId={ownerId}
          programId={programId}
          onApplied={setApplied}
          refreshing={query.isFetching}
        />
      )}
      <Flex gap="2" wrap="wrap">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
        >
          Refresh calendar review
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={close}>
          Close calendar review
        </Button>
      </Flex>
    </Panel>
  );
};

const RevisionSelection = ({
  review,
  ownerId,
  programId,
  onApplied,
  refreshing,
}: {
  review: RevisionPreview;
  ownerId: string;
  programId: string;
  onApplied: (count: number) => void;
  refreshing: boolean;
}) => {
  const [selected, setSelected] = useState<string[]>([]);
  const queryClient = useQueryClient();
  const apply = useMutation({
    mutationFn: (selection: ApplyRevisions) => schedulingApi.applyRevisions(programId, selection),
    onSuccess: async ({ applied }) => {
      onApplied(applied);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: calendarKey(ownerId) }),
        queryClient.invalidateQueries({ queryKey: metricsKey(ownerId) }),
        queryClient.invalidateQueries({ queryKey: programKeys.detail(ownerId, programId) }),
      ]);
    },
  });
  const available = review.changes.filter((change) => !change.blockedReason);
  const blocked = review.changes.filter((change) => change.blockedReason);

  return (
    <Stack gap="4">
      {available.length > 0 && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (selected.length && !apply.isPending && !refreshing) {
              apply.mutate(
                apply.variables ?? {
                  changeIds: selected,
                  revision: review.revision,
                  operationId: crypto.randomUUID(),
                },
              );
            }
          }}
        >
          <Stack gap="3">
            <Button
              type="button"
              size="sm"
              variant="outline"
              alignSelf="start"
              aria-label="Select all available calendar changes"
              disabled={
                apply.isPending || refreshing || available.every(({ id }) => selected.includes(id))
              }
              onClick={() => {
                setSelected(available.map(({ id }) => id));
                apply.reset();
              }}
            >
              Select all
            </Button>
            {available.map((change) => (
              <Panel key={change.id} bg="bg.inset">
                <Flex as="label" align="baseline" gap="2" cursor="pointer">
                  <input
                    type="checkbox"
                    disabled={apply.isPending || refreshing}
                    checked={selected.includes(change.id)}
                    onChange={(event) => {
                      setSelected(
                        event.currentTarget.checked
                          ? [...selected, change.id]
                          : selected.filter((id) => id !== change.id),
                      );
                      apply.reset();
                    }}
                  />
                  <Text fontWeight="medium">{changeLabel(change)}</Text>
                </Flex>
                <RevisionDetails change={change} />
              </Panel>
            ))}
            {apply.isError && (
              <Notice role="alert">
                {errorMessage(apply.error, "Unable to apply calendar changes. Try again.")}
              </Notice>
            )}
            <Button
              type="submit"
              alignSelf="start"
              loading={apply.isPending}
              disabled={!selected.length || refreshing}
            >
              Apply selected changes
            </Button>
          </Stack>
        </form>
      )}
      {blocked.length > 0 && (
        <Disclosure label={`Unavailable changes (${blocked.length})`}>
          <Stack gap="3">
            {blocked.map((change) => (
              <Panel key={change.id} bg="bg.inset">
                <Text fontWeight="medium">{changeLabel(change)}</Text>
                <Text color="fg.muted">{change.blockedReason}</Text>
                <RevisionDetails change={change} />
              </Panel>
            ))}
          </Stack>
        </Disclosure>
      )}
    </Stack>
  );
};

const changeLabel = (change: ScheduleChange) => {
  const title = (change.after ?? change.before)?.prescription.title;
  switch (change.kind) {
    case "add":
      return `Add ${title}`;
    case "remove":
      return `Remove ${title}`;
    case "keep-moved":
      return `Keep ${title} as scheduled`;
    case "update":
      return `${change.before?.scheduledDate === change.after?.scheduledDate ? "Update" : "Move"} ${title}`;
  }
};

const RevisionDetails = ({ change }: { change: ScheduleChange }) => (
  <Stack gap="1">
    <Text fontSize="sm">
      {change.before && fullDate(change.before.scheduledDate)}
      {change.before &&
        change.after &&
        change.before.scheduledDate !== change.after.scheduledDate &&
        " → "}
      {change.after &&
        change.before?.scheduledDate !== change.after.scheduledDate &&
        fullDate(change.after.scheduledDate)}
    </Text>
    {change.kind === "keep-moved" && (
      <Text color="fg.muted">
        The source was removed. Selecting this keeps the manually moved session and its saved
        prescription.
      </Text>
    )}
    {change.manuallyMoved &&
      change.programDate &&
      change.after?.scheduledDate !== change.programDate && (
        <Text color="fg.muted">
          The manual date stays in place. Revised program date {fullDate(change.programDate)}.
        </Text>
      )}
    <Disclosure label="Prescription details">
      <Flex gap="3" wrap="wrap">
        {[
          { label: "Current", session: change.before },
          { label: "Revised", session: change.after },
        ].map(
          ({ label, session }) =>
            session && (
              <Stack key={label} flex="1 1 15rem" minW="0">
                <Heading as="h3" size="sm">
                  {label}
                </Heading>
                <Text>
                  {session.prescription.title} · {session.prescription.sessionType} · Slot{" "}
                  {session.slotPosition}
                </Text>
                <PrescriptionSnapshot prescription={session.prescription} />
              </Stack>
            ),
        )}
      </Flex>
    </Disclosure>
  </Stack>
);
