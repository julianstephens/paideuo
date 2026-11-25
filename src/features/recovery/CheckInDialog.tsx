import {
  Badge,
  Box,
  Button,
  Dialog,
  Flex,
  Grid,
  Input,
  Link,
  NativeSelect,
  Portal,
  SegmentGroup,
  Stack,
  Text,
  Textarea,
} from "@chakra-ui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link as RouterLink } from "react-router";
import { useId, useRef, useState } from "react";
import { ConfirmationDialog } from "../../components/ConfirmationDialog";
import { FieldHelp } from "../../components/FieldHelp";
import { Disclosure, FormField, Notice } from "../../components/ui";
import { errorMessage } from "../../lib/api/request";
import { fullDate } from "../calendar/dates";
import { useCheckInPreferences } from "./checkInPreferences";
import { metricsKey } from "../compliance/metrics";
import { checkInApi, checkInKey, checkInSections, hasCheckInResponse } from "./recovery";
import type { CheckInEntry, CheckInField, CheckInSection } from "./recovery";

const fieldHelp: Record<CheckInField, string> = {
  sleepHours:
    "How long you actually slept last night, in hours. Use a decimal for part of an hour, such as 7.5 for 7 hours 30 minutes.",
  sleepQuality: "How restful last night’s sleep felt. 1 = very poor, 5 = very restful.",
  fatigue: "How physically or mentally tired you feel today. 1 = fresh, 5 = extremely fatigued.",
  soreness: "How sore your muscles feel today. 1 = no soreness, 5 = very sore.",
  readiness: "How ready you feel to train today. 1 = very unready, 5 = fully ready.",
  restingHeartRate:
    "Your heart rate at rest, in beats per minute. Use a reading taken under similar conditions each day so it’s easier to compare.",
  nutritionAdequacy:
    "Whether you felt you ate enough over the whole day to support your activity and recovery.",
  trainingFueling:
    "Whether what you ate or drank around training supported the session. Choose Not applicable if you didn’t train.",
  calories: "Your total calorie intake for the day. An estimate is fine.",
  mealTiming: "Record what time you ate each meal or snack, such as breakfast at 8 am.",
  skippedMeals: "How many usual meals you skipped today. Enter 0 if you skipped none.",
  morningWeightKg:
    "Record your morning weight in kilograms two or three times a week, under similar conditions.",
  hunger: "How hungry you felt overall today. 1 = very little hunger, 5 = very hungry.",
  digestion: "How comfortable your digestion felt. 1 = very uncomfortable, 5 = very comfortable.",
  energy: "Your overall energy today. 1 = very low, 5 = very high.",
  trainingRecovery:
    "How recovered you feel from recent training. 1 = poorly recovered, 5 = fully recovered.",
  proteinGrams:
    "Your total protein intake for the day, in grams. An estimate is fine if you didn’t track it precisely.",
  notes:
    "Capture context for your recovery ratings, such as interrupted sleep, travel, or a particularly demanding session.",
  nutritionNotes:
    "Capture context for your nutrition ratings, such as meal timing, hydration, or what worked during training.",
};

const CheckInForm = ({
  date,
  entry,
  ownerId,
  section,
}: {
  date: string;
  entry?: CheckInEntry;
  ownerId: string;
  section: CheckInSection;
}) => {
  const fieldIdPrefix = useId();
  const queryClient = useQueryClient();
  const preferences = useCheckInPreferences(ownerId);
  const [draft, setDraft] = useState<Partial<Record<CheckInField, string>>>({});
  const [saved, setSaved] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);
  const clearTrigger = useRef<HTMLButtonElement>(null);
  const mutation = useMutation({
    mutationFn: ({ fields }: { fields: Parameters<typeof checkInApi.save>[1]; clear?: boolean }) =>
      checkInApi.save(date, fields),
    onSuccess: async (result, { clear }) => {
      await queryClient.cancelQueries({ queryKey: checkInKey(ownerId) });
      queryClient.setQueriesData<CheckInEntry[]>(
        {
          queryKey: checkInKey(ownerId),
          predicate: ({ queryKey: [, , start, end] }) =>
            typeof start === "string" && typeof end === "string" && start <= date && date <= end,
        },
        (entries) => {
          if (!entries) return entries;
          const other = entries.filter((entry) => entry.date !== date);
          return checkInSections.some((section) => hasCheckInResponse(result, section))
            ? [...other, result].sort((a, b) => a.date.localeCompare(b.date))
            : other;
        },
      );
      void queryClient.invalidateQueries({ queryKey: metricsKey(ownerId) });
      await queryClient.invalidateQueries({ queryKey: checkInKey(ownerId) });
      setDraft({});
      setSaved(`${section.title} ${clear ? "cleared" : "saved"}.`);
    },
  });

  if (preferences.isError) {
    return (
      <Stack align="start">
        <Notice role="alert">Unable to load check-in field settings.</Notice>
        <Button size="sm" variant="outline" onClick={() => void preferences.refetch()}>
          Retry
        </Button>
      </Stack>
    );
  }
  if (!preferences.data) return <Notice role="status">Loading check-in fields…</Notice>;

  const hidden = new Set(preferences.data.disabled);
  const busy = mutation.isPending;
  const visible = section.fields.filter(({ key }) => !hidden.has(key));
  const recorded = visible.filter(({ key }) => entry?.[key] != null && entry[key] !== "");
  const changedFields = visible.flatMap((field) => {
    const value = draft[field.key];
    if (value === undefined) return [];
    const parsed = "min" in field && value !== "" ? Number(value) : value || null;
    return (parsed ?? "") === (entry?.[field.key] ?? "") ? [] : [[field.key, parsed] as const];
  });
  return (
    <Stack gap="3">
      {!visible.length && (
        <Notice>
          All fields for this form are hidden.{" "}
          <Link asChild variant="underline">
            <RouterLink to="/settings">Manage fields in Settings</RouterLink>
          </Link>
        </Notice>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (busy || !changedFields.length) return;
          setSaved("");
          mutation.mutate({ fields: Object.fromEntries(changedFields) });
        }}
      >
        <Stack gap="3">
          {visible.length > 0 && (
            <Grid
              gap="3"
              templateColumns={{
                base: "minmax(0, 1fr)",
                sm: "repeat(2, minmax(0, 1fr))",
                xl: "repeat(3, minmax(0, 1fr))",
              }}
            >
              {visible.map((field) => {
                const { key, label } = field;
                const fieldId = `${fieldIdPrefix}-${key}`;
                const descriptionId = `${fieldId}-help`;
                const help = (
                  <FieldHelp label={label} description={fieldHelp[key]} id={descriptionId} />
                );
                const value = draft[key] ?? String(entry?.[key] ?? "");
                const onValueChange = (next: string) => {
                  setSaved("");
                  setDraft((current) => ({ ...current, [key]: next }));
                };
                if ("min" in field && field.min === 1 && field.max === 5) {
                  return (
                    <Grid key={key} gridRow="span 2" templateRows="subgrid" minW="0">
                      <Flex align="center" gap="1" wrap="wrap">
                        <Text fontSize="sm" fontWeight="medium">
                          {label}
                        </Text>
                        {help}
                      </Flex>
                      <Flex gap="1" align="center">
                        <SegmentGroup.Root
                          aria-label={label}
                          aria-describedby={descriptionId}
                          value={value || null}
                          disabled={busy}
                          onValueChange={({ value }) => onValueChange(value ?? "")}
                          size="md"
                          colorPalette="teal"
                          flex="1"
                          minW="0"
                          h={{ base: "11", md: "10" }}
                          css={{
                            "& [data-part=item]": { flex: "1", px: "1", h: "full", minW: "0" },
                          }}
                        >
                          <SegmentGroup.Indicator />
                          <SegmentGroup.Items items={["1", "2", "3", "4", "5"]} />
                        </SegmentGroup.Root>
                        {value && (
                          <Button
                            type="button"
                            size="2xs"
                            variant="ghost"
                            aria-label={`Clear ${label}`}
                            disabled={busy}
                            onClick={() => onValueChange("")}
                          >
                            Clear
                          </Button>
                        )}
                      </Flex>
                    </Grid>
                  );
                }
                if (!("min" in field) && !("choices" in field)) {
                  return (
                    <Box key={key} gridColumn="1 / -1">
                      <Disclosure
                        label={
                          value
                            ? `View or edit ${label.toLowerCase()}`
                            : `Add ${label.toLowerCase()}`
                        }
                      >
                        <Stack gap="1">
                          <Flex align="center" gap="1">
                            <FormField htmlFor={fieldId}>{label}</FormField>
                            {help}
                          </Flex>
                          <Textarea
                            id={fieldId}
                            aria-describedby={descriptionId}
                            value={value}
                            maxLength={10000}
                            disabled={busy}
                            onChange={(event) => onValueChange(event.target.value)}
                          />
                        </Stack>
                      </Disclosure>
                    </Box>
                  );
                }
                return (
                  <Grid key={key} gridRow="span 2" templateRows="subgrid" minW="0">
                    <Flex align="center" gap="1">
                      <FormField htmlFor={fieldId}>{label}</FormField>
                      {help}
                    </Flex>
                    {"min" in field ? (
                      <Input
                        id={fieldId}
                        aria-describedby={descriptionId}
                        type="number"
                        inputMode={field.step === "any" ? "decimal" : "numeric"}
                        min={field.min}
                        max={"max" in field ? field.max : undefined}
                        step={field.step}
                        value={value}
                        disabled={busy}
                        onChange={(event) => onValueChange(event.target.value)}
                      />
                    ) : (
                      <NativeSelect.Root disabled={busy}>
                        <NativeSelect.Field
                          id={fieldId}
                          aria-describedby={descriptionId}
                          value={value}
                          onChange={(event) => onValueChange(event.target.value)}
                        >
                          <option value="">Unrecorded</option>
                          {field.choices.map(({ value, label }) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          ))}
                        </NativeSelect.Field>
                        <NativeSelect.Indicator />
                      </NativeSelect.Root>
                    )}
                  </Grid>
                );
              })}
            </Grid>
          )}
          <Stack
            position="sticky"
            bottom="0"
            zIndex="1"
            bg="bg.panel"
            borderTopWidth="1px"
            py="2"
            gap="2"
          >
            {mutation.isError && (
              <Notice role="alert">
                {errorMessage(mutation.error, "Unable to update the check-in.")}
              </Notice>
            )}
            {saved && <Notice role="status">{saved}</Notice>}
            <Button
              type="submit"
              alignSelf="start"
              colorPalette="teal"
              loading={mutation.isPending && !mutation.variables?.clear}
              loadingText="Saving…"
              disabled={busy || !changedFields.length}
            >
              {section.id === "nutrition" ? "Save nutrition log" : "Save check-in"}
            </Button>
          </Stack>
        </Stack>
      </form>
      {recorded.length > 0 && (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          alignSelf="start"
          colorPalette="red"
          disabled={busy}
          ref={clearTrigger}
          onClick={() => setConfirmClear(true)}
        >
          Clear visible fields
        </Button>
      )}
      {confirmClear && recorded.length > 0 && (
        <ConfirmationDialog
          title="Clear visible fields?"
          description={`This clears the recorded values in the visible fields for this ${section.title.toLowerCase()}.`}
          confirmLabel="Clear visible fields"
          destructive
          returnFocus={() => clearTrigger.current}
          onDismiss={() => setConfirmClear(false)}
          onConfirm={() => {
            setSaved("");
            mutation.mutate({
              fields: Object.fromEntries(recorded.map(({ key }) => [key, null])),
              clear: true,
            });
          }}
        />
      )}
    </Stack>
  );
};

export const CheckInDialog = ({
  date,
  isTrainingDay,
  ownerId,
  section = checkInSections[0],
  close,
  trigger,
}: {
  date: string;
  isTrainingDay: boolean | undefined;
  ownerId: string;
  section: CheckInSection;
  close: () => void;
  trigger: () => HTMLElement | null;
}) => {
  const title = useRef<HTMLHeadingElement>(null);
  const query = useQuery({
    queryKey: [...checkInKey(ownerId), date, date],
    queryFn: ({ signal }) => checkInApi.list(date, date, signal),
    retry: false,
  });
  const entry = query.data?.find((item) => item.date === date);
  const instructions =
    isTrainingDay === undefined
      ? "On training days, answer based on how you feel before your first session. On rest days, answer based on how you feel around your usual training time, if you can."
      : isTrainingDay
        ? "Fill this out before your first session. Answer each question based on how you feel before training."
        : "Fill this out around the time you usually train, if you can. Answer each question based on how you feel at the time.";
  return (
    <Dialog.Root
      open
      onOpenChange={({ open }) => {
        if (!open) close();
      }}
      onEscapeKeyDown={(event) => {
        if (document.activeElement?.matches('[data-field-help][aria-expanded="true"]')) {
          event.preventDefault();
        }
      }}
      initialFocusEl={() => title.current}
      finalFocusEl={trigger}
      placement="center"
      scrollBehavior="inside"
      size="xl"
    >
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner p={{ base: "3", md: "6" }}>
          <Dialog.Content maxH={{ base: "100%", md: "calc(100dvh - 4rem)" }}>
            <Dialog.Header
              alignItems="start"
              justifyContent="space-between"
              borderBottomWidth="1px"
              py="3"
            >
              <Stack gap="1">
                <Dialog.Title ref={title} tabIndex={-1}>
                  {section.title}
                </Dialog.Title>
                <Flex align="center" gap="2" wrap="wrap">
                  <Text fontSize="sm" color="fg.muted">
                    {fullDate(date)}
                  </Text>
                  {hasCheckInResponse(entry, section) && (
                    <Badge colorPalette="green">Complete</Badge>
                  )}
                </Flex>
              </Stack>
              <Dialog.CloseTrigger asChild position="static">
                <Button
                  aria-label={`Close ${section.title.toLowerCase()}`}
                  variant="ghost"
                  size="sm"
                >
                  <Text as="span" aria-hidden="true" fontSize="2xl" lineHeight="none">
                    ×
                  </Text>
                </Button>
              </Dialog.CloseTrigger>
            </Dialog.Header>
            <Dialog.Body py="4">
              {query.isPending && <Notice role="status">Loading entry…</Notice>}
              {query.isError && !query.data && (
                <Stack align="start">
                  <Notice role="alert">
                    {errorMessage(query.error, "Unable to load the entry.")}
                  </Notice>
                  <Button size="sm" variant="outline" onClick={() => void query.refetch()}>
                    Retry
                  </Button>
                </Stack>
              )}
              {query.data && (
                <Stack gap="3">
                  {section.id === "recovery" && (
                    <Text color="fg.muted" fontSize="sm">
                      {instructions}
                    </Text>
                  )}
                  <Text color="fg.muted" fontSize="sm">
                    All fields are optional.
                  </Text>
                  <CheckInForm date={date} entry={entry} ownerId={ownerId} section={section} />
                </Stack>
              )}
            </Dialog.Body>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
};
