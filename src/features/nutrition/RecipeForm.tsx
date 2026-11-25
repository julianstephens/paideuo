import { Button, Flex, Heading, Input, SimpleGrid, Stack, Textarea } from "@chakra-ui/react";
import { useState } from "react";
import type { SubmitEvent } from "react";
import { FormField, Notice, Panel } from "../../components/ui";
import type { Ingredient, RecipeFields } from "./recipes";

type IngredientDraft = { key: string; name: string; quantity: string; unit: string; prep: string };
const draft = (item?: Ingredient): IngredientDraft => ({
  key: crypto.randomUUID(),
  name: item?.name ?? "",
  quantity: item?.quantity?.toString() ?? "",
  unit: item?.unit ?? "",
  prep: item?.prep ?? "",
});

export const RecipeForm = ({
  recipe,
  pending,
  error,
  close,
  save,
}: {
  recipe: RecipeFields | undefined;
  pending: boolean;
  error: string | undefined;
  close: () => void;
  save: (data: RecipeFields) => void;
}) => {
  const [rows, setRows] = useState(() => recipe?.ingredients.map(draft) ?? [draft()]);
  const [validation, setValidation] = useState("");
  const edit = (key: string, change: Partial<IngredientDraft>) => {
    setValidation("");
    setRows((old) => old.map((row) => (row.key === key ? { ...row, ...change } : row)));
  };
  const move = (index: number, target: number) => {
    setRows((old) => {
      const next = [...old];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };
  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    const invalid = rows.findIndex(
      (row) => !row.name.trim() || (row.quantity === "") !== (row.unit.trim() === ""),
    );
    if (invalid !== -1) {
      setValidation(
        "Ingredient " + (invalid + 1) + " needs a name. Enter quantity and unit together.",
      );
      return;
    }
    const form = new FormData(event.currentTarget);
    const instructions = String(form.get("instructions") ?? "").trim();
    const portions = String(form.get("portions") ?? "");
    const ingredients = rows.map(({ name, quantity, unit, prep }): Ingredient => ({
      name: name.trim(),
      ...(quantity === "" ? {} : { quantity: Number(quantity), unit: unit.trim() }),
      ...(prep.trim() ? { prep: prep.trim() } : {}),
    }));
    save({
      ingredients,
      ...(instructions ? { instructions } : {}),
      ...(portions === "" ? {} : { portions: Number(portions) }),
    });
  };

  return (
    <Panel>
      <Heading size="lg">{recipe ? "Edit recipe" : "Add recipe"}</Heading>
      <form onSubmit={submit}>
        <Stack gap="4">
          {rows.map((row, index) => (
            <Stack as="fieldset" key={row.key} borderWidth="1px" borderRadius="md" p="3" gap="3">
              <legend>Ingredient {index + 1}</legend>
              <SimpleGrid columns={{ base: 1, md: 2 }} gap="3">
                <FormField>
                  Name
                  <Input
                    value={row.name}
                    required
                    maxLength={200}
                    disabled={pending}
                    onChange={(event) => edit(row.key, { name: event.target.value })}
                  />
                </FormField>
                <FormField>
                  Quantity
                  <Input
                    type="number"
                    min={0}
                    max={1000}
                    step="0.001"
                    value={row.quantity}
                    disabled={pending}
                    onChange={(event) => edit(row.key, { quantity: event.target.value })}
                  />
                </FormField>
                <FormField>
                  Unit
                  <Input
                    value={row.unit}
                    maxLength={100}
                    disabled={pending}
                    onChange={(event) => edit(row.key, { unit: event.target.value })}
                  />
                </FormField>
                <FormField>
                  Prep detail
                  <Input
                    value={row.prep}
                    maxLength={500}
                    disabled={pending}
                    onChange={(event) => edit(row.key, { prep: event.target.value })}
                  />
                </FormField>
              </SimpleGrid>
              <Flex gap="2" wrap="wrap">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={pending || index === 0}
                  aria-label={"Move ingredient " + (index + 1) + " up"}
                  onClick={() => move(index, index - 1)}
                >
                  Move up
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={pending || index === rows.length - 1}
                  aria-label={"Move ingredient " + (index + 1) + " down"}
                  onClick={() => move(index, index + 1)}
                >
                  Move down
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={pending}
                  aria-label={"Remove ingredient " + (index + 1)}
                  onClick={() => setRows((old) => old.filter(({ key }) => key !== row.key))}
                >
                  Remove
                </Button>
              </Flex>
            </Stack>
          ))}
          <Button
            type="button"
            variant="outline"
            alignSelf="start"
            disabled={pending || rows.length === 100}
            onClick={() => setRows((old) => [...old, draft()])}
          >
            Add ingredient
          </Button>
          <FormField>
            Cooking instructions
            <Textarea
              name="instructions"
              rows={5}
              maxLength={4000}
              defaultValue={recipe?.instructions}
              disabled={pending}
            />
          </FormField>
          <FormField maxW="48">
            Recipe portions
            <Input
              name="portions"
              type="number"
              min={0}
              max={1000}
              step="0.001"
              defaultValue={recipe?.portions}
              disabled={pending}
            />
          </FormField>
          {(validation || error) && <Notice role="alert">{validation || error}</Notice>}
          <Flex gap="2">
            <Button type="submit" loading={pending}>
              Save recipe
            </Button>
            <Button type="button" variant="outline" disabled={pending} onClick={close}>
              Cancel
            </Button>
          </Flex>
        </Stack>
      </form>
    </Panel>
  );
};
