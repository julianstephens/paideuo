import { Box, Button, Flex, Heading, Link, Stack, Text } from "@chakra-ui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link as RouterLink, useParams } from "react-router";
import { Notice, PageHeader, Panel } from "../../components/ui";
import { errorMessage } from "../../lib/api/request";
import { useSession } from "../auth/session";
import { RecipeForm } from "./RecipeForm";
import { foodQueryKey, foodsApi } from "./foods";
import { recipeQueryKey, recipesApi } from "./recipes";
import type { Recipe, RecipeEntryKind, RecipeMutation } from "./recipes";

export const EntryRecipeLink = ({
  entryKind,
  entryId,
}: {
  entryKind: RecipeEntryKind;
  entryId: string;
}) => (
  <Link asChild variant="underline">
    <RouterLink to={"/nutrition/recipes/" + entryKind + "/" + entryId}>View recipe</RouterLink>
  </Link>
);

const BackToFoodBank = () => (
  <Link alignSelf="start" asChild variant="underline">
    <RouterLink to="/nutrition/foods">Back to food bank</RouterLink>
  </Link>
);

const RecipeView = ({ recipe: { data } }: { recipe: Recipe }) => (
  <Panel>
    {data.portions === undefined && data.ingredients.length === 0 && !data.instructions && (
      <Text color="fg.muted">No preparation details have been added.</Text>
    )}
    {data.portions !== undefined && <Text>Recipe portions: {data.portions}</Text>}
    {data.ingredients.length > 0 && (
      <>
        <Heading size="md">Ingredients</Heading>
        <Box as="ol" paddingStart="5">
          {data.ingredients.map((item, index) => (
            <Box as="li" key={index} py="1">
              {item.name}
              {item.quantity !== undefined && " · " + item.quantity}
              {item.unit && " " + item.unit}
              {item.prep && " · " + item.prep}
            </Box>
          ))}
        </Box>
      </>
    )}
    {data.instructions && (
      <>
        <Heading size="md">Cooking instructions</Heading>
        <Text whiteSpace="pre-wrap">{data.instructions}</Text>
      </>
    )}
  </Panel>
);

export const FoodRecipePage = () => {
  const { foodId } = useParams();
  const session = useSession();
  return session.status === "signed-in" && foodId ? (
    <FoodRecipe key={session.ownerId + ":" + foodId} ownerId={session.ownerId} foodId={foodId} />
  ) : null;
};

const FoodRecipe = ({ ownerId, foodId }: { ownerId: string; foodId: string }) => {
  const [mode, setMode] = useState<"view" | "edit" | "remove">("view");
  const queryClient = useQueryClient();
  const food = useQuery({
    queryKey: [...foodQueryKey(ownerId), "detail", foodId],
    queryFn: ({ signal }) => foodsApi.get(foodId, signal),
    retry: false,
  });
  const recipe = useQuery({
    queryKey: [...recipeQueryKey(ownerId), "food", foodId],
    queryFn: ({ signal }) => recipesApi.forFood(foodId, signal),
    retry: false,
  });
  const mutation = useMutation({
    mutationFn: recipesApi.mutate,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: recipeQueryKey(ownerId) });
      setMode("view");
    },
  });
  const changeMode = (next: typeof mode) => {
    mutation.reset();
    setMode(next);
  };
  const save = (change: RecipeMutation["change"]) => {
    const previous = mutation.variables;
    if (
      mutation.isError &&
      previous &&
      JSON.stringify(previous.change) === JSON.stringify(change)
    ) {
      mutation.mutate(previous);
      return;
    }
    mutation.mutate({
      change,
      operationId: crypto.randomUUID(),
      externalId: change.action === "create" ? crypto.randomUUID() : undefined,
    });
  };
  const failure = mutation.isError
    ? errorMessage(mutation.error, "Unable to save the recipe change.")
    : undefined;

  return (
    <Stack gap="4">
      <BackToFoodBank />
      <PageHeader title={food.data ? food.data.data.title + " recipe" : "Recipe"} />
      {(food.isPending || recipe.isPending) && <Notice role="status">Loading recipe…</Notice>}
      {(food.isError || recipe.isError) && (
        <Notice role="alert">
          {errorMessage(food.error ?? recipe.error, "Unable to load the recipe.")}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              if (food.isError) void food.refetch();
              if (recipe.isError) void recipe.refetch();
            }}
          >
            Retry
          </Button>
        </Notice>
      )}
      {food.isSuccess && recipe.isSuccess && (
        <>
          {mode === "edit" && (
            <RecipeForm
              recipe={recipe.data?.data}
              pending={mutation.isPending}
              error={failure}
              close={() => changeMode("view")}
              save={(data) =>
                save(
                  recipe.data
                    ? { action: "update", id: recipe.data.id, data }
                    : { action: "create", foodId, data },
                )
              }
            />
          )}
          {mode !== "edit" &&
            (recipe.data ? (
              <RecipeView recipe={recipe.data} />
            ) : (
              <Notice role="status">This food has no recipe.</Notice>
            ))}
          {mode === "view" && (
            <Flex gap="2" wrap="wrap">
              <Button onClick={() => changeMode("edit")}>
                {recipe.data ? "Edit recipe" : "Add recipe"}
              </Button>
              {recipe.data && (
                <Button variant="outline" onClick={() => changeMode("remove")}>
                  Remove recipe
                </Button>
              )}
            </Flex>
          )}
          {mode === "remove" && recipe.data && (
            <Panel align="start">
              <Text>Remove the recipe from {food.data.data.title}?</Text>
              {failure && <Notice role="alert">{failure}</Notice>}
              <Flex gap="2">
                <Button
                  colorPalette="red"
                  loading={mutation.isPending}
                  onClick={() => {
                    if (recipe.data) save({ action: "delete", id: recipe.data.id });
                  }}
                >
                  Confirm removal
                </Button>
                <Button
                  variant="outline"
                  disabled={mutation.isPending}
                  onClick={() => changeMode("view")}
                >
                  Cancel
                </Button>
              </Flex>
            </Panel>
          )}
        </>
      )}
    </Stack>
  );
};

export const EntryRecipePage = () => {
  const { entryKind, entryId } = useParams();
  const session = useSession();
  if (session.status !== "signed-in" || !entryId) return null;
  if (entryKind !== "planned" && entryKind !== "consumed")
    return <Notice role="alert">Food entry not found.</Notice>;
  return <EntryRecipe ownerId={session.ownerId} entryKind={entryKind} entryId={entryId} />;
};

const EntryRecipe = ({
  ownerId,
  entryKind,
  entryId,
}: {
  ownerId: string;
  entryKind: RecipeEntryKind;
  entryId: string;
}) => {
  const recipe = useQuery({
    queryKey: [...recipeQueryKey(ownerId), entryKind, entryId],
    queryFn: ({ signal }) => recipesApi.forEntry(entryKind, entryId, signal),
    retry: false,
  });
  return (
    <Stack gap="4">
      <BackToFoodBank />
      <PageHeader title="Recipe" />
      {recipe.isPending && <Notice role="status">Loading recipe…</Notice>}
      {recipe.isError && (
        <Notice role="alert">
          {errorMessage(recipe.error, "Unable to load the recipe.")}
          <Button variant="ghost" size="sm" onClick={() => void recipe.refetch()}>
            Retry
          </Button>
        </Notice>
      )}
      {recipe.data && <RecipeView recipe={recipe.data} />}
      {recipe.data === null && <Notice role="status">This food entry has no recipe.</Notice>}
    </Stack>
  );
};
