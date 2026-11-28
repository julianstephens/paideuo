import { Box, Button, Dialog, Flex, Grid, Link, Portal, Stack, Text } from "@chakra-ui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { metricsKey } from "../compliance/metrics";
import { useRef, useState } from "react";
import { Link as RouterLink } from "react-router";
import { AppIcon } from "../../app/AppIcon";
import { Notice } from "../../components/ui";
import { errorMessage } from "../../lib/api/request";
import { consumedApi, consumedKey } from "../nutrition/consumed";
import type { ConsumedChange, ConsumedEntry, NutritionDaySummary } from "../nutrition/consumed";
import { FoodEntryForm } from "../nutrition/FoodEntryForm";
import { macroFields } from "../nutrition/foods";
import { nutritionOperation } from "../nutrition/operation";
import { plannedApi, plannedKey } from "../nutrition/planned";
import type { Change, NutritionTotals, PlannedEntry } from "../nutrition/planned";
import type { CalendarMacroTolerance } from "../recovery/recovery";
import { fullDate } from "./dates";

const hasCalendarNutrition = (day?: NutritionDaySummary) =>
  !!day && (day.target.active || day.planned.entryCount > 0 || day.consumed.entryCount > 0);

const nutritionValues = (day: NutritionDaySummary) =>
  macroFields.map((field) => ({
    ...field,
    planned: estimate(day.planned, field.key),
    eaten: estimate(day.consumed, field.key),
    target: day.target.active ? day.target.macros?.[field.key].value : undefined,
  }));

const estimate = (totals: NutritionTotals, macro: keyof NutritionTotals["macros"]) => {
  const { subtotal, knownCount } = totals.macros[macro];
  return {
    subtotal,
    available: totals.entryCount > 0,
    partial: knownCount < totals.entryCount,
  };
};

const completeAmount = ({ partial, available, subtotal }: ReturnType<typeof estimate>) =>
  available && !partial ? subtotal : null;

const formatAmount = ({ subtotal, available, partial }: ReturnType<typeof estimate>) => {
  if (!available) return "—";
  if (subtotal === null) return "Unknown";
  return partial ? `${subtotal} (partial)` : String(subtotal);
};

const adherenceColors = {
  within: { bar: "teal.solid", text: "teal.fg", label: "Within tolerance" },
  warning: {
    bar: "color-mix(in srgb, var(--chakra-colors-yellow-solid) 70%, var(--chakra-colors-fg-muted))",
    text: "color-mix(in srgb, var(--chakra-colors-yellow-fg) 70%, var(--chakra-colors-fg-muted))",
    label: "Outside preferred range",
  },
  outside: {
    bar: "color-mix(in srgb, var(--chakra-colors-red-solid) 70%, var(--chakra-colors-fg-muted))",
    text: "color-mix(in srgb, var(--chakra-colors-red-fg) 70%, var(--chakra-colors-fg-muted))",
    label: "Outside warning range",
  },
} as const;

const adherence = (
  planned: number | null,
  eaten: number | null,
  tolerance: CalendarMacroTolerance | undefined,
) => {
  if (!tolerance || planned === null || eaten === null) return undefined;
  if (planned === 0) return eaten === 0 ? adherenceColors.within : adherenceColors.outside;

  const difference = Math.abs(eaten - planned);
  const roundingMargin = Number.EPSILON * Math.max(planned, eaten) * 4;
  const withinLimit = (percent: number) => difference <= (percent / 100) * planned + roundingMargin;
  if (withinLimit(tolerance.withinPercent)) return adherenceColors.within;
  if (withinLimit(tolerance.warningPercent)) return adherenceColors.warning;
  return adherenceColors.outside;
};

const isAbovePlan = (planned: number | null, actual: number | null) =>
  planned !== null && actual !== null && actual > planned;

const previewLabels = {
  calories: "kcal",
  protein: "Protein",
  carbohydrate: "Carbs",
  fat: "Fat",
} satisfies Record<(typeof macroFields)[number]["key"], string>;

const NutritionBar = ({
  planned,
  eaten,
  target,
  status,
  tolerance,
}: {
  planned: number | null;
  eaten: number | null;
  target?: number | null;
  status?: ReturnType<typeof adherence>;
  tolerance?: CalendarMacroTolerance;
}) => {
  const scale = Math.max(planned ?? 0, eaten ?? 0, target ?? 0);
  const position = (amount: number) => `${scale > 0 ? (amount / scale) * 95 : 0}%`;

  let bands: string | undefined;
  if (tolerance && planned !== null && planned > 0 && eaten !== null && eaten > planned) {
    const limit = (percent: number) => `${Math.min(100, (planned / eaten) * (100 + percent))}%`;
    const tealEnd = limit(tolerance.withinPercent);
    const teal = `var(--chakra-colors-teal-solid) 0 ${tealEnd}`;
    if (status === adherenceColors.warning) {
      bands = `linear-gradient(90deg, ${teal}, ${adherenceColors.warning.bar} ${tealEnd} 100%)`;
    } else if (status === adherenceColors.outside) {
      const yellowEnd = limit(tolerance.warningPercent);
      bands = `linear-gradient(90deg, ${teal}, ${adherenceColors.warning.bar} ${tealEnd} ${yellowEnd}, ${adherenceColors.outside.bar} ${yellowEnd} 100%)`;
    }
  }

  return (
    <Box
      as="span"
      aria-hidden="true"
      display="block"
      position="relative"
      h="1"
      bg="bg.emphasized"
      borderRadius="full"
    >
      {eaten !== null && (
        <Box
          as="span"
          display="block"
          h="full"
          w={position(eaten)}
          minW={eaten === 0 && status ? "2px" : undefined}
          bg={status?.bar ?? "teal.solid"}
          bgImage={bands}
          borderRadius="full"
        />
      )}
      {target != null && (
        <Box
          as="span"
          position="absolute"
          insetBlock="-1"
          insetInlineStart={position(target)}
          w="1px"
          bg="fg"
        />
      )}
      {planned !== null && (
        <Box
          as="span"
          position="absolute"
          insetBlock="-0.5"
          insetInlineStart={position(planned)}
          w="0.5"
          borderRadius="full"
          bg="fg.muted"
        />
      )}
    </Box>
  );
};

export const CalendarNutrition = ({
  id,
  day,
  compact,
  today,
  tolerance,
  onOpen,
}: {
  id: string;
  day?: NutritionDaySummary;
  compact?: boolean;
  today: string;
  tolerance: CalendarMacroTolerance;
  onOpen: (date: string, trigger: HTMLButtonElement) => void;
}) => {
  if (!day) return null;
  if (!hasCalendarNutrition(day)) {
    return compact ? null : (
      <Button
        id={id}
        size="xs"
        variant="ghost"
        minH="44px"
        alignSelf="start"
        aria-label={`Add food for ${fullDate(day.date)}`}
        aria-haspopup="dialog"
        onClick={(event) => onOpen(day.date, event.currentTarget)}
      >
        Add food
      </Button>
    );
  }
  const showPlan = day.target.active || day.planned.entryCount > 0;
  const pastTolerance = day.date < today ? tolerance : undefined;
  const values = nutritionValues(day).map(({ key, label, unit, planned, eaten, target }) => {
    const plan = completeAmount(planned);
    const actual = completeAmount(eaten);
    return {
      key,
      label,
      plan,
      actual,
      target,
      summary: `${label} (${unit}): Eaten ${formatAmount(eaten)} · Planned ${formatAmount(planned)} · Target ${target ?? "—"}`,
      status: adherence(plan, actual, pastTolerance),
      abovePlan: !!pastTolerance && isAbovePlan(plan, actual),
    };
  });
  const comparisons = values.flatMap(({ label, status, abovePlan }) =>
    status ? [`${label}: ${abovePlan ? "above plan, " : ""}${status.label}`] : [],
  );
  const hasChart = values.some(
    ({ plan, actual, target }) => plan !== null || actual !== null || target != null,
  );
  const summaries = values.map(({ summary }) => summary);

  return (
    <Button
      id={id}
      type="button"
      variant={compact ? "ghost" : "outline"}
      size="xs"
      minH={compact ? "32px" : "44px"}
      h="auto"
      px={compact ? "1" : "2"}
      py="1"
      gap="2"
      alignSelf={compact && hasChart ? "stretch" : "start"}
      w={!compact && hasChart ? "min(100%, 14rem)" : undefined}
      maxW="full"
      css={!compact && hasChart ? { container: "nutrition-preview / inline-size" } : undefined}
      focusVisibleRing={compact ? "inside" : "outside"}
      aria-label={`Nutrition details for ${fullDate(day.date)}. ${showPlan ? `${day.planned.entryCount} planned, ` : ""}${day.consumed.entryCount} eaten. ${[...summaries, ...comparisons].join(". ")}`}
      aria-haspopup="dialog"
      title={summaries.join("\n")}
      onClick={(event) => onOpen(day.date, event.currentTarget)}
    >
      {(!compact || !hasChart) && <AppIcon name="nutrition" size={16} />}
      {hasChart && (
        <Grid
          as="span"
          aria-hidden="true"
          templateColumns="repeat(2, minmax(0, 1fr))"
          gapX={compact ? "1" : "2"}
          gapY="1"
          w="full"
          minW="0"
          css={{
            [compact
              ? "@container calendar-day (min-width: 11rem)"
              : "@container nutrition-preview (min-width: 12.75rem)"]: {
              gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
            },
          }}
        >
          {values.map(({ key, plan, actual, target, status, abovePlan }) => (
            <Stack as="span" key={key} gap="1" textAlign="start">
              <Text
                as="span"
                fontSize="2xs"
                lineHeight="shorter"
                color="fg.muted"
                whiteSpace="nowrap"
              >
                {previewLabels[key]}
                {plan === null && actual === null && target != null && ` ${target}`}
              </Text>
              <Grid
                as="span"
                templateColumns={abovePlan ? "minmax(0, 1fr) auto" : "minmax(0, 1fr)"}
                columnGap="0.5"
                alignItems="center"
                h="3"
              >
                <NutritionBar
                  planned={plan}
                  eaten={actual}
                  target={target}
                  status={status}
                  tolerance={pastTolerance}
                />
                {abovePlan && (
                  <Text
                    as="span"
                    color={status?.text}
                    fontSize="xs"
                    fontWeight="bold"
                    lineHeight="1"
                  >
                    ↑
                  </Text>
                )}
              </Grid>
            </Stack>
          ))}
        </Grid>
      )}
    </Button>
  );
};

type FoodEditor =
  | { kind: "planned"; entry?: PlannedEntry }
  | { kind: "consumed"; entry?: ConsumedEntry; linkedPlan?: PlannedEntry };

type FoodChange =
  | { kind: "planned"; change: Change }
  | { kind: "consumed"; change: ConsumedChange };

export const CalendarNutritionDialog = ({
  day,
  ownerId,
  programId,
  timezone,
  today,
  tolerance,
  open,
  close,
  trigger,
}: {
  day: NutritionDaySummary;
  ownerId: string;
  programId?: string;
  timezone?: string;
  today: string;
  tolerance: CalendarMacroTolerance;
  open: boolean;
  close: () => void;
  trigger: () => HTMLElement | null;
}) => {
  const { date } = day;
  const client = useQueryClient();
  const [editor, setEditor] = useState<FoodEditor>();
  const editorTrigger = useRef<HTMLButtonElement>(null);
  const closeTrigger = useRef<HTMLButtonElement>(null);
  const closeEditor = () => {
    setEditor(undefined);
    requestAnimationFrame(() => {
      const button = editorTrigger.current;
      (button?.isConnected ? button : closeTrigger.current)?.focus();
    });
  };
  const planned = useQuery({
    queryKey: [...plannedKey(ownerId), "date", date],
    queryFn: ({ signal }) => plannedApi.list(date, signal),
    enabled: open,
  });
  const eaten = useQuery({
    queryKey: [...consumedKey(ownerId), "date", date],
    queryFn: ({ signal }) => consumedApi.list({ date }, signal),
    enabled: open,
  });
  const mutation = useMutation({
    mutationFn: ({ change, operationId }: { change: FoodChange; operationId: string }) =>
      change.kind === "planned"
        ? plannedApi.mutate({ change: change.change, operationId })
        : consumedApi.mutate({ change: change.change, operationId }),
    onSuccess: async (_, { change }) => {
      await Promise.all([
        client.invalidateQueries({ queryKey: metricsKey(ownerId) }),
        ...(change.kind === "planned"
          ? [
              client.invalidateQueries({ queryKey: plannedKey(ownerId) }),
              client.invalidateQueries({ queryKey: [...consumedKey(ownerId), "summary"] }),
            ]
          : [client.invalidateQueries({ queryKey: consumedKey(ownerId) })]),
      ]);
      closeEditor();
    },
  });
  const startEditor = (next: FoodEditor, button: HTMLButtonElement) => {
    editorTrigger.current = button;
    mutation.reset();
    setEditor(next);
  };
  const save = (change: FoodChange) =>
    mutation.mutate(nutritionOperation(change, mutation.isError ? mutation.variables : undefined));
  const closeDialog = () => {
    if (mutation.isPending) return;
    setEditor(undefined);
    mutation.reset();
    close();
  };
  const formContext = {
    date,
    ownerId,
    programId,
    timezone,
    pending: mutation.isPending,
    onClose: () => {
      mutation.reset();
      closeEditor();
    },
  };
  const lastPlannedEntry = planned.data?.at(-1);
  const nextOrder = lastPlannedEntry
    ? Math.min(1000000, (lastPlannedEntry.data.order ?? 0) + 1)
    : 0;

  const showPlan = day.target.active || day.planned.entryCount > 0;
  const params = new URLSearchParams({ date });
  if (programId) params.set("program", programId);

  return (
    <Dialog.Root
      open={open}
      onOpenChange={({ open }) => !open && closeDialog()}
      closeOnEscape={!mutation.isPending}
      closeOnInteractOutside={!mutation.isPending}
      finalFocusEl={trigger}
      onExitComplete={() => requestAnimationFrame(() => trigger()?.focus())}
      size={{ smDown: "full", sm: "md" }}
      placement="center"
      scrollBehavior="inside"
    >
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content>
            <Dialog.Header>
              <Dialog.Title>Nutrition · {fullDate(day.date)}</Dialog.Title>
            </Dialog.Header>
            <Dialog.CloseTrigger
              ref={closeTrigger}
              aria-label="Close nutrition details"
              disabled={mutation.isPending}
            >
              ×
            </Dialog.CloseTrigger>
            <Dialog.Body>
              <Stack gap="4">
                <Text fontSize="sm" color="fg.muted">
                  {showPlan && `${day.planned.entryCount} planned · `}
                  {day.consumed.entryCount} eaten
                </Text>
                {hasCalendarNutrition(day) && (
                  <Text fontSize="xs" color="fg.muted">
                    Fill shows eaten.
                    {day.planned.entryCount > 0 && " Short ticks mark planned food."}
                    {day.target.active && " Tall ticks mark program targets."}
                  </Text>
                )}
                {hasCalendarNutrition(day) &&
                  nutritionValues(day).map(({ key, label, unit, planned, eaten, target }) => {
                    const plan = completeAmount(planned);
                    const actual = completeAmount(eaten);
                    const pastTolerance = day.date < today ? tolerance : undefined;
                    const status = adherence(plan, actual, pastTolerance);
                    return (
                      <Stack key={key} as="section" aria-label={label} gap="2">
                        <Text fontWeight="semibold">
                          {label} ({unit})
                        </Text>
                        <NutritionBar
                          planned={plan}
                          eaten={actual}
                          target={target}
                          status={status}
                          tolerance={pastTolerance}
                        />
                        <Flex gapX="4" gapY="1" wrap="wrap" fontSize="sm">
                          {showPlan && <Text>Planned {formatAmount(planned)}</Text>}
                          <Text>
                            Eaten{" "}
                            <Text as="span" color={status?.text}>
                              {formatAmount(eaten)}
                            </Text>
                          </Text>
                          {target != null && <Text>Target {target}</Text>}
                        </Flex>
                        {status && (
                          <Text fontSize="xs" color="fg.muted">
                            {isAbovePlan(plan, actual)
                              ? `Above plan · ${status.label}`
                              : status.label}
                          </Text>
                        )}
                      </Stack>
                    );
                  })}
                <Stack as="section" aria-label="Planned foods" gap="2">
                  <Flex justify="space-between" align="center" wrap="wrap" gap="2">
                    <Text as="h3" fontWeight="semibold">
                      Planned
                    </Text>
                    <Button
                      size="sm"
                      disabled={!!editor || !planned.isSuccess}
                      onClick={(event) => startEditor({ kind: "planned" }, event.currentTarget)}
                    >
                      Add planned food
                    </Button>
                  </Flex>
                  {planned.isPending && <Text role="status">Loading planned foods…</Text>}
                  {planned.isError && (
                    <Notice role="alert">
                      {errorMessage(planned.error, "Unable to load planned foods.")}
                    </Notice>
                  )}
                  {planned.data?.length === 0 && <Text color="fg.muted">No food scheduled.</Text>}
                  {planned.data?.map((entry) => (
                    <Flex key={entry.id} justify="space-between" align="start" wrap="wrap" gap="2">
                      <CalendarFoodLabel
                        entry={entry}
                        detail={entry.data.canceled ? "Canceled" : undefined}
                      />
                      <Flex wrap="wrap" gap="1">
                        <Button
                          size="sm"
                          variant="outline"
                          aria-label={`Log eaten portion of ${entry.data.snapshot.title}`}
                          disabled={!!editor || entry.data.canceled}
                          onClick={(event) =>
                            startEditor(
                              { kind: "consumed", linkedPlan: entry },
                              event.currentTarget,
                            )
                          }
                        >
                          Log eaten
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={`Edit planned ${entry.data.snapshot.title}`}
                          disabled={!!editor}
                          onClick={(event) =>
                            startEditor({ kind: "planned", entry }, event.currentTarget)
                          }
                        >
                          Edit
                        </Button>
                      </Flex>
                    </Flex>
                  ))}
                </Stack>
                <Stack as="section" aria-label="Eaten foods" gap="2">
                  <Flex justify="space-between" align="center" wrap="wrap" gap="2">
                    <Text as="h3" fontWeight="semibold">
                      Eaten
                    </Text>
                    <Button
                      size="sm"
                      disabled={!!editor}
                      onClick={(event) => startEditor({ kind: "consumed" }, event.currentTarget)}
                    >
                      Log food
                    </Button>
                  </Flex>
                  {eaten.isPending && <Text role="status">Loading eaten foods…</Text>}
                  {eaten.isError && (
                    <Notice role="alert">
                      {errorMessage(eaten.error, "Unable to load eaten foods.")}
                    </Notice>
                  )}
                  {eaten.data?.length === 0 && <Text color="fg.muted">No food logged.</Text>}
                  {eaten.data?.map((entry) => (
                    <Flex key={entry.id} justify="space-between" align="start" wrap="wrap" gap="2">
                      <CalendarFoodLabel
                        entry={entry}
                        detail={
                          entry.data.plannedId &&
                          (entry.data.source.kind === "planned" ? "Linked to plan" : "Substitution")
                        }
                      />
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`Edit eaten ${entry.data.snapshot.title}`}
                        disabled={!!editor}
                        onClick={(event) =>
                          startEditor({ kind: "consumed", entry }, event.currentTarget)
                        }
                      >
                        Edit
                      </Button>
                    </Flex>
                  ))}
                </Stack>
                {mutation.isError && (
                  <Notice role="alert">
                    {errorMessage(mutation.error, "Unable to save food. Try again.")}
                  </Notice>
                )}
                {editor?.kind === "planned" && (
                  <FoodEntryForm
                    {...formContext}
                    kind="planned"
                    entry={editor.entry}
                    order={nextOrder}
                    onSave={(change) => save({ kind: "planned", change })}
                  />
                )}
                {editor?.kind === "consumed" && (
                  <FoodEntryForm
                    {...formContext}
                    kind="consumed"
                    entry={editor.entry}
                    linkedPlan={editor.linkedPlan}
                    onSave={(change) => save({ kind: "consumed", change })}
                  />
                )}
              </Stack>
            </Dialog.Body>
            <Dialog.Footer justifyContent="start">
              <Link
                asChild
                variant="underline"
                minH="44px"
                display="inline-flex"
                alignItems="center"
              >
                <RouterLink to={"/nutrition?" + params}>Open meal planner</RouterLink>
              </Link>
            </Dialog.Footer>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
};

const CalendarFoodLabel = ({
  entry: { data },
  detail,
}: {
  entry: PlannedEntry | ConsumedEntry;
  detail?: string;
}) => (
  <Stack gap="0">
    <Text fontWeight="medium">{data.snapshot.title}</Text>
    <Text fontSize="sm" color="fg.muted">
      {[data.meal, data.quantity + " × " + data.snapshot.serving.description, detail]
        .filter(Boolean)
        .join(" · ")}
    </Text>
  </Stack>
);
