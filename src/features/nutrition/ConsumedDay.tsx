import { Button, Flex, Heading, SimpleGrid, Stack, Text } from "@chakra-ui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";
import { ConfirmationDialog } from "../../components/ConfirmationDialog";
import { Notice, Panel } from "../../components/ui";
import { errorMessage } from "../../lib/api/request";
import { fullDate } from "../calendar/dates";
import { consumedApi, consumedKey } from "./consumed";
import type { ConsumedChange, ConsumedDraft, ConsumedEntry } from "./consumed";
import { FoodEntryForm } from "./FoodEntryForm";
import { macroFields } from "./foods";
import type { NutritionTotals, PlannedDay, PlannedEntry } from "./planned";

export type LogEditor =
  | { kind: "new"; plan?: PlannedEntry }
  | { kind: "edit"; entry: ConsumedEntry };

const portion = ({ data }: ConsumedEntry) =>
  data.quantity + " × " + data.snapshot.serving.description;

export const LinkedPortions = ({ ownerId, plannedId }: { ownerId: string; plannedId: string }) => {
  const [open, setOpen] = useState(false);
  const entries = useQuery({
    queryKey: [...consumedKey(ownerId), "linked", plannedId],
    queryFn: ({ signal }) => consumedApi.list({ plannedId }, signal),
    enabled: open,
  });
  return (
    <Stack gap="1">
      <Button
        size="xs"
        variant="ghost"
        alignSelf="start"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {open ? "Hide logged portions" : "Show logged portions"}
      </Button>
      {open && entries.isPending && <Text role="status">Loading portions…</Text>}
      {open && entries.isError && (
        <Notice role="alert">
          {errorMessage(entries.error, "Unable to load linked portions.")}
        </Notice>
      )}
      {open && entries.data?.length === 0 && <Text fontSize="sm">No linked portions.</Text>}
      {open &&
        entries.data?.map((entry) => (
          <Text key={entry.id} fontSize="sm">
            {entry.data.snapshot.title} · {portion(entry)} · {fullDate(entry.data.date)}
          </Text>
        ))}
    </Stack>
  );
};

const totalLabel = (
  totals: NutritionTotals,
  key: keyof NutritionTotals["macros"],
  empty: string,
) => {
  if (!totals.entryCount) return empty;
  const { knownCount, subtotal } = totals.macros[key];
  if (subtotal === null) return "Unknown";
  return String(subtotal) + (knownCount < totals.entryCount ? " (partial)" : "");
};

const loggedTime = (entry: ConsumedEntry) =>
  entry.data.consumedAt
    ? new Intl.DateTimeFormat(undefined, {
        hour: "numeric",
        minute: "2-digit",
        timeZoneName: "short",
        timeZone: entry.data.timezone,
      }).format(new Date(entry.data.consumedAt))
    : undefined;

export const ConsumedDay = ({
  ownerId,
  date,
  remaining,
  programId,
  timezone,
  locked,
  editor,
  onEditor,
  onBusy,
}: {
  ownerId: string;
  date: string;
  remaining?: PlannedDay["remaining"];
  programId?: string;
  timezone?: string;
  locked: boolean;
  editor?: LogEditor;
  onEditor: (value?: LogEditor) => void;
  onBusy: (value: boolean) => void;
}) => {
  const client = useQueryClient();
  const key = consumedKey(ownerId);
  const entries = useQuery({
    queryKey: [...key, "date", date],
    queryFn: ({ signal }) => consumedApi.list({ date: date }, signal),
  });
  const summary = useQuery({
    queryKey: [...key, "summary", date, programId],
    queryFn: ({ signal }) => consumedApi.summary(date, programId, signal),
  });
  const [drafts, setDrafts] = useState<{ draft: ConsumedDraft; title: string }[]>([]);
  const [review, setReview] = useState(false);
  const [removal, setRemoval] = useState<{ entry: ConsumedEntry; trigger: HTMLButtonElement }>();
  const mutation = useMutation({
    mutationFn: consumedApi.mutate,
    onMutate: () => onBusy(true),
    onSuccess: async (_, { change }) => {
      onEditor(undefined);
      if (change.action === "batch_create") {
        setDrafts([]);
        setReview(false);
      }
      await client.invalidateQueries({ queryKey: key });
    },
    onSettled: () => onBusy(false),
  });
  const save = (change: ConsumedChange) => {
    const previous = mutation.variables;
    mutation.mutate(
      mutation.isError && previous && JSON.stringify(previous.change) === JSON.stringify(change)
        ? previous
        : { change, operationId: crypto.randomUUID() },
    );
  };
  const startEdit = (value: LogEditor) => {
    mutation.reset();
    onEditor(value);
  };
  const disabled = locked || mutation.isPending || !!editor || review;
  const totals = summary.data;
  return (
    <Stack gap="4">
      <Panel>
        <Flex justify="space-between" align="center" gap="2" wrap="wrap">
          <Heading size="md">Eaten</Heading>
          <Button size="sm" disabled={disabled} onClick={() => startEdit({ kind: "new" })}>
            Log food
          </Button>
        </Flex>
        {(entries.isError || summary.isError) && (
          <Notice role="alert">
            {errorMessage(entries.error ?? summary.error, "Unable to load the daily food log.")}
          </Notice>
        )}
        {(entries.isPending || summary.isPending) && (
          <Text role="status">Loading daily food log…</Text>
        )}
        {totals &&
          (totals.planned.entryCount > 0 ||
            totals.consumed.entryCount > 0 ||
            totals.target.active) && (
            <SimpleGrid columns={{ base: 2, md: 4 }} gap="3" aria-label="Daily macro comparison">
              {macroFields.map(({ key: macro, label, unit }) => {
                const target = totals.target.macros?.[macro].value;
                return (
                  <Stack key={macro} gap="0" fontSize="sm">
                    <Text fontWeight="semibold">
                      {label} ({unit})
                    </Text>
                    <Text>Planned {totalLabel(totals.planned, macro, "0")}</Text>
                    <Text>Eaten {totalLabel(totals.consumed, macro, "—")}</Text>
                    {target != null && (
                      <>
                        <Text>Target {target}</Text>
                        <Text>Remaining to plan {remaining?.[macro] ?? "Unknown"}</Text>
                      </>
                    )}
                  </Stack>
                );
              })}
            </SimpleGrid>
          )}
        {entries.data?.length === 0 && <Text color="fg.muted">No food logged.</Text>}
        {entries.data?.map((entry) => (
          <Flex
            key={entry.id}
            justify="space-between"
            gap="2"
            wrap="wrap"
            borderTopWidth="1px"
            pt="3"
          >
            <Stack gap="1">
              <Text fontWeight="semibold">{entry.data.snapshot.title}</Text>
              <Text fontSize="sm" color="fg.muted">
                {[
                  entry.data.meal,
                  portion(entry),
                  loggedTime(entry),
                  entry.data.plannedId &&
                    (entry.data.source.kind === "planned" ? "Linked to plan" : "Substitution"),
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </Text>
              {entry.data.notes && <Text fontSize="sm">{entry.data.notes}</Text>}
            </Stack>
            <Flex gap="1" wrap="wrap">
              {entry.data.source.kind !== "inline" && (
                <Button asChild size="sm" variant="ghost">
                  <Link to={"/nutrition/recipes/consumed/" + entry.id}>Recipe</Link>
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                disabled={disabled}
                onClick={() => startEdit({ kind: "edit", entry })}
              >
                Edit log
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={disabled}
                onClick={(event) => setRemoval({ entry, trigger: event.currentTarget })}
              >
                Remove log
              </Button>
            </Flex>
          </Flex>
        ))}
      </Panel>
      {mutation.isError && (
        <Notice role="alert">
          {errorMessage(mutation.error, "Unable to save the food log. Try again.")}
        </Notice>
      )}
      {editor && (
        <FoodEntryForm
          key={editor.kind === "edit" ? editor.entry.id : (editor.plan?.id ?? date)}
          kind="consumed"
          ownerId={ownerId}
          date={date}
          programId={programId}
          timezone={timezone}
          entry={editor.kind === "edit" ? editor.entry : undefined}
          linkedPlan={editor.kind === "new" ? editor.plan : undefined}
          canQueue={drafts.length < 100}
          pending={mutation.isPending}
          onSave={save}
          onClose={() => {
            mutation.reset();
            onEditor(undefined);
          }}
          onQueue={(draft, title) => {
            mutation.reset();
            setDrafts([...drafts, { draft, title }]);
            onEditor(undefined);
          }}
        />
      )}
      {drafts.length > 0 && (
        <Panel>
          <Heading size="sm">{review ? "Review food logs" : "Food log batch"}</Heading>
          {drafts.map(({ draft, title }) => (
            <Flex key={draft.externalId} gap="2" align="center" wrap="wrap">
              <Text>
                {fullDate(draft.data.date)} · {title} · {draft.data.quantity} servings
              </Text>
              {!review && (
                <Button
                  size="xs"
                  variant="ghost"
                  disabled={disabled}
                  aria-label={"Remove " + title + " from batch"}
                  onClick={() =>
                    setDrafts(drafts.filter((item) => item.draft.externalId !== draft.externalId))
                  }
                >
                  Remove
                </Button>
              )}
            </Flex>
          ))}
          <Flex gap="2" wrap="wrap">
            {review ? (
              <>
                <Button
                  colorPalette="teal"
                  loading={mutation.isPending}
                  onClick={() =>
                    save({ action: "batch_create", entries: drafts.map(({ draft }) => draft) })
                  }
                >
                  Log all foods
                </Button>
                <Button
                  variant="ghost"
                  disabled={mutation.isPending}
                  onClick={() => {
                    mutation.reset();
                    setReview(false);
                  }}
                >
                  Back
                </Button>
              </>
            ) : (
              <Button
                variant="outline"
                disabled={disabled}
                onClick={() => {
                  mutation.reset();
                  setReview(true);
                }}
              >
                Review food log batch
              </Button>
            )}
          </Flex>
        </Panel>
      )}
      {removal && (
        <ConfirmationDialog
          title="Remove eaten food"
          description={"Remove " + removal.entry.data.snapshot.title + " from the food log?"}
          confirmLabel="Remove"
          destructive
          returnFocus={() => removal.trigger}
          onDismiss={() => setRemoval(undefined)}
          onConfirm={() => save({ action: "delete", id: removal.entry.id })}
        />
      )}
    </Stack>
  );
};
