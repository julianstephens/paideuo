import { Button, Flex, Heading, Input, NativeSelect, Stack, Textarea } from "@chakra-ui/react";
import { useRef, useState } from "react";
import { FormField, Notice, Panel } from "../../components/ui";
import { sessionTypes } from "./templates";
import type { SessionTemplate, SessionType, TemplateFields } from "./templates";
import { plannedIntensities } from "../programs/programs";
import type { PlannedIntensity } from "../programs/programs";
import { PrescriptionComponents } from "../prescriptions/PrescriptionComponents";
import { componentDraft, componentPayload } from "../prescriptions/components";

type Props = {
  template?: SessionTemplate;
  pending: boolean;
  error?: string;
  onSave: (fields: TemplateFields) => void;
  onCancel: () => void;
};

const minutes = (value: string) => (value === "" ? null : Number(value));

export const TemplateForm = ({ template, pending, error, onSave, onCancel }: Props) => {
  const [name, setName] = useState(template?.name ?? "");
  const [description, setDescription] = useState(template?.description ?? "");
  const [sessionType, setSessionType] = useState<SessionType>(template?.sessionType ?? "climbing");
  const [plannedDurationMin, setDuration] = useState(template?.plannedDurationMin ?? null);
  const [plannedDurationMax, setDurationMax] = useState(template?.plannedDurationMax ?? null);
  const [plannedRpeMin, setRpeMin] = useState(template?.plannedRpeMin ?? null);
  const [plannedRpeMax, setRpeMax] = useState(template?.plannedRpeMax ?? null);
  const [plannedIntensity, setIntensity] = useState(template?.plannedIntensity ?? null);
  const [components, setComponents] = useState(
    () => template?.components.map((component, index) => componentDraft(index, component)) ?? [],
  );
  const nextKey = useRef(components.length);

  return (
    <Panel as="section" maxW="2xl">
      <Heading as="h2" size="lg">
        {template ? "Edit session template" : "New session template"}
      </Heading>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (pending) return;
          onSave({
            name,
            description,
            sessionType,
            plannedDurationMin,
            plannedDurationMax,
            plannedRpeMin,
            plannedRpeMax,
            plannedIntensity,
            components: components.map(componentPayload),
          });
        }}
      >
        <Stack gap="4">
          <FormField>
            Template name
            <Input
              required
              maxLength={200}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </FormField>
          <FormField>
            Description
            <Textarea
              maxLength={10000}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </FormField>
          <FormField>
            Session type
            <NativeSelect.Root>
              <NativeSelect.Field
                aria-label="Session type"
                value={sessionType}
                onChange={(event) => setSessionType(event.target.value as SessionType)}
              >
                {sessionTypes.map((type) => (
                  <option key={type} value={type}>
                    {type[0].toUpperCase() + type.slice(1)}
                  </option>
                ))}
              </NativeSelect.Field>
              <NativeSelect.Indicator />
            </NativeSelect.Root>
          </FormField>
          <FormField>
            Planned duration in minutes
            <Flex gap="2">
              <Input
                aria-label="Minimum planned duration"
                type="number"
                min={0}
                step={1}
                value={plannedDurationMin ?? ""}
                onChange={(event) => setDuration(minutes(event.target.value))}
              />
              <Input
                aria-label="Maximum planned duration"
                type="number"
                min={plannedDurationMin ?? 0}
                step={1}
                value={plannedDurationMax ?? ""}
                onChange={(event) => setDurationMax(minutes(event.target.value))}
              />
            </Flex>
          </FormField>
          <FormField>
            Planned RPE
            <Flex gap="2">
              <Input
                aria-label="Minimum planned RPE"
                type="number"
                min={1}
                max={10}
                step="any"
                value={plannedRpeMin ?? ""}
                onChange={(event) => setRpeMin(minutes(event.target.value))}
              />
              <Input
                aria-label="Maximum planned RPE"
                type="number"
                min={plannedRpeMin ?? 1}
                max={10}
                step="any"
                value={plannedRpeMax ?? ""}
                onChange={(event) => setRpeMax(minutes(event.target.value))}
              />
            </Flex>
          </FormField>
          <FormField>
            Planned intensity
            <NativeSelect.Root>
              <NativeSelect.Field
                aria-label="Planned intensity"
                value={plannedIntensity ?? ""}
                onChange={(event) =>
                  setIntensity((event.target.value || null) as PlannedIntensity | null)
                }
              >
                <option value="">Unspecified</option>
                {plannedIntensities.map((level) => (
                  <option key={level} value={level}>
                    {level[0].toUpperCase() + level.slice(1)}
                  </option>
                ))}
              </NativeSelect.Field>
              <NativeSelect.Indicator />
            </NativeSelect.Root>
          </FormField>
          <PrescriptionComponents
            components={components}
            change={setComponents}
            nextKey={() => nextKey.current++}
            disabled={pending}
          />
          {error && <Notice role="alert">{error}</Notice>}
          <Flex gap="2" wrap="wrap">
            <Button type="submit" loading={pending}>
              Save template
            </Button>
            <Button variant="outline" disabled={pending} onClick={onCancel}>
              Cancel
            </Button>
          </Flex>
        </Stack>
      </form>
    </Panel>
  );
};
