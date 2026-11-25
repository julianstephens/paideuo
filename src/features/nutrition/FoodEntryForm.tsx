import {
  Button,
  Flex,
  Heading,
  Input,
  NativeSelect,
  SimpleGrid,
  Stack,
  Textarea,
} from "@chakra-ui/react";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { FormField, Notice, Panel } from "../../components/ui";
import { errorMessage } from "../../lib/api/request";
import { foodQueryKey, foodsApi, macroFields } from "./foods";
import type { Food, FoodFields } from "./foods";
import type { Change, DraftEntry, FoodSource, PlannedEntry, PlannedInput } from "./planned";

import type { ConsumedChange, ConsumedDraft, ConsumedEntry } from "./consumed";

const mealLabels = ["Breakfast", "Lunch", "Dinner", "Snack"];

type FormContext = {
  date: string;
  ownerId: string;
  programId?: string;
  timezone?: string;
  pending: boolean;
  onClose: () => void;
};

type PlannedForm = {
  kind: "planned";
  entry?: PlannedEntry;
  order: number;
  onSave: (change: Change) => void;
  onQueue?: (draft: DraftEntry, title: string) => void;
};

type ConsumedForm = {
  kind: "consumed";
  entry?: ConsumedEntry;
  linkedPlan?: PlannedEntry;
  onSave: (change: ConsumedChange) => void;
  onQueue?: (draft: ConsumedDraft, title: string) => void;
};

const localTimestamp = (date: Date) =>
  new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 19);

export const FoodEntryForm = (props: FormContext & (PlannedForm | ConsumedForm)) => {
  const { entry, date, ownerId, programId, timezone, pending, onClose } = props;
  const linked = props.kind === "consumed" ? props.linkedPlan : undefined;
  const [source, setSource] = useState<FoodSource["kind"] | "planned">(linked ? "planned" : "bank");
  const [timeError, setTimeError] = useState<string>();
  const savedTime = props.kind === "consumed" ? props.entry?.data.consumedAt : undefined;
  const initialTime = savedTime ? localTimestamp(new Date(savedTime)) : "";
  const [search, setSearch] = useState("");
  const [after, setAfter] = useState<string[]>([]);
  const [selected, setSelected] = useState<Food>();
  const canSave = !!entry || source !== "bank" || !!selected;
  const externalId = useRef<string>(undefined);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    panel.current?.focus();
  }, []);
  const foods = useQuery({
    queryKey: [...foodQueryKey(ownerId), "planner", search, after.at(-1)],
    queryFn: ({ signal }) =>
      foodsApi.list({ search, category: "", status: "active" }, after.at(-1), signal),
    enabled: !entry && source === "bank",
  });
  const initialMeal = entry?.data.meal ?? linked?.data.meal ?? "";
  const [meal, setMeal] = useState(
    initialMeal && !mealLabels.includes(initialMeal) ? "custom" : initialMeal,
  );

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    const form = new FormData(event.currentTarget);
    const field = (name: string) => String(form.get(name) ?? "").trim();
    const overrides: NonNullable<PlannedInput["overrides"]> = {};
    const macros: FoodFields["macros"] = {};
    for (const { key } of macroFields) {
      const override = field("entry-" + key);
      if (override) overrides[key] = Number(override);
      else if (form.has("unknown-" + key)) overrides[key] = null;
      const estimate = field("food-" + key);
      if (estimate) macros[key] = Number(estimate);
    }
    const label = meal === "custom" ? field("custom") : meal;
    const data = {
      date: field("date"),
      quantity: Number(field("quantity")),
      notes: field("notes"),
      overrides,
    };
    let consumedAt: string | undefined;
    const time = field("consumedAt");
    if (time) {
      const normalized = time.length === 16 ? time + ":00" : time;
      const instant = new Date(normalized);
      if (!Number.isFinite(instant.getTime()) || localTimestamp(instant) !== normalized) {
        setTimeError(
          "Choose a valid local date and time. The clock may skip some times when daylight saving begins.",
        );
        return;
      }
      consumedAt = normalized === initialTime ? savedTime : instant.toISOString();
    }
    setTimeError(undefined);
    if (props.kind === "consumed" && props.entry) {
      props.onSave({
        action: "update",
        id: props.entry.id,
        data: { ...data, meal: label || null, consumedAt: consumedAt ?? null },
      });
      return;
    }
    const order = Number(field("order"));
    if (props.kind === "planned" && props.entry) {
      props.onSave({
        action: "update",
        id: props.entry.id,
        data: { ...data, order, meal: label || null },
      });
      return;
    }
    if (source === "bank" && !selected) return;
    const chosenSource: FoodSource =
      selected && source === "bank"
        ? { kind: "bank", foodId: selected.id }
        : {
            kind: "inline",
            food: {
              title: field("title"),
              serving: {
                description: field("description"),
                size: Number(field("size")),
                unit: field("unit"),
              },
              macros,
            },
          };
    const createData = {
      ...data,
      ...(label ? { meal: label } : {}),
      ...(linked ? {} : { programId, timezone }),
    };
    const id = (externalId.current ??= crypto.randomUUID());
    const queue = (event.nativeEvent as SubmitEvent).submitter?.getAttribute("value") === "queue";
    const title =
      source === "planned"
        ? (linked?.data.snapshot.title ?? "")
        : chosenSource.kind === "inline"
          ? chosenSource.food.title
          : (selected?.data.title ?? "");
    if (props.kind === "consumed") {
      const draft: ConsumedDraft = {
        externalId: id,
        data: {
          ...createData,
          source: source === "planned" ? { kind: "planned" } : chosenSource,
          ...(linked ? { plannedId: linked.id } : {}),
          ...(consumedAt ? { consumedAt } : {}),
        },
      };
      if (queue) props.onQueue?.(draft, title);
      else props.onSave({ action: "create", ...draft });
      return;
    }
    const draft = { externalId: id, data: { ...createData, order, source: chosenSource } };
    if (queue) props.onQueue?.(draft, title);
    else props.onSave({ action: "create", ...draft });
  };

  return (
    <Panel ref={panel} tabIndex={-1}>
      <Heading size="md">
        {entry
          ? "Edit " + entry.data.snapshot.title
          : props.kind === "planned"
            ? "Add planned food"
            : linked
              ? "Log " + linked.data.snapshot.title
              : "Log food"}
      </Heading>
      <form onSubmit={submit}>
        <Stack gap="4">
          {!entry && (
            <FormField>
              Food source
              <NativeSelect.Root>
                <NativeSelect.Field
                  value={source}
                  onChange={(event) => {
                    const value = event.target.value;
                    setSource(value === "bank" || value === "planned" ? value : "inline");
                  }}
                >
                  {linked && <option value="planned">Planned food</option>}
                  <option value="bank">Food bank</option>
                  <option value="inline">One-off food</option>
                </NativeSelect.Field>
                <NativeSelect.Indicator />
              </NativeSelect.Root>
            </FormField>
          )}
          {!entry && source === "bank" && (
            <Stack>
              <FormField>
                Search food bank
                <Input
                  value={search}
                  onChange={(event) => {
                    setSearch(event.target.value);
                    setAfter([]);
                  }}
                />
              </FormField>
              {foods.isPending && <Notice role="status">Loading foods…</Notice>}
              {foods.isError && (
                <Notice role="alert">{errorMessage(foods.error, "Unable to load foods.")}</Notice>
              )}
              <FormField>
                Bank food
                <NativeSelect.Root>
                  <NativeSelect.Field
                    value={selected?.id ?? ""}
                    onChange={(event) =>
                      setSelected(foods.data?.items.find(({ id }) => id === event.target.value))
                    }
                  >
                    <option value="">Choose a food</option>
                    {selected && !foods.data?.items.some(({ id }) => id === selected.id) && (
                      <option value={selected.id}>{selected.data.title}</option>
                    )}
                    {foods.data?.items.map(({ id, data }) => (
                      <option key={id} value={id}>
                        {data.title}
                      </option>
                    ))}
                  </NativeSelect.Field>
                  <NativeSelect.Indicator />
                </NativeSelect.Root>
              </FormField>
              {(after.length > 0 || foods.data?.next) && (
                <Flex gap="2">
                  <Button
                    type="button"
                    size="sm"
                    disabled={!after.length}
                    onClick={() => setAfter(after.slice(0, -1))}
                  >
                    Previous foods
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    disabled={!foods.data?.next}
                    onClick={() => {
                      if (foods.data?.next) setAfter([...after, foods.data.next]);
                    }}
                  >
                    More foods
                  </Button>
                </Flex>
              )}
            </Stack>
          )}
          {!entry && source === "inline" && (
            <Stack>
              <SimpleGrid columns={{ base: 1, sm: 2 }} gap="3">
                <FormField>
                  Food name
                  <Input name="title" required maxLength={200} />
                </FormField>
                <FormField>
                  Serving description
                  <Input name="description" required maxLength={200} placeholder="1 bowl" />
                </FormField>
                <FormField>
                  Serving size
                  <Input
                    name="size"
                    required
                    type="number"
                    min={0}
                    max={1000}
                    step={0.001}
                    defaultValue={1}
                  />
                </FormField>
                <FormField>
                  Serving unit
                  <Input name="unit" required maxLength={100} placeholder="bowl" />
                </FormField>
              </SimpleGrid>
              <SimpleGrid columns={{ base: 2, md: 4 }} gap="3">
                {macroFields.map(({ key, label, unit }) => (
                  <FormField key={key}>
                    {label} per serving ({unit})
                    <Input name={"food-" + key} type="number" min={0} max={1000000} step={0.001} />
                  </FormField>
                ))}
              </SimpleGrid>
            </Stack>
          )}
          <SimpleGrid columns={{ base: 1, sm: 3 }} gap="3">
            <FormField>
              Date
              <Input
                type="date"
                name="date"
                defaultValue={entry?.data.date ?? linked?.data.date ?? date}
                min="0001-01-01"
                max="9999-12-31"
                required
              />
            </FormField>
            <FormField>
              Servings
              <Input
                name="quantity"
                required
                type="number"
                min={0}
                max={1000}
                step={0.001}
                defaultValue={entry?.data.quantity ?? linked?.data.quantity ?? 1}
              />
            </FormField>
            {props.kind === "planned" ? (
              <FormField>
                Order
                <Input
                  name="order"
                  required
                  type="number"
                  min={0}
                  max={1000000}
                  defaultValue={props.entry ? (props.entry.data.order ?? 0) : props.order}
                />
              </FormField>
            ) : (
              <FormField>
                Time ({Intl.DateTimeFormat().resolvedOptions().timeZone}, optional)
                <Input
                  type="datetime-local"
                  name="consumedAt"
                  step={1}
                  defaultValue={initialTime}
                />
              </FormField>
            )}
          </SimpleGrid>
          {timeError && <Notice role="alert">{timeError}</Notice>}
          <FormField>
            Meal
            <NativeSelect.Root>
              <NativeSelect.Field value={meal} onChange={(event) => setMeal(event.target.value)}>
                <option value="">No label</option>
                {mealLabels.map((label) => (
                  <option key={label}>{label}</option>
                ))}
                <option value="custom">Custom</option>
              </NativeSelect.Field>
              <NativeSelect.Indicator />
            </NativeSelect.Root>
          </FormField>
          {meal === "custom" && (
            <FormField>
              Custom meal label
              <Input name="custom" defaultValue={initialMeal} required maxLength={100} />
            </FormField>
          )}
          <Heading as="h3" size="sm">
            Macro overrides for the entire entry
          </Heading>
          <SimpleGrid columns={{ base: 2, md: 4 }} gap="3">
            {macroFields.map(({ key, label, unit }) => (
              <Stack key={key} gap="1">
                <FormField>
                  {label} ({unit})
                  <Input
                    name={"entry-" + key}
                    type="number"
                    min={0}
                    max={1000000}
                    step={0.001}
                    defaultValue={entry?.data.overrides?.[key] ?? ""}
                    placeholder="Use estimate"
                  />
                </FormField>
                <FormField display="flex" alignItems="center">
                  <input
                    type="checkbox"
                    name={"unknown-" + key}
                    defaultChecked={entry?.data.overrides?.[key] === null}
                  />
                  Unknown {label.toLowerCase()}
                </FormField>
              </Stack>
            ))}
          </SimpleGrid>
          <FormField>
            Notes
            <Textarea name="notes" defaultValue={entry?.data.notes} maxLength={4000} />
          </FormField>
          <Flex gap="2" wrap="wrap">
            <Button type="submit" colorPalette="teal" loading={pending} disabled={!canSave}>
              Save
            </Button>
            {props.onQueue && !entry && (
              <Button type="submit" value="queue" variant="outline" disabled={pending || !canSave}>
                Add to batch
              </Button>
            )}
            <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
          </Flex>
        </Stack>
      </form>
    </Panel>
  );
};
