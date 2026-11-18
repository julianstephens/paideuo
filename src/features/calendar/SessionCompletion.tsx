import { loadPoints } from "../compliance/format";
import { Button, Flex, Heading, Input, Stack, Text, Textarea } from "@chakra-ui/react";
import { useState } from "react";
import { FormField, Notice } from "../../components/ui";
import { fullDate, todayInTimezone } from "./dates";
import type { CalendarSession, SessionCompletion } from "./scheduling";

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
  save: (values: SessionCompletion) => void;
  cancel: () => void;
}) => {
  const today = todayInTimezone(session.timezone);
  const initialDate = session.scheduledDate < today ? session.scheduledDate : today;
  const [completedDate, setDate] = useState(session.completion?.completedDate ?? initialDate);
  const [duration, setDuration] = useState(String(session.completion?.actualDurationMin ?? ""));
  const [rpe, setRpe] = useState(String(session.completion?.sessionRpe ?? ""));
  const [notes, setNotes] = useState(session.completion?.notes ?? "");

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
  title = "Actual results",
}: {
  completion: SessionCompletion | null;
  sessionLoad: number | null;
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
      </>
    ) : (
      <Notice>No completion details recorded.</Notice>
    )}
  </Stack>
);
