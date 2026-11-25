import { Button, Flex, Heading, Input, Stack, Text } from "@chakra-ui/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { SubmitEvent } from "react";
import { FormField, Notice, Panel } from "../../components/ui";
import { errorMessage } from "../../lib/api/request";
import {
  changeFoodCategory,
  foodCategoriesKey,
  useFoodCategories,
} from "../nutrition/foodCategories";
import { foodQueryKey } from "../nutrition/foods";
import { nutritionOperation } from "../nutrition/operation";
import type { CategoryChange } from "../nutrition/foodCategories";

export const FoodCategorySettings = ({ ownerId }: { ownerId: string }) => {
  const query = useFoodCategories(ownerId);
  const client = useQueryClient();
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState("");
  const save = useMutation({
    mutationFn: changeFoodCategory,
    onSuccess: async (result) => {
      client.setQueryData(foodCategoriesKey(ownerId), result);
      setName("");
      setEditing(null);
      await client.invalidateQueries({ queryKey: foodQueryKey(ownerId) });
    },
  });
  const edit = (category: string | null) => {
    save.reset();
    setEditing(category);
    setName(category ?? "");
  };
  const changeCategory = (change: CategoryChange) =>
    save.mutate(nutritionOperation(change, save.isError ? save.variables : undefined));
  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!name.trim() || save.isPending) return;
    changeCategory(
      editing === null
        ? { action: "add", newName: name }
        : { action: "rename", name: editing, newName: name },
    );
  };

  return (
    <Panel as="section">
      <Heading as="h2" size="md">
        Food categories
      </Heading>
      <Text color="fg.muted" fontSize="sm">
        Renaming a category updates the foods assigned to it. Removing a category hides it from new
        food selections.
      </Text>
      {query.isPending && <Notice role="status">Loading food categories…</Notice>}
      {query.isError && (
        <Notice role="alert">
          {errorMessage(query.error, "Unable to load food categories.")}
          <Button size="sm" variant="ghost" onClick={() => void query.refetch()}>
            Retry
          </Button>
        </Notice>
      )}
      {query.data && (
        <>
          <Stack gap="1">
            {query.data.categories.map((category) => (
              <Flex key={category} gap="2" align="center" wrap="wrap">
                <Text minW="28" flex="1">
                  {category}
                </Text>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={save.isPending}
                  aria-label={"Rename " + category}
                  onClick={() => edit(category)}
                >
                  Rename
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={save.isPending}
                  aria-label={"Remove " + category}
                  onClick={() => changeCategory({ action: "remove", name: category })}
                >
                  Remove
                </Button>
              </Flex>
            ))}
          </Stack>
          <form onSubmit={submit}>
            <Flex gap="2" align="end" wrap="wrap">
              <FormField flex="1" minW="40">
                {editing === null ? "New category" : "Rename " + editing}
                <Input
                  value={name}
                  maxLength={100}
                  required
                  disabled={save.isPending}
                  onChange={(event) => setName(event.target.value)}
                />
              </FormField>
              <Button
                type="submit"
                disabled={!name.trim() || name.trim() === editing}
                loading={save.isPending}
              >
                {editing === null ? "Add category" : "Save name"}
              </Button>
              {editing !== null && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={save.isPending}
                  onClick={() => edit(null)}
                >
                  Cancel
                </Button>
              )}
            </Flex>
          </form>
        </>
      )}
      {save.isError && (
        <Notice role="alert">
          {errorMessage(save.error, "Unable to save the category change.")}
        </Notice>
      )}
    </Panel>
  );
};
