import { Box, Button, Dialog, Flex, Grid, Link, Portal, Stack, Text } from "@chakra-ui/react";
import { Link as RouterLink } from "react-router";
import { AppIcon } from "../../app/AppIcon";
import type { NutritionDaySummary } from "../nutrition/consumed";
import { macroFields } from "../nutrition/foods";
import type { NutritionTotals } from "../nutrition/planned";
import type { CalendarMacroTolerance } from "../recovery/recovery";
import { fullDate } from "./dates";

const hasCalendarNutrition = (day?: NutritionDaySummary): day is NutritionDaySummary =>
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
      h="1"
      bg="bg.emphasized"
      borderRadius="full"
      position="relative"
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
      {target != null && (
        <Box
          as="span"
          position="absolute"
          insetBlock="-1"
          insetInlineStart={position(target)}
          borderInlineStartWidth="1px"
          borderStyle="dashed"
          borderColor="fg"
        />
      )}
    </Box>
  );
};

export const CalendarNutrition = ({
  day,
  compact,
  today,
  tolerance,
  onOpen,
}: {
  day?: NutritionDaySummary;
  compact?: boolean;
  today: string;
  tolerance: CalendarMacroTolerance;
  onOpen: (date: string, trigger: HTMLButtonElement) => void;
}) => {
  if (!hasCalendarNutrition(day)) return null;
  const pastTolerance = day.date < today ? tolerance : undefined;
  const values = nutritionValues(day).map(({ key, label, planned, eaten }) => {
    const plan = completeAmount(planned);
    const actual = completeAmount(eaten);
    return {
      key,
      label,
      plan,
      actual,
      status: adherence(plan, actual, pastTolerance),
      abovePlan: !!pastTolerance && isAbovePlan(plan, actual),
    };
  });
  const comparisons = values.flatMap(({ label, status, abovePlan }) =>
    status ? [`${label}: ${abovePlan ? "above plan, " : ""}${status.label}`] : [],
  );
  const hasChart = values.some(({ plan, actual }) => plan !== null || actual !== null);

  return (
    <Button
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
      aria-label={`Nutrition details for ${fullDate(day.date)}. ${day.planned.entryCount} planned, ${day.consumed.entryCount} eaten.${comparisons.length ? " " + comparisons.join(". ") : ""}`}
      aria-haspopup="dialog"
      title={
        hasChart
          ? "Nutrition details. Gray ticks mark planned amounts. Up arrows show past totals above plan."
          : "Nutrition details"
      }
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
          {values.map(({ key, plan, actual, status, abovePlan }) => (
            <Stack as="span" key={key} gap="1" textAlign="start">
              <Text
                as="span"
                fontSize="2xs"
                lineHeight="shorter"
                color="fg.muted"
                whiteSpace="nowrap"
              >
                {previewLabels[key]}
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

export const CalendarNutritionDialog = ({
  day,
  programId,
  today,
  tolerance,
  open,
  close,
  trigger,
}: {
  day: NutritionDaySummary;
  programId?: string;
  today: string;
  tolerance: CalendarMacroTolerance;
  open: boolean;
  close: () => void;
  trigger: () => HTMLButtonElement | null;
}) => {
  const params = new URLSearchParams({ date: day.date });
  if (programId) params.set("program", programId);

  return (
    <Dialog.Root
      open={open}
      onOpenChange={({ open }) => !open && close()}
      finalFocusEl={trigger}
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
            <Dialog.CloseTrigger aria-label="Close nutrition details">×</Dialog.CloseTrigger>
            <Dialog.Body>
              <Stack gap="4">
                <Text fontSize="sm" color="fg.muted">
                  {day.planned.entryCount} planned · {day.consumed.entryCount} eaten
                </Text>
                <Text fontSize="xs" color="fg.muted">
                  Bars show eaten amounts. Gray ticks mark planned amounts and dashed ticks mark
                  targets.
                </Text>
                {nutritionValues(day).map(({ key, label, unit, planned, eaten, target }) => {
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
                        <Text>Planned {formatAmount(planned)}</Text>
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
