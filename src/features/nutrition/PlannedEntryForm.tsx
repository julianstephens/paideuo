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
import { useRef, useState } from "react";
import type { FormEvent } from "react";
import { FormField, Notice, Panel } from "../../components/ui";
import { errorMessage } from "../../lib/api/request";
import { foodQueryKey, foodsApi, macroFields } from "./foods";
import type { Food, FoodFields } from "./foods";
import type { Change, DraftEntry, PlannedEntry, PlannedInput } from "./planned";

const mealLabels = ["Breakfast", "Lunch", "Dinner", "Snack"];

export const PlannedEntryForm = ({
  entry,
  date,
  order,
  ownerId,
  programId,
  timezone,
  canQueue,
  pending,
  onClose,
  onSave,
  onQueue,
}: {
  entry?: PlannedEntry;
  date: string;
  order: number;
  ownerId: string;
  programId?: string;
  timezone?: string;
  canQueue: boolean;
  pending: boolean;
  onClose: () => void;
  onSave: (change: Change) => void;
  onQueue: (draft: DraftEntry, title: string) => void;
}) => {
  const [source, setSource] = useState<"bank" | "inline">("bank");
  const [search, setSearch] = useState("");
  const [after, setAfter] = useState<string[]>([]);
  const [selected, setSelected] = useState<Food>();
  const canSave = !!entry || source === "inline" || !!selected;
  const externalId = useRef<string>(undefined);
  const foods = useQuery({
    queryKey: [...foodQueryKey(ownerId), "planner", search, after.at(-1)],
    queryFn: ({ signal }) =>
      foodsApi.list({ search, category: "", status: "active" }, after.at(-1), signal),
    enabled: !entry && source === "bank",
  });
  const initialMeal = entry?.data.meal ?? "";
  const [meal, setMeal] = useState(
    initialMeal && !mealLabels.includes(initialMeal) ? "custom" : initialMeal,
  );

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
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
      order: Number(field("order")),
      notes: field("notes"),
      overrides,
    };
    if (entry) {
      onSave({ action: "update", id: entry.id, data: { ...data, meal: label || null } });
      return;
    }
    if (source === "bank" && !selected) return;
    const draft: DraftEntry = {
      externalId: (externalId.current ??= crypto.randomUUID()),
      data: {
        ...data,
        ...(label ? { meal: label } : {}),
        ...(programId ? { programId } : {}),
        ...(timezone ? { timezone } : {}),
        source:
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
              },
      },
    };
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const title =
      draft.data.source.kind === "inline"
        ? draft.data.source.food.title
        : (selected?.data.title ?? "");
    if (submitter?.getAttribute("value") === "queue") onQueue(draft, title);
    else onSave({ action: "create", ...draft });
  };

  return (
    <Panel>
      <Heading size="md">
        {entry ? "Edit " + entry.data.snapshot.title : "Add planned food"}
      </Heading>
      <form onSubmit={submit}>
        <Stack gap="4">
          {!entry && (
            <FormField>
              Food source
              <NativeSelect.Root>
                <NativeSelect.Field
                  value={source}
                  onChange={(event) => setSource(event.target.value === "bank" ? "bank" : "inline")}
                >
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
                defaultValue={entry?.data.date ?? date}
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
                defaultValue={entry?.data.quantity ?? 1}
              />
            </FormField>
            <FormField>
              Order
              <Input
                name="order"
                required
                type="number"
                min={0}
                max={1000000}
                defaultValue={entry ? (entry.data.order ?? 0) : order}
              />
            </FormField>
          </SimpleGrid>
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
            Macro overrides for this entry
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
            {canQueue && !entry && (
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
