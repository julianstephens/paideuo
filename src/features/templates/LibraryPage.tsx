import { Button, Flex, Heading, Input, Stack, Text } from "@chakra-ui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { FormField, Notice, PageHeader, Panel } from "../../components/ui";
import { errorMessage } from "../../lib/api/request";
import { useSession } from "../auth/session";
import { TemplateForm } from "./TemplateForm";
import { templateKey, templatesApi } from "./templates";
import type { SessionTemplate, TemplateFields } from "./templates";

export const LibraryPage = () => {
  const session = useSession();
  return session.status === "signed-in" ? (
    <Library key={session.ownerId} ownerId={session.ownerId} />
  ) : null;
};

type Command =
  | { action: "save"; fields: TemplateFields; template?: SessionTemplate }
  | { action: "duplicate" | "remove"; id: string };

const Library = ({ ownerId }: { ownerId: string }) => {
  const [search, setSearch] = useState("");
  const [editor, setEditor] = useState<{ template?: SessionTemplate }>();
  const [removing, setRemoving] = useState<SessionTemplate>();
  const queryClient = useQueryClient();
  const queryKey = templateKey(ownerId);
  const templates = useQuery({
    queryKey,
    queryFn: ({ signal }) => templatesApi.list(signal),
    retry: false,
  });
  const change = useMutation({
    mutationFn: (command: Command) => {
      if (command.action === "save") {
        return command.template
          ? templatesApi.update(command.template, command.fields)
          : templatesApi.create(command.fields);
      }
      return command.action === "duplicate"
        ? templatesApi.duplicate(command.id)
        : templatesApi.remove(command.id);
    },
    onError: (_error, command) => {
      if (command.action === "save" && command.template) {
        void queryClient.invalidateQueries({ queryKey });
      }
    },
    onSuccess: async (_result, command) => {
      await queryClient.invalidateQueries({ queryKey });
      if (command.action === "save") setEditor(undefined);
      if (command.action === "remove") setRemoving(undefined);
    },
  });
  const visible = templates.data?.filter(({ name }) =>
    name.toLowerCase().includes(search.trim().toLowerCase()),
  );
  const locked = change.isPending || editor !== undefined || removing !== undefined;
  const failure = change.isError
    ? errorMessage(change.error, "Unable to save the template change. Try again.")
    : undefined;
  const open = (template?: SessionTemplate) => {
    change.reset();
    setEditor({ template });
  };

  return (
    <Stack gap="5">
      <PageHeader
        title="Library"
        action={
          <Button onClick={() => open()} disabled={locked}>
            New template
          </Button>
        }
      />
      {editor && (
        <TemplateForm
          key={editor.template?.id ?? "new"}
          template={editor.template}
          pending={change.isPending}
          error={failure}
          onSave={(fields) => change.mutate({ action: "save", fields, template: editor.template })}
          onCancel={() => {
            change.reset();
            setEditor(undefined);
          }}
        />
      )}
      <FormField maxW="sm">
        Search templates
        <Input type="search" value={search} onChange={(event) => setSearch(event.target.value)} />
      </FormField>
      {templates.isPending && <Notice role="status">Loading templates…</Notice>}
      {templates.isError && (
        <Stack align="start">
          <Notice role="alert">{errorMessage(templates.error, "Unable to load templates.")}</Notice>
          <Button onClick={() => void templates.refetch()}>Retry</Button>
        </Stack>
      )}
      {removing && (
        <Panel role="group" aria-label="Confirm template deletion" bg="orange.subtle">
          <Text>
            Delete {removing.name}? Assigned baselines and prescriptions will keep their saved
            content.
          </Text>
          <Flex gap="2" wrap="wrap">
            <Button
              colorPalette="red"
              loading={change.isPending}
              onClick={() => change.mutate({ action: "remove", id: removing.id })}
            >
              Confirm deletion
            </Button>
            <Button
              variant="outline"
              disabled={change.isPending}
              onClick={() => {
                change.reset();
                setRemoving(undefined);
              }}
            >
              Cancel deletion
            </Button>
          </Flex>
        </Panel>
      )}
      {!editor && failure && <Notice role="alert">{failure}</Notice>}
      {visible?.length === 0 && (
        <Notice>{search.trim() ? "No matching templates." : "No session templates yet."}</Notice>
      )}
      {visible?.map((template) => (
        <Panel key={template.id}>
          <Heading as="h2" size="md">
            {template.name}
          </Heading>
          <Flex wrap="wrap" gap="3">
            <Text textTransform="capitalize">{template.sessionType}</Text>
            {template.plannedIntensity && (
              <Text textTransform="capitalize">{template.plannedIntensity}</Text>
            )}
            {template.plannedDurationMin !== null && <Text>{template.plannedDurationMin} min</Text>}
            <Text>
              {template.components.length}{" "}
              {template.components.length === 1 ? "component" : "components"}
            </Text>
          </Flex>
          {template.description && <Text whiteSpace="pre-wrap">{template.description}</Text>}
          <Flex gap="2" wrap="wrap">
            <Button
              size="sm"
              variant="outline"
              disabled={locked}
              aria-label={`Edit ${template.name}`}
              onClick={() => open(template)}
            >
              Edit
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={locked}
              aria-label={`Duplicate ${template.name}`}
              onClick={() => change.mutate({ action: "duplicate", id: template.id })}
            >
              Duplicate
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={locked}
              aria-label={`Delete ${template.name}`}
              onClick={() => {
                change.reset();
                setRemoving(template);
              }}
            >
              Delete
            </Button>
          </Flex>
        </Panel>
      ))}
    </Stack>
  );
};
