import {
  Button,
  Flex,
  Heading,
  IconButton,
  Input,
  NativeSelect,
  SimpleGrid,
  Stack,
  Text,
  Textarea,
} from "@chakra-ui/react";
import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { errorMessage } from "../../lib/api/request";
import { useOpenAIStatus } from "../settings/openai";
import { FieldHelp } from "../../components/FieldHelp";
import { FormField, Notice, Panel } from "../../components/ui";
import { foodsApi, macroFields } from "./foods";
import type { Food, FoodChange, FoodPredictionInput, MacroEstimate } from "./foods";

const foodFieldHelp = {
  title: ["Title", "The name shown in your food bank and when you plan or log this food."],
  category: [
    "Category",
    "Group foods for filtering in the food bank. Manage the choices in Settings under Food categories.",
  ],
  servingDescription: [
    "Serving description",
    "A short label for one serving, such as “one small bowl” or “two slices”.",
  ],
  size: [
    "Serving size",
    "The amount in one serving. For example, enter 150 here and g as the serving unit for a 150 g serving.",
  ],
  unit: ["Serving unit", "The unit for the serving size, such as g, mL, cup, or slice."],
  description: [
    "Description",
    "Optional details such as ingredients, brand, or preparation can improve macro estimates.",
  ],
} as const;

type HelpField = keyof typeof foodFieldHelp;

const FoodFieldLabel = ({ field, id }: { field: HelpField; id: string }) => {
  const [label, description] = foodFieldHelp[field];
  return (
    <Flex align="center" gap="1">
      <label htmlFor={id}>{label}</label>
      <FieldHelp label={label} description={description} id={id + "-help"} />
    </Flex>
  );
};

type Editor = { action: "create" } | { action: "update" | "duplicate"; food: Food };

const requiredPredictionFields: HelpField[] = [
  "title",
  "category",
  "servingDescription",
  "size",
  "unit",
];

const readPredictionInput = (
  form: HTMLFormElement,
): { input: FoodPredictionInput } | { hint: string } => {
  const fields = new FormData(form);
  const value = (name: string) => String(fields.get(name) ?? "").trim();
  const missing = requiredPredictionFields.filter((name) => !value(name));
  if (missing.length) {
    return {
      hint:
        "Required for prediction: " +
        missing.map((name) => foodFieldHelp[name][0]).join(", ") +
        ".",
    };
  }
  const servingSize = Number(value("size"));
  if (!(servingSize > 0 && servingSize <= 1000) || Number(servingSize.toFixed(3)) !== servingSize) {
    return {
      hint: "For prediction, enter a serving size greater than 0 and up to 1000, with at most three decimal places.",
    };
  }
  return {
    input: {
      title: value("title"),
      category: value("category"),
      servingDescription: value("servingDescription"),
      servingSize,
      servingUnit: value("unit"),
      description: value("description") || undefined,
    },
  };
};

export const FoodForm = ({
  ownerId,
  editor,
  categories,
  pending,
  error,
  close,
  save,
}: {
  ownerId: string;
  editor: Editor;
  categories: string[];
  pending: boolean;
  error: string | undefined;
  close: () => void;
  save: (change: FoodChange) => void;
}) => {
  const prefix = useId();
  const control = (field: HelpField) => ({
    id: prefix + "-" + field,
    "aria-describedby": prefix + "-" + field + "-help",
  });
  const data = editor.action === "create" ? undefined : editor.food.data;
  const duplicate = editor.action === "duplicate";
  const title = duplicate ? data?.title.slice(0, 195) + " copy" : data?.title;
  const status = useOpenAIStatus(ownerId, !duplicate);
  const formRef = useRef<HTMLFormElement>(null);
  const request = useRef<AbortController | null>(null);
  const hintId = useId();
  const [inputHint, setInputHint] = useState("Checking food fields…");
  const [predicting, setPredicting] = useState(false);
  const [estimate, setEstimate] = useState<MacroEstimate>();
  const [predictionError, setPredictionError] = useState("");

  useEffect(() => {
    if (formRef.current) {
      const result = readPredictionInput(formRef.current);
      setInputHint("hint" in result ? result.hint : "");
    }
    return () => request.current?.abort();
  }, []);

  const predictionChanged = (event: FormEvent<HTMLFormElement>) => {
    if (!(event.target instanceof HTMLElement)) return;
    const field = event.target.getAttribute("name");
    if (field !== "description" && !requiredPredictionFields.some((name) => name === field)) return;
    request.current?.abort();
    request.current = null;
    setPredicting(false);
    setEstimate(undefined);
    setPredictionError("");
    const result = readPredictionInput(event.currentTarget);
    setInputHint("hint" in result ? result.hint : "");
  };

  const predict = async () => {
    if (
      !formRef.current ||
      request.current ||
      pending ||
      !status.data?.available ||
      !status.data.configured
    )
      return;
    const result = readPredictionInput(formRef.current);
    if ("hint" in result) {
      setInputHint(result.hint);
      return;
    }
    const controller = new AbortController();
    request.current = controller;
    setPredicting(true);
    setEstimate(undefined);
    setPredictionError("");
    try {
      const { macros } = await foodsApi.predictMacros(result.input, controller.signal);
      if (!controller.signal.aborted) setEstimate(macros);
    } catch (cause) {
      if (!controller.signal.aborted) {
        setPredictionError(errorMessage(cause, "Unable to predict macros. Try again."));
      }
    } finally {
      if (request.current === controller && !controller.signal.aborted) {
        request.current = null;
        setPredicting(false);
      }
    }
  };

  const applyEstimate = () => {
    if (!estimate || pending) return;
    for (const { key } of macroFields) {
      const input = formRef.current?.elements.namedItem(key);
      if (input instanceof HTMLInputElement) input.value = String(estimate[key]);
    }
    setEstimate(undefined);
  };

  let predictionHint = "";
  if (status.isPending) predictionHint = "Checking OpenAI settings…";
  else if (status.isError) predictionHint = "Unable to check OpenAI settings.";
  else if (!status.data?.available) predictionHint = "OpenAI is unavailable on this server.";
  else if (!status.data.configured)
    predictionHint = "Add an OpenAI API key in Settings to predict macros.";
  else predictionHint = inputHint;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    const form = new FormData(event.currentTarget);
    const value = (name: string) => String(form.get(name) ?? "").trim();
    if (editor.action === "duplicate") {
      save({ action: "duplicate", id: editor.food.id, title: value("title") });
      return;
    }
    const fields = {
      title: value("title"),
      description: value("description"),
      category: value("category"),
      notes: value("notes"),
      serving: {
        description: value("servingDescription"),
        size: Number(value("size")),
        unit: value("unit"),
      },
      macros: Object.fromEntries(
        macroFields
          .filter(({ key }) => value(key) !== "")
          .map(({ key }) => [key, Number(value(key))]),
      ),
    };
    save(
      editor.action === "create"
        ? { action: "create", data: fields }
        : { action: "update", id: editor.food.id, data: fields },
    );
  };

  return (
    <Panel>
      <Heading size="lg">{duplicate ? "Duplicate food" : data ? "Edit food" : "Add food"}</Heading>
      <form ref={formRef} onSubmit={submit} onChange={predictionChanged}>
        <Stack gap="4">
          <FormField as="div">
            <FoodFieldLabel field="title" id={control("title").id} />
            <Input
              autoFocus
              {...control("title")}
              name="title"
              maxLength={200}
              required
              defaultValue={title}
              disabled={pending}
            />
          </FormField>
          {!duplicate && (
            <>
              <SimpleGrid columns={{ base: 1, md: 2 }} gap="4">
                <FormField as="div">
                  <FoodFieldLabel field="category" id={control("category").id} />
                  <NativeSelect.Root disabled={pending}>
                    <NativeSelect.Field
                      {...control("category")}
                      name="category"
                      defaultValue={data?.category ?? ""}
                    >
                      <option value="">No category</option>
                      {data?.category && !categories.includes(data.category) && (
                        <option value={data.category}>{data.category} (previously assigned)</option>
                      )}
                      {categories.map((category) => (
                        <option key={category} value={category}>
                          {category}
                        </option>
                      ))}
                    </NativeSelect.Field>
                    <NativeSelect.Indicator />
                  </NativeSelect.Root>
                </FormField>
                <FormField as="div">
                  <FoodFieldLabel
                    field="servingDescription"
                    id={control("servingDescription").id}
                  />
                  <Input
                    {...control("servingDescription")}
                    name="servingDescription"
                    maxLength={200}
                    required
                    defaultValue={data?.serving.description}
                    disabled={pending}
                  />
                </FormField>
                <FormField as="div">
                  <FoodFieldLabel field="size" id={control("size").id} />
                  <Input
                    {...control("size")}
                    name="size"
                    type="number"
                    min={0}
                    max={1000}
                    step="0.001"
                    required
                    defaultValue={data?.serving.size}
                    disabled={pending}
                  />
                </FormField>
                <FormField as="div">
                  <FoodFieldLabel field="unit" id={control("unit").id} />
                  <Input
                    {...control("unit")}
                    name="unit"
                    maxLength={100}
                    required
                    defaultValue={data?.serving.unit}
                    disabled={pending}
                  />
                </FormField>
              </SimpleGrid>
              <FormField as="div">
                <FoodFieldLabel field="description" id={control("description").id} />
                <Textarea
                  {...control("description")}
                  name="description"
                  maxLength={4000}
                  defaultValue={data?.description}
                  disabled={pending}
                />
              </FormField>
              <Stack gap="2">
                <Flex align="center" gap="2">
                  <Heading size="sm">Macros per serving</Heading>
                  <IconButton
                    type="button"
                    aria-label="Predict macros"
                    aria-describedby={predictionHint ? hintId : undefined}
                    title="Predict macros"
                    size="sm"
                    variant="ghost"
                    loading={predicting}
                    disabled={pending || predicting || Boolean(predictionHint)}
                    onClick={() => void predict()}
                  >
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      aria-hidden="true"
                    >
                      <path d="m12 2 2.4 7.6L22 12l-7.6 2.4L12 22l-2.4-7.6L2 12l7.6-2.4L12 2Z" />
                    </svg>
                  </IconButton>
                </Flex>
                {predictionHint && (
                  <Text id={hintId} fontSize="sm" color="fg.muted">
                    {predictionHint}
                  </Text>
                )}
                {predicting && (
                  <Text role="status" fontSize="sm">
                    Predicting macros…
                  </Text>
                )}
                {predictionError && <Notice role="alert">{predictionError}</Notice>}
                {estimate && (
                  <Stack gap="2">
                    <Text role="status" fontSize="sm">
                      OpenAI estimate per serving
                    </Text>
                    <Flex gap="3" wrap="wrap">
                      {macroFields.map(({ key, label, unit }) => (
                        <Text key={key} fontSize="sm">
                          {label} {estimate[key]} {unit}
                        </Text>
                      ))}
                    </Flex>
                    <Flex gap="2">
                      <Button type="button" size="sm" disabled={pending} onClick={applyEstimate}>
                        Apply estimate
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => setEstimate(undefined)}
                      >
                        Dismiss
                      </Button>
                    </Flex>
                  </Stack>
                )}
              </Stack>
              <SimpleGrid columns={{ base: 2, md: 4 }} gap="4">
                {macroFields.map(({ key, label, unit }) => (
                  <FormField key={key}>
                    {label} ({unit})
                    <Input
                      name={key}
                      type="number"
                      min={0}
                      max={1000000}
                      step="0.001"
                      defaultValue={data?.macros[key]}
                      disabled={pending}
                    />
                  </FormField>
                ))}
              </SimpleGrid>
              <FormField>
                Notes
                <Textarea
                  name="notes"
                  maxLength={4000}
                  defaultValue={data?.notes}
                  disabled={pending}
                />
              </FormField>
            </>
          )}
          {error && <Notice role="alert">{error}</Notice>}
          <Flex gap="2">
            <Button type="submit" loading={pending}>
              {duplicate ? "Duplicate food" : "Save food"}
            </Button>
            <Button variant="outline" disabled={pending} onClick={close}>
              Cancel
            </Button>
          </Flex>
        </Stack>
      </form>
    </Panel>
  );
};
