import {
  Badge,
  Button,
  Flex,
  Heading,
  Input,
  NativeSelect,
  SimpleGrid,
  Stack,
  Text,
} from "@chakra-ui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { FormField, Notice, PageHeader, Panel } from "../../components/ui";
import { errorMessage } from "../../lib/api/request";
import { useSession } from "../auth/session";
import { FoodForm } from "./FoodForm";
import { foodQueryKey, foodsApi, macroFields } from "./foods";
import type { Food, FoodChange, FoodFilters } from "./foods";
import type { ComponentProps } from "react";

export const FoodBankPage = () => {
  const session = useSession();
  return session.status === "signed-in" ? (
    <FoodBank key={session.ownerId} ownerId={session.ownerId} />
  ) : null;
};

const FoodBank = ({ ownerId }: { ownerId: string }) => {
  const [editor, setEditor] = useState<ComponentProps<typeof FoodForm>["editor"]>();
  const [filters, setFilters] = useState<FoodFilters>({
    search: "",
    category: "",
    status: "active",
  });
  const [pages, setPages] = useState<string[]>([]);
  const after = pages.at(-1);
  const queryClient = useQueryClient();
  const queryKey = foodQueryKey(ownerId);
  const foods = useQuery({
    queryKey: [...queryKey, filters, after],
    queryFn: ({ signal }) => foodsApi.list(filters, after, signal),
  });
  const mutation = useMutation({
    mutationFn: foodsApi.mutate,
    onSuccess: async () => {
      setEditor(undefined);
      setPages([]);
      await queryClient.invalidateQueries({ queryKey });
    },
  });
  const save = (change: FoodChange) => {
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
      externalId:
        change.action === "create" || change.action === "duplicate"
          ? crypto.randomUUID()
          : undefined,
    });
  };
  const filter = (values: Partial<FoodFilters>) => {
    setFilters({ ...filters, ...values });
    setPages([]);
  };
  const startEdit = (next: typeof editor) => {
    mutation.reset();
    setEditor(next);
  };
  const failure = mutation.isError
    ? errorMessage(mutation.error, "Unable to save the food change. Try again.")
    : undefined;
  const locked = Boolean(editor) || mutation.isPending;

  return (
    <Stack gap="4">
      <PageHeader
        title="Food bank"
        action={
          <Button disabled={locked} onClick={() => startEdit({ action: "create" })}>
            Add food
          </Button>
        }
      />
      {editor && (
        <FoodForm
          editor={editor}
          pending={mutation.isPending}
          error={failure}
          close={() => startEdit(undefined)}
          save={save}
        />
      )}
      {!editor && failure && <Notice role="alert">{failure}</Notice>}
      <SimpleGrid columns={{ base: 1, md: 3 }} gap="3">
        <FormField>
          Search foods
          <Input
            type="search"
            maxLength={200}
            value={filters.search}
            onChange={(event) => filter({ search: event.target.value })}
          />
        </FormField>
        <FormField>
          Category
          <Input
            maxLength={100}
            value={filters.category}
            onChange={(event) => filter({ category: event.target.value })}
          />
        </FormField>
        <FormField>
          Status
          <NativeSelect.Root>
            <NativeSelect.Field
              value={filters.status}
              onChange={(event) => filter({ status: event.target.value as FoodFilters["status"] })}
            >
              <option value="active">Active</option>
              <option value="archived">Archived</option>
              <option value="all">All foods</option>
            </NativeSelect.Field>
            <NativeSelect.Indicator />
          </NativeSelect.Root>
        </FormField>
      </SimpleGrid>
      {foods.isPending && <Notice role="status">Loading foods…</Notice>}
      {foods.isError && (
        <Notice role="alert">
          {errorMessage(foods.error, "Unable to load the food bank.")}
          <Button variant="ghost" size="sm" onClick={() => void foods.refetch()}>
            Retry
          </Button>
        </Notice>
      )}
      {foods.data?.items.length === 0 && (
        <Notice role="status">No foods match these filters.</Notice>
      )}
      <SimpleGrid columns={{ base: 1, xl: 2 }} gap="3">
        {foods.data?.items.map((food) => (
          <FoodCard
            key={food.id}
            food={food}
            locked={locked}
            edit={() => startEdit({ action: "update", food })}
            duplicate={() => startEdit({ action: "duplicate", food })}
            archive={() =>
              save({ action: "set_archive", id: food.id, archived: !food.data.archived })
            }
          />
        ))}
      </SimpleGrid>
      {(pages.length > 0 || foods.data?.next) && (
        <Flex gap="2">
          <Button
            variant="outline"
            disabled={pages.length === 0}
            onClick={() => setPages(pages.slice(0, -1))}
          >
            Previous
          </Button>
          <Button
            variant="outline"
            disabled={!foods.data?.next}
            onClick={() => {
              const next = foods.data?.next;
              if (next) setPages([...pages, next]);
            }}
          >
            Next
          </Button>
        </Flex>
      )}
    </Stack>
  );
};

const FoodCard = ({
  food: { data },
  locked,
  edit,
  duplicate,
  archive,
}: {
  food: Food;
  locked: boolean;
  edit: () => void;
  duplicate: () => void;
  archive: () => void;
}) => {
  const estimates = macroFields.flatMap(({ key, label, unit }) =>
    data.macros[key] === undefined ? [] : [label + " " + data.macros[key] + " " + unit],
  );
  return (
    <Panel>
      <Flex align="start" justify="space-between" wrap="wrap" gap="2">
        <Heading size="md">{data.title}</Heading>
        {data.archived && <Badge>Archived</Badge>}
      </Flex>
      <Text color="fg.muted">
        {data.serving.description} · {data.serving.size} {data.serving.unit}
        {data.category && " · " + data.category}
      </Text>
      {data.description && <Text>{data.description}</Text>}
      <Text>{estimates.length ? estimates.join(" · ") : "No macro estimates"}</Text>
      {data.notes && <Text color="fg.muted">{data.notes}</Text>}
      <Flex gap="2" wrap="wrap" mt="auto">
        <Button variant="outline" size="sm" disabled={locked} onClick={edit}>
          Edit
        </Button>
        <Button variant="outline" size="sm" disabled={locked} onClick={duplicate}>
          Duplicate
        </Button>
        <Button variant="ghost" size="sm" disabled={locked} onClick={archive}>
          {data.archived ? "Restore" : "Archive"}
        </Button>
      </Flex>
    </Panel>
  );
};
