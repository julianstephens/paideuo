import { loadPoints } from "../compliance/format";
import {
  Box,
  Button,
  Flex,
  Grid,
  Heading,
  Input,
  Stack,
  Text,
  Textarea,
} from "@chakra-ui/react";
import { useState } from "react";
import { Disclosure, FormField, Notice } from "../../components/ui";
import { fullDate, todayInTimezone } from "./dates";
import type { CalendarSession, ComponentResult, SessionCompletion } from "./scheduling";

type ComponentResultDraft = {
  componentKey: string;
  active: boolean;
  load: string;
  unit: string;
  sets: string;
  reps: string;
  rpe: string;
  durationMin: string;
  rounds: string;
  notes: string;
};

const resultDraft = (
  componentKey: string,
  result?: ComponentResult,
): ComponentResultDraft => ({
  componentKey,
  active: Boolean(result),
  load: result?.load ? String(result.load.value) : "",
  unit: result?.load?.unit ?? "",
  sets: result?.sets == null ? "" : String(result.sets),
  reps: result?.reps ?? "",
  rpe: result?.rpe == null ? "" : String(result.rpe),
  durationMin: result?.durationMin == null ? "" : String(result.durationMin),
  rounds: result?.rounds == null ? "" : String(result.rounds),
  notes: result?.notes ?? "",
});

const nullableNumber = (value: string) => (value === "" ? null : Number(value));

export const CompletionForm = ({
  session,
  pending,
  canSave,
  save,
  cancel,
}: {
  session: CalendarSession;
  pending: boolean;
  canSave: boolean;
  save: (
    values: SessionCompletion & { componentResults: ComponentResult[] },
  ) => void;
  cancel: () => void;
}) => {
  const today = todayInTimezone(session.timezone);
  const initialDate = session.scheduledDate < today ? session.scheduledDate : today;
  const [completedDate, setDate] = useState(session.completion?.completedDate ?? initialDate);
  const [duration, setDuration] = useState(String(session.completion?.actualDurationMin ?? ""));
  const [rpe, setRpe] = useState(String(session.completion?.sessionRpe ?? ""));
  const [notes, setNotes] = useState(session.completion?.notes ?? "");
  const [componentResults, setComponentResults] = useState<ComponentResultDraft[]>(() =>
    session.prescription.components.flatMap((component) => {
      if (!component.key) return [];
      return [
        resultDraft(
          component.key,
          session.componentResults.find((result) => result.componentKey === component.key),
        ),
      ];
    }),
  );
  const updateResult = (componentKey: string, patch: Partial<ComponentResultDraft>) =>
    setComponentResults((current) =>
      current.map((result) =>
        result.componentKey === componentKey ? { ...result, ...patch } : result,
      ),
    );

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (pending || !canSave) return;
        save({
          completedDate,
          actualDurationMin: duration === "" ? null : Number(duration),
          sessionRpe: rpe === "" ? null : Number(rpe),
          notes,
          componentResults: componentResults.flatMap((result) =>
            result.active
              ? [
                  {
                    componentKey: result.componentKey,
                    load:
                      result.load === "" && result.unit === ""
                        ? null
                        : { value: Number(result.load), unit: result.unit },
                    sets: nullableNumber(result.sets),
                    reps: result.reps || null,
                    rpe: nullableNumber(result.rpe),
                    durationMin: nullableNumber(result.durationMin),
                    rounds: nullableNumber(result.rounds),
                    notes: result.notes,
                  },
                ]
              : [],
          ),
        });
      }}
    >
      <Stack gap="3">
        <Flex gap="3" wrap="wrap">
          <FormField>
            Completion date
            <Input
              type="date"
              required
              max={today}
              value={completedDate}
              disabled={pending}
              onChange={(event) => setDate(event.target.value)}
            />
          </FormField>
          {session.prescription.components.length > 0 && (
            <Disclosure label={`Component results (${componentResults.filter(({ active }) => active).length})`}>
              <Stack gap="3">
                {session.prescription.components.map((component) => {
                  const result = component.key
                    ? componentResults.find(({ componentKey }) => componentKey === component.key)
                    : undefined;
                  if (!result) return null;
                  return (
                    <Box key={result.componentKey} borderWidth="1px" borderRadius="md" p="3">
                      <Stack gap="3">
                        <Flex align="center" justify="space-between" gap="2" wrap="wrap">
                          <Heading as="h3" size="sm">
                            {component.name}
                          </Heading>
                          <Button
                            type="button"
                            size="sm"
                            variant={result.active ? "outline" : "subtle"}
                            disabled={pending}
                            onClick={() =>
                              updateResult(result.componentKey, {
                                ...(result.active ? {} : { ...resultDraft(result.componentKey) }),
                                active: !result.active,
                              })
                            }
                          >
                            {result.active ? "Remove result" : "Add result"}
                          </Button>
                        </Flex>
                        {result.active && (
                          <>
                            <Grid gap="3" templateColumns={{ base: "1fr", sm: "repeat(2, 1fr)" }}>
                              <FormField>
                                Load
                                <Input
                                  type="number"
                                  min={0}
                                  step="any"
                                  value={result.load}
                                  disabled={pending}
                                  onChange={(event) =>
                                    updateResult(result.componentKey, { load: event.target.value })
                                  }
                                />
                              </FormField>
                              <FormField>
                                Load unit
                                <Input
                                  maxLength={32}
                                  placeholder="kg, lb, bodyweight…"
                                  value={result.unit}
                                  disabled={pending}
                                  onChange={(event) =>
                                    updateResult(result.componentKey, { unit: event.target.value })
                                  }
                                />
                              </FormField>
                              <FormField>
                                Sets
                                <Input
                                  type="number"
                                  min={0}
                                  step={1}
                                  value={result.sets}
                                  disabled={pending}
                                  onChange={(event) =>
                                    updateResult(result.componentKey, { sets: event.target.value })
                                  }
                                />
                              </FormField>
                              <FormField>
                                Reps
                                <Input
                                  maxLength={200}
                                  value={result.reps}
                                  disabled={pending}
                                  onChange={(event) =>
                                    updateResult(result.componentKey, { reps: event.target.value })
                                  }
                                />
                              </FormField>
                              <FormField>
                                RPE (1–10)
                                <Input
                                  type="number"
                                  min={1}
                                  max={10}
                                  step="any"
                                  value={result.rpe}
                                  disabled={pending}
                                  onChange={(event) =>
                                    updateResult(result.componentKey, { rpe: event.target.value })
                                  }
                                />
                              </FormField>
                              <FormField>
                                Duration (minutes)
                                <Input
                                  type="number"
                                  min={0}
                                  step={1}
                                  value={result.durationMin}
                                  disabled={pending}
                                  onChange={(event) =>
                                    updateResult(result.componentKey, {
                                      durationMin: event.target.value,
                                    })
                                  }
                                />
                              </FormField>
                              <FormField>
                                Rounds
                                <Input
                                  type="number"
                                  min={0}
                                  step={1}
                                  value={result.rounds}
                                  disabled={pending}
                                  onChange={(event) =>
                                    updateResult(result.componentKey, { rounds: event.target.value })
                                  }
                                />
                              </FormField>
                            </Grid>
                            <FormField>
                              Component notes
                              <Textarea
                                maxLength={10000}
                                value={result.notes}
                                disabled={pending}
                                onChange={(event) =>
                                  updateResult(result.componentKey, { notes: event.target.value })
                                }
                              />
                            </FormField>
                          </>
                        )}
                      </Stack>
                    </Box>
                  );
                })}
              </Stack>
            </Disclosure>
          )}
          <FormField>
            Actual duration (minutes)
            <Input
              type="number"
              min={0}
              step={1}
              value={duration}
              disabled={pending}
              onChange={(event) => setDuration(event.target.value)}
            />
          </FormField>
          <FormField>
            Session RPE (1–10)
            <Input
              type="number"
              min={1}
              max={10}
              step="any"
              value={rpe}
              disabled={pending}
              onChange={(event) => setRpe(event.target.value)}
            />
          </FormField>
        </Flex>
        <FormField>
          Completion notes
          <Textarea
            value={notes}
            maxLength={10000}
            disabled={pending}
            onChange={(event) => setNotes(event.target.value)}
          />
        </FormField>
        <Flex gap="2" wrap="wrap">
          <Button type="submit" loading={pending} disabled={!canSave}>
            {session.status === "completed" ? "Save completion details" : "Save completion"}
          </Button>
          <Button type="button" variant="outline" disabled={pending} onClick={cancel}>
            Cancel completion edit
          </Button>
        </Flex>
      </Stack>
    </form>
  );
};

export const CompletionResults = ({
  completion,
  sessionLoad,
  componentResults = [],
  prescription,
  title = "Actual results",
}: {
  completion: SessionCompletion | null;
  sessionLoad: number | null;
  componentResults?: ComponentResult[];
  prescription?: CalendarSession["prescription"];
  title?: string;
}) => (
  <Stack gap="2">
    <Heading as="h3" size="sm">
      {title}
    </Heading>
    {completion ? (
      <>
        <Text>Completed {fullDate(completion.completedDate)}</Text>
        <Text>
          {completion.actualDurationMin === null
            ? "Duration unspecified"
            : `${completion.actualDurationMin} min`}
          {" · "}
          {completion.sessionRpe === null
            ? "Session RPE unspecified"
            : `Session RPE ${completion.sessionRpe}`}
        </Text>
        {sessionLoad !== null && <Text>Session load {loadPoints(sessionLoad)}</Text>}
        {completion.notes && <Text whiteSpace="pre-wrap">{completion.notes}</Text>}
        {componentResults.length > 0 && (
          <Disclosure label={`Component results (${componentResults.length})`}>
            <Stack gap="2">
              {componentResults.map((result) => {
                const name =
                  prescription?.components.find(
                    (component) => component.key === result.componentKey,
                  )?.name ?? "Workout component";
                const summary = [
                  result.sets != null && result.reps != null
                    ? `${result.sets} × ${result.reps}`
                    : result.sets != null
                      ? `${result.sets} sets`
                      : result.reps != null
                        ? `${result.reps} reps`
                        : null,
                  result.load && `${result.load.value} ${result.load.unit}`,
                  result.rpe != null && `RPE ${result.rpe}`,
                  result.durationMin != null && `${result.durationMin} min`,
                  result.rounds != null && `${result.rounds} rounds`,
                ]
                  .filter(Boolean)
                  .join(" · ");
                return (
                  <Box key={result.componentKey} borderTopWidth="1px" pt="2">
                    <Text fontWeight="medium">{name}</Text>
                    {summary && <Text fontSize="sm">{summary}</Text>}
                    {result.notes && <Text whiteSpace="pre-wrap">{result.notes}</Text>}
                  </Box>
                );
              })}
            </Stack>
          </Disclosure>
        )}
      </>
    ) : (
      <Notice>No completion details recorded.</Notice>
    )}
  </Stack>
);
