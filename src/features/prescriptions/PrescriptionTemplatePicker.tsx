import { Button, Flex, Heading, NativeSelect, Stack, Text } from "@chakra-ui/react";
import { useQuery } from "@tanstack/react-query";
import { useId, useState } from "react";
import { FormField, Notice, Panel } from "../../components/ui";
import { templateKey, templatesApi } from "../templates/templates";
import type { SessionTemplate } from "../templates/templates";

export const PrescriptionTemplatePicker = ({
  ownerId,
  populated,
  insert,
  close,
}: {
  ownerId: string;
  populated: boolean;
  insert: (template: SessionTemplate) => void;
  close: () => void;
}) => {
  const inputId = useId();
  const [selectedId, setSelectedId] = useState("");
  const templates = useQuery({
    queryKey: templateKey(ownerId),
    queryFn: ({ signal }) => templatesApi.list(signal),
    retry: false,
  });
  const selected = templates.data?.find((template) => template.id === selectedId);

  return (
    <Panel role="group" aria-label="Insert template" bg="bg.inset">
      <FormField htmlFor={inputId}>Library template</FormField>
      <NativeSelect.Root>
        <NativeSelect.Field
          id={inputId}
          value={selectedId}
          onChange={(event) => setSelectedId(event.target.value)}
        >
          <option value="">Choose a template</option>
          {templates.data?.map((template) => (
            <option key={template.id} value={template.id}>
              {template.name}
            </option>
          ))}
        </NativeSelect.Field>
        <NativeSelect.Indicator />
      </NativeSelect.Root>
      {templates.isPending && <Notice role="status">Loading templates…</Notice>}
      {templates.data?.length === 0 && <Notice>No session templates yet.</Notice>}
      {templates.isError && (
        <>
          <Notice role="alert">Unable to load templates.</Notice>
          <Button
            type="button"
            size="sm"
            alignSelf="start"
            onClick={() => void templates.refetch()}
          >
            Retry
          </Button>
        </>
      )}
      {selected && (
        <Stack gap="2">
          <Heading as="h3" size="sm">
            {selected.name}
          </Heading>
          <Text textTransform="capitalize">
            {selected.sessionType} ·{" "}
            {selected.plannedDurationMin === null
              ? "Duration unspecified"
              : `${selected.plannedDurationMin} min`}
            {" · "}
            {selected.plannedIntensity ?? "Intensity unspecified"}
          </Text>
          {selected.description && <Text whiteSpace="pre-wrap">{selected.description}</Text>}
          {selected.components.length > 0 ? (
            <Stack as="ol" ps="5" gap="1" listStyleType="decimal">
              {selected.components.map((component, index) => (
                <Text as="li" key={index}>
                  {component.name}
                </Text>
              ))}
            </Stack>
          ) : (
            <Text>No components</Text>
          )}
          {populated && (
            <Notice>
              This replaces the session details and components in your draft. Session notes are
              kept.
            </Notice>
          )}
        </Stack>
      )}
      <Flex gap="2" wrap="wrap">
        <Button
          type="button"
          disabled={!selected}
          onClick={() => {
            if (selected) insert(selected);
          }}
        >
          {populated ? "Replace draft with template" : "Load template into draft"}
        </Button>
        <Button type="button" variant="outline" onClick={close}>
          Cancel insertion
        </Button>
      </Flex>
    </Panel>
  );
};
