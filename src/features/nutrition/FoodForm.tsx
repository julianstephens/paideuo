import { Button, Flex, Heading, Input, SimpleGrid, Stack, Textarea } from "@chakra-ui/react";
import type { FormEvent } from "react";
import { FormField, Notice, Panel } from "../../components/ui";
import { macroFields } from "./foods";
import type { Food, FoodChange } from "./foods";

type Editor = { action: "create" } | { action: "update" | "duplicate"; food: Food };

export const FoodForm = ({
  editor,
  pending,
  error,
  close,
  save,
}: {
  editor: Editor;
  pending: boolean;
  error: string | undefined;
  close: () => void;
  save: (change: FoodChange) => void;
}) => {
  const data = editor.action === "create" ? undefined : editor.food.data;
  const duplicate = editor.action === "duplicate";
  const title = duplicate ? data?.title.slice(0, 195) + " copy" : data?.title;
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
      <form onSubmit={submit}>
        <Stack gap="4">
          <FormField>
            Title
            <Input
              autoFocus
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
                <FormField>
                  Category
                  <Input
                    name="category"
                    maxLength={100}
                    defaultValue={data?.category}
                    disabled={pending}
                  />
                </FormField>
                <FormField>
                  Serving description
                  <Input
                    name="servingDescription"
                    maxLength={200}
                    required
                    defaultValue={data?.serving.description}
                    disabled={pending}
                  />
                </FormField>
                <FormField>
                  Serving size
                  <Input
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
                <FormField>
                  Serving unit
                  <Input
                    name="unit"
                    maxLength={100}
                    required
                    defaultValue={data?.serving.unit}
                    disabled={pending}
                  />
                </FormField>
              </SimpleGrid>
              <FormField>
                Description
                <Textarea
                  name="description"
                  maxLength={4000}
                  defaultValue={data?.description}
                  disabled={pending}
                />
              </FormField>
              <Heading size="sm">Macros per serving</Heading>
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
