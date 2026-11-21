import {
  Badge,
  Box,
  Button,
  Dialog,
  Flex,
  Grid,
  Input,
  NativeSelect,
  Portal,
  SegmentGroup,
  Stack,
  Text,
  Textarea,
} from "@chakra-ui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Disclosure, FormField, Notice } from "../../components/ui";
import { errorMessage } from "../../lib/api/request";
import { fullDate } from "../calendar/dates";
import { metricsKey } from "../compliance/metrics";
import {
  checkInApi,
  checkInFieldKeys,
  checkInKey,
  checkInPreferencesKey,
  checkInSections,
} from "./recovery";
import type { CheckInEntry, CheckInField } from "./recovery";

const CheckInForm = ({
  date,
  entry,
  ownerId,
}: {
  date: string;
  entry?: CheckInEntry;
  ownerId: string;
}) => {
  const queryClient = useQueryClient();
  const preferencesKey = checkInPreferencesKey(ownerId);
  const preferences = useQuery({
    queryKey: preferencesKey,
    queryFn: ({ signal }) => checkInApi.preferences(signal),
    retry: false,
  });
  const [draft, setDraft] = useState<Partial<Record<CheckInField, string>>>({});
  const visibility = useMutation({
    mutationFn: ({ keys, enabled }: { keys: CheckInField[]; enabled: boolean }) =>
      checkInApi.updatePreferences({ group: "disabled", keys, enabled }),
    onSuccess: (data, { keys, enabled }) => {
      queryClient.setQueryData(preferencesKey, data);
      if (!enabled) {
        setDraft((current) => {
          const remaining = { ...current };
          for (const key of keys) delete remaining[key];
          return remaining;
        });
      }
    },
  });
  const [saved, setSaved] = useState("");
  const mutation = useMutation({
    mutationFn: async (fields: Parameters<typeof checkInApi.save>[1] | null) => {
      if (fields) await checkInApi.save(date, fields);
      else await checkInApi.remove(date);
    },
    onSuccess: async (_result, fields) => {
      void queryClient.invalidateQueries({ queryKey: metricsKey(ownerId) });
      await queryClient.invalidateQueries({ queryKey: checkInKey(ownerId) });
      setDraft({});
      setSaved(fields ? "Check-in saved." : "Check-in deleted.");
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
  const busy = mutation.isPending || visibility.isPending;
  const changedFields = checkInSections.flatMap(({ fields }) =>
    fields.flatMap((field) => {
      const value = draft[field.key];
      if (value === undefined || hidden.has(field.key)) return [];
      const parsed = "min" in field && value !== "" ? Number(value) : value || null;
      return (parsed ?? "") === (entry?.[field.key] ?? "") ? [] : [[field.key, parsed] as const];
    }),
  );
  return (
    <Stack gap="3">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (busy || !changedFields.length) return;
          setSaved("");
          mutation.mutate(Object.fromEntries(changedFields));
        }}
      >
        <Stack gap="3">
          {checkInSections.map(({ label, fields }) => {
            const visible = fields.filter(({ key }) => !hidden.has(key));
            if (!visible.length) return null;
            return (
              <Stack key={label} as="fieldset" minW="0" borderWidth="1px" borderRadius="md" p="3">
                <Text as="legend" fontWeight="semibold" px="1">
                  {label}
                </Text>
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
                    const value = draft[key] ?? String(entry?.[key] ?? "");
                    const onValueChange = (next: string) => {
                      setSaved("");
                      setDraft((current) => ({ ...current, [key]: next }));
                    };
                    if ("min" in field && field.min === 1 && field.max === 5) {
                      return (
                        <Stack key={key} gap="1.5" align="start">
                          <Flex align="baseline" gap="2" wrap="wrap">
                            <Text fontSize="sm" fontWeight="medium">
                              {label}
                            </Text>
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
                          <SegmentGroup.Root
                            aria-label={label}
                            value={value || null}
                            disabled={busy}
                            onValueChange={({ value }) => onValueChange(value ?? "")}
                            size="sm"
                            colorPalette="teal"
                          >
                            <SegmentGroup.Indicator />
                            <SegmentGroup.Items items={["1", "2", "3", "4", "5"]} />
                          </SegmentGroup.Root>
                        </Stack>
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
                            <Textarea
                              aria-label={label}
                              value={value}
                              maxLength={10000}
                              disabled={busy}
                              onChange={(event) => onValueChange(event.target.value)}
                            />
                          </Disclosure>
                        </Box>
                      );
                    }
                    return (
                      <FormField key={key}>
                        {label}
                        {"min" in field ? (
                          <Input
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
                      </FormField>
                    );
                  })}
                </Grid>
              </Stack>
            );
          })}
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
              loading={mutation.isPending && mutation.variables !== null}
              loadingText="Saving…"
              disabled={busy || !changedFields.length}
            >
              Save check-in
            </Button>
          </Stack>
        </Stack>
      </form>
      <Disclosure label="Choose check-in fields">
        <Stack gap="2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            alignSelf="start"
            aria-label="Select all check-in fields"
            disabled={busy || !checkInFieldKeys.some((key) => hidden.has(key))}
            onClick={() => visibility.mutate({ keys: checkInFieldKeys, enabled: true })}
          >
            Select all
          </Button>
          {checkInSections.map(({ label, fields }) => (
            <Stack key={label} as="fieldset" gap="1">
              <Text as="legend" fontWeight="semibold">
                {label}
              </Text>
              {fields.map(({ key, label }) => (
                <Flex key={key} as="label" gap="2" align="center" fontSize="sm">
                  <input
                    type="checkbox"
                    checked={!hidden.has(key)}
                    disabled={busy}
                    onChange={(event) =>
                      visibility.mutate({ keys: [key], enabled: event.target.checked })
                    }
                  />
                  {label}
                </Flex>
              ))}
            </Stack>
          ))}
          {visibility.isError && (
            <Notice role="alert">
              {errorMessage(visibility.error, "Unable to update field visibility.")}
            </Notice>
          )}
        </Stack>
      </Disclosure>
      {entry && (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          alignSelf="start"
          colorPalette="red"
          disabled={busy}
          onClick={() => {
            if (window.confirm("Delete this check-in, including recovery and nutrition?")) {
              setSaved("");
              mutation.mutate(null);
            }
          }}
        >
          Delete check-in
        </Button>
      )}
    </Stack>
  );
};

export const CheckInDialog = ({
  date,
  ownerId,
  close,
  trigger,
}: {
  date: string;
  ownerId: string;
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
  return (
    <Dialog.Root
      open
      onOpenChange={({ open }) => {
        if (!open) close();
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
                  Daily check-in
                </Dialog.Title>
                <Flex align="center" gap="2" wrap="wrap">
                  <Text fontSize="sm" color="fg.muted">
                    {fullDate(date)}
                  </Text>
                  {entry && <Badge colorPalette="teal">Saved</Badge>}
                </Flex>
              </Stack>
              <Dialog.CloseTrigger asChild position="static">
                <Button aria-label="Close check-in" variant="ghost" size="sm">
                  <Text as="span" aria-hidden="true" fontSize="2xl" lineHeight="none">
                    ×
                  </Text>
                </Button>
              </Dialog.CloseTrigger>
            </Dialog.Header>
            <Dialog.Body py="4">
              {query.isPending && <Notice role="status">Loading check-in…</Notice>}
              {query.isError && !query.data && (
                <Stack align="start">
                  <Notice role="alert">
                    {errorMessage(query.error, "Unable to load the check-in.")}
                  </Notice>
                  <Button size="sm" variant="outline" onClick={() => void query.refetch()}>
                    Retry
                  </Button>
                </Stack>
              )}
              {query.data && (
                <Stack gap="3">
                  <Text color="fg.muted" fontSize="sm">
                    All fields are optional.
                  </Text>
                  <CheckInForm date={date} entry={entry} ownerId={ownerId} />
                </Stack>
              )}
            </Dialog.Body>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
};
