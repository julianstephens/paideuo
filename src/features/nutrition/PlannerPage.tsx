import { Button, Flex, Heading, Input, NativeSelect, Stack, Text } from "@chakra-ui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import type { FormEvent } from "react";
import { Link, useSearchParams } from "react-router";
import { ConfirmationDialog } from "../../components/ConfirmationDialog";
import { FormField, Notice, PageHeader, Panel } from "../../components/ui";
import { errorMessage } from "../../lib/api/request";
import { useSession } from "../auth/session";
import {
  addDays,
  dateKey,
  formatDate,
  fullDate,
  localToday,
  monday,
  parseDate,
} from "../calendar/dates";
import { programKeys, programsApi } from "../programs/programs";
import { consumedKey } from "./consumed";
import { ConsumedDay, LinkedPortions } from "./ConsumedDay";
import type { LogEditor } from "./ConsumedDay";
import { plannedApi } from "./planned";
import type { Change, DraftEntry, PlannedBatch, PlannedEntry } from "./planned";
import { FoodEntryForm } from "./FoodEntryForm";

type CopySource =
  | { kind: "copy"; entry: PlannedEntry }
  | { kind: "clone"; startDate: string; endDate: string };
type PendingDelete = { entry: PlannedEntry; trigger: HTMLButtonElement };

export const PlannerPage = () => {
  const session = useSession();
  return session.status === "signed-in" ? (
    <Planner key={session.ownerId} ownerId={session.ownerId} />
  ) : null;
};

const Planner = ({ ownerId }: { ownerId: string }) => {
  const [params, setParams] = useSearchParams();
  const programId = params.get("program") || undefined;
  const date = parseDate(params.get("date")) ?? localToday();
  // Keep all seven API dates representable at the upper civil-date boundary.
  const lastWeek = new Date("9999-12-25T00:00:00Z");
  const start = monday(date) > lastWeek ? lastWeek : monday(date);
  const dayKey = dateKey(date);
  const startDate = dateKey(start);
  const endDate = dateKey(addDays(start, 6));
  const key = ["nutrition", "planner", ownerId];
  const client = useQueryClient();
  const [editor, setEditor] = useState<"add" | PlannedEntry>();
  const [logEditor, setLogEditor] = useState<LogEditor>();
  const [logBusy, setLogBusy] = useState(false);
  const [copy, setCopy] = useState<CopySource>();
  const [queue, setQueue] = useState<{ draft: DraftEntry; title: string }[]>([]);
  const [deletion, setDeletion] = useState<PendingDelete>();
  const [notice, setNotice] = useState<string>();
  const previewPanel = useRef<HTMLDivElement>(null);
  const programs = useQuery({
    queryKey: programKeys.list(ownerId),
    queryFn: ({ signal }) => programsApi.list(signal),
  });
  const week = useQuery({
    queryKey: [...key, startDate, programId],
    queryFn: ({ signal }) => plannedApi.week(startDate, programId, signal),
  });
  const preview = useMutation({
    mutationFn: plannedApi.preview,
    onSuccess: () => requestAnimationFrame(() => previewPanel.current?.focus()),
  });
  const mutation = useMutation({
    mutationFn: plannedApi.mutate,
    onSuccess: async (_, { change }) => {
      if (change.action === "commit" && change.batch.kind === "schedule") setQueue([]);
      if (change.action === "commit") {
        setNotice("Planned foods added. Open the destination date to edit them.");
        preview.reset();
      }
      setEditor(undefined);
      setCopy(undefined);
      await Promise.all([
        client.invalidateQueries({ queryKey: key }),
        client.invalidateQueries({ queryKey: [...consumedKey(ownerId), "summary"] }),
      ]);
    },
  });
  const save = (change: Change) => {
    const previous = mutation.variables;
    setNotice(undefined);
    mutation.mutate(
      mutation.isError && previous && JSON.stringify(previous.change) === JSON.stringify(change)
        ? previous
        : { change, operationId: crypto.randomUUID() },
    );
  };
  const navigate = (next: Date, program = programId ?? "") => {
    setEditor(undefined);
    setLogEditor(undefined);
    setCopy(undefined);
    mutation.reset();
    preview.reset();
    setParams({ date: dateKey(next), ...(program ? { program } : {}) });
  };
  const review = (batch: PlannedBatch) => {
    mutation.reset();
    setNotice(undefined);
    preview.mutate(batch);
  };
  const submitCopy = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!copy) return;
    const form = new FormData(event.currentTarget);
    const destinationDate = String(form.get("destination"));
    review(
      copy.kind === "copy"
        ? { kind: "copy", id: copy.entry.id, destinationDate }
        : {
            kind: "clone",
            startDate: String(form.get("start")),
            endDate: String(form.get("end")),
            destinationDate,
          },
    );
  };

  const day = week.data?.days.find(({ date }) => date === dayKey);
  const selectedProgram = programs.data?.find(({ id }) => id === programId);
  const timezone = selectedProgram?.scheduled
    ? undefined
    : Intl.DateTimeFormat().resolvedOptions().timeZone;
  const busy = mutation.isPending || preview.isPending || logBusy;
  const plannedLocked = busy || !!editor || !!copy || !!preview.data;
  const locked = plannedLocked || !!logEditor;

  return (
    <Stack gap="4">
      <PageHeader
        title="Meal planner"
        action={
          <Button asChild variant="outline">
            <Link to="/nutrition/foods">Food bank</Link>
          </Button>
        }
      />
      <Panel>
        <Flex gap="3" wrap="wrap" align="end">
          <FormField>
            Program targets
            <NativeSelect.Root disabled={busy}>
              <NativeSelect.Field
                value={programId ?? ""}
                onChange={(event) => navigate(date, event.target.value)}
              >
                <option value="">No program</option>
                {programId && !selectedProgram && (
                  <option value={programId}>
                    {programs.isPending ? "Loading program…" : "Selected program"}
                  </option>
                )}
                {programs.data?.map(({ id, name }) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </NativeSelect.Field>
              <NativeSelect.Indicator />
            </NativeSelect.Root>
          </FormField>
          <FormField>
            Jump to date
            <Input
              type="date"
              min="0001-01-01"
              max="9999-12-31"
              value={dayKey}
              disabled={busy}
              onChange={(event) => {
                const next = parseDate(event.target.value);
                if (next) navigate(next);
              }}
            />
          </FormField>
          <Button
            variant="outline"
            disabled={busy || startDate === "0001-01-01"}
            onClick={() => navigate(addDays(start, -7))}
          >
            Previous week
          </Button>
          <Button
            variant="outline"
            disabled={busy || endDate === "9999-12-31"}
            onClick={() => navigate(addDays(start, 7))}
          >
            Next week
          </Button>
        </Flex>
        {programs.isError && (
          <Notice role="alert">{errorMessage(programs.error, "Unable to load programs.")}</Notice>
        )}
        <Flex gap="2" wrap="wrap" aria-label="Days in the week">
          {week.data?.days.map(({ date: value, planned }) => (
            <Button
              key={value}
              size="sm"
              variant={value === dayKey ? "solid" : "outline"}
              aria-pressed={value === dayKey}
              disabled={busy}
              onClick={() => navigate(parseDate(value) ?? date)}
            >
              {formatDate(parseDate(value) ?? date, {
                weekday: "short",
                month: "short",
                day: "numeric",
              })}
              {planned.entryCount > 0 ? " (" + planned.entryCount + ")" : ""}
            </Button>
          ))}
        </Flex>
      </Panel>
      {week.isPending && <Notice role="status">Loading planned foods…</Notice>}
      {week.isError && (
        <Notice role="alert">{errorMessage(week.error, "Unable to load the week.")}</Notice>
      )}
      {mutation.isError && (
        <Notice role="alert">
          {errorMessage(mutation.error, "Unable to save the planned-food change. Try again.")}
        </Notice>
      )}
      {notice && <Notice role="status">{notice}</Notice>}
      {day && (
        <Panel>
          <Flex align="center" justify="space-between" gap="2" wrap="wrap">
            <Heading size="md">{fullDate(dayKey)}</Heading>
            <Flex gap="2" wrap="wrap">
              <Button
                size="sm"
                disabled={locked || (!!programId && !selectedProgram)}
                onClick={() => {
                  mutation.reset();
                  setEditor("add");
                }}
              >
                Add food
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={locked || !day.planned.entryCount}
                onClick={() => setCopy({ kind: "clone", startDate: dayKey, endDate: dayKey })}
              >
                Copy day
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={locked}
                onClick={() => setCopy({ kind: "clone", startDate, endDate })}
              >
                Copy week or range
              </Button>
            </Flex>
          </Flex>
          {!day.entries.length && <Text color="fg.muted">No food scheduled.</Text>}
          {day.entries.map((entry) => (
            <Flex
              key={entry.id}
              justify="space-between"
              align="start"
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
                    entry.data.quantity + " × " + entry.data.snapshot.serving.description,
                    entry.data.canceled && "Canceled",
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </Text>
                {entry.data.notes && <Text fontSize="sm">{entry.data.notes}</Text>}
                <LinkedPortions ownerId={ownerId} plannedId={entry.id} />
              </Stack>
              <Flex gap="1" wrap="wrap">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={locked || entry.data.canceled}
                  onClick={() => setLogEditor({ kind: "new", plan: entry })}
                >
                  Log eaten
                </Button>
                {entry.data.source.kind === "bank" && (
                  <Button asChild size="sm" variant="ghost">
                    <Link to={"/nutrition/recipes/planned/" + entry.id}>Recipe</Link>
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={locked}
                  onClick={() => {
                    mutation.reset();
                    setEditor(entry);
                  }}
                >
                  Edit
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={locked || entry.data.canceled}
                  onClick={() => setCopy({ kind: "copy", entry })}
                >
                  Copy
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={locked}
                  onClick={(event) => setDeletion({ entry, trigger: event.currentTarget })}
                >
                  Delete
                </Button>
              </Flex>
            </Flex>
          ))}
        </Panel>
      )}
      {editor && day && (
        <FoodEntryForm
          kind="planned"
          key={editor === "add" ? dayKey : editor.id}
          entry={editor === "add" ? undefined : editor}
          date={dayKey}
          order={Math.min(
            1000000,
            day.entries.reduce((next, { data }) => Math.max(next, (data.order ?? 0) + 1), 0),
          )}
          ownerId={ownerId}
          programId={programId}
          timezone={timezone}
          canQueue={queue.length < 100}
          pending={mutation.isPending}
          onSave={save}
          onClose={() => {
            mutation.reset();
            setEditor(undefined);
          }}
          onQueue={(draft, title) => {
            mutation.reset();
            setQueue([...queue, { draft, title }]);
            setEditor(undefined);
          }}
        />
      )}
      {queue.length > 0 && (
        <Panel>
          <Heading size="sm">Batch draft</Heading>
          {queue.map(({ draft: { externalId, data }, title }) => (
            <Flex key={externalId} gap="2" align="center" wrap="wrap">
              <Text>
                {fullDate(data.date)} · {title} · {data.quantity} servings
              </Text>
              <Button
                size="xs"
                variant="ghost"
                aria-label={"Remove " + title + " from batch"}
                disabled={locked}
                onClick={() =>
                  setQueue(queue.filter(({ draft }) => draft.externalId !== externalId))
                }
              >
                Remove
              </Button>
            </Flex>
          ))}
          <Button
            alignSelf="start"
            variant="outline"
            disabled={locked}
            onClick={() => review({ kind: "schedule", entries: queue.map(({ draft }) => draft) })}
          >
            Preview batch
          </Button>
        </Panel>
      )}
      {copy && !preview.data && (
        <Panel>
          <Heading size="md">
            {copy.kind === "copy"
              ? "Copy " + copy.entry.data.snapshot.title
              : "Copy planned food range"}
          </Heading>
          <form onSubmit={submitCopy}>
            <Flex align="end" gap="3" wrap="wrap">
              {copy.kind === "clone" && (
                <>
                  <FormField>
                    Source start
                    <Input name="start" type="date" defaultValue={copy.startDate} required />
                  </FormField>
                  <FormField>
                    Source end
                    <Input name="end" type="date" defaultValue={copy.endDate} required />
                  </FormField>
                </>
              )}
              <FormField>
                Destination start
                <Input
                  name="destination"
                  type="date"
                  defaultValue={dateKey(
                    addDays(date, copy.kind === "copy" || copy.startDate === copy.endDate ? 1 : 7),
                  )}
                  required
                />
              </FormField>
              <Button type="submit" loading={preview.isPending}>
                Preview copy
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  setCopy(undefined);
                  preview.reset();
                }}
              >
                Cancel
              </Button>
            </Flex>
          </form>
        </Panel>
      )}
      {preview.isError && (
        <Notice role="alert">
          {errorMessage(preview.error, "Unable to preview planned foods.")}
        </Notice>
      )}
      {preview.data && preview.variables && (
        <Panel ref={previewPanel} tabIndex={-1}>
          <Heading size="md">Review planned foods</Heading>
          {preview.data.destinations.map(({ date: destination, entries }) => (
            <Stack key={destination} gap="1">
              <Heading as="h3" size="sm">
                {fullDate(destination)}
              </Heading>
              {entries.length > 0 && (
                <Text>
                  Already scheduled:{" "}
                  {entries
                    .map(({ data }) => data.snapshot.title + (data.canceled ? " (canceled)" : ""))
                    .join(", ")}
                </Text>
              )}
              {preview.data.additions
                .filter(({ data }) => data.date === destination)
                .map(({ externalId, data }) => (
                  <Text key={externalId}>
                    Add {data.snapshot.title} · {data.quantity} servings
                    {data.meal && " · " + data.meal}
                  </Text>
                ))}
            </Stack>
          ))}
          <Flex gap="2" wrap="wrap">
            <Button
              colorPalette="teal"
              loading={mutation.isPending}
              onClick={() => {
                if (preview.data && preview.variables)
                  save({
                    action: "commit",
                    previewToken: preview.data.previewToken,
                    batch: preview.variables,
                  });
              }}
            >
              Confirm additions
            </Button>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => {
                preview.reset();
                mutation.reset();
              }}
            >
              Back
            </Button>
          </Flex>
        </Panel>
      )}
      <ConsumedDay
        ownerId={ownerId}
        date={dayKey}
        remaining={day?.remaining}
        programId={programId}
        timezone={timezone}
        locked={plannedLocked || (!!programId && !selectedProgram)}
        editor={logEditor}
        onEditor={setLogEditor}
        onBusy={setLogBusy}
      />
      {deletion && (
        <ConfirmationDialog
          title="Delete planned food"
          description={"Remove " + deletion.entry.data.snapshot.title + " from the schedule?"}
          confirmLabel="Delete"
          destructive
          returnFocus={() => deletion.trigger}
          onDismiss={() => setDeletion(undefined)}
          onConfirm={() => save({ action: "delete", id: deletion.entry.id })}
        />
      )}
    </Stack>
  );
};
