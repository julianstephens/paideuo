import { useId } from "react";
import { Button, Flex, Heading, Input, NativeSelect, Stack, Textarea } from "@chakra-ui/react";
import { FormField } from "../../components/ui";
import { targetDefinitions } from "./components";
import type { ComponentDraft } from "./components";

type Props = {
  components: ComponentDraft[];
  change: (components: ComponentDraft[]) => void;
  nextKey: () => number;
  disabled: boolean;
};

export const PrescriptionComponents = ({ components, change, nextKey, disabled }: Props) => {
  const move = (index: number, offset: -1 | 1) => {
    const updated = [...components];
    [updated[index], updated[index + offset]] = [updated[index + offset], updated[index]];
    change(updated);
  };

  return (
    <Stack gap="3">
      <Heading as="h3" size="sm">
        Components
      </Heading>
      <Stack as="ol" listStyleType="none" gap="3">
        {components.map((component, index) => (
          <Stack as="li" key={component.key} bg="bg.inset" borderRadius="md" p="3" gap="3">
            <Stack role="group" aria-label={`Component ${index + 1}`} gap="3">
              <ComponentFields
                component={component}
                disabled={disabled}
                change={(value) =>
                  change(components.map((entry) => (entry.key === component.key ? value : entry)))
                }
              />
              <Flex gap="2" wrap="wrap">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={disabled || index === 0}
                  onClick={() => move(index, -1)}
                >
                  Move up
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={disabled || index === components.length - 1}
                  onClick={() => move(index, 1)}
                >
                  Move down
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={disabled}
                  onClick={() =>
                    change([
                      ...components.slice(0, index + 1),
                      { ...component, key: nextKey(), snapshotKey: crypto.randomUUID() },
                      ...components.slice(index + 1),
                    ])
                  }
                >
                  Duplicate component
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={disabled}
                  onClick={() => change(components.filter((entry) => entry.key !== component.key))}
                >
                  Remove component
                </Button>
              </Flex>
            </Stack>
          </Stack>
        ))}
      </Stack>
      <Button
        size="sm"
        alignSelf="start"
        variant="outline"
        disabled={disabled}
        onClick={() =>
          change([
            ...components,
            {
              key: nextKey(),
              snapshotKey: crypto.randomUUID(),
              name: "",
              instructions: "",
              targets: {},
            },
          ])
        }
      >
        Add component
      </Button>
    </Stack>
  );
};

const ComponentFields = ({
  component,
  change,
  disabled,
}: {
  component: ComponentDraft;
  change: (component: ComponentDraft) => void;
  disabled: boolean;
}) => {
  const instructionsId = useId();
  const available = targetDefinitions.filter(({ key }) => component.targets[key] === undefined);
  return (
    <>
      <FormField>
        Component name
        <Input
          required
          maxLength={200}
          disabled={disabled}
          value={component.name}
          onChange={(event) => change({ ...component, name: event.target.value })}
        />
      </FormField>
      <FormField>
        Training classification
        <NativeSelect.Root disabled={disabled} size="sm">
          <NativeSelect.Field
            value={component.classification ?? ""}
            onChange={(event) =>
              change({
                ...component,
                classification:
                  (event.target.value as ComponentDraft["classification"]) || undefined,
              })
            }
          >
            <option value="">Unclassified</option>
            <option value="aerobic">Aerobic</option>
            <option value="strength">Strength</option>
            <option value="movement">Movement</option>
            <option value="mobility">Mobility</option>
            <option value="other">Other</option>
          </NativeSelect.Field>
          <NativeSelect.Indicator />
        </NativeSelect.Root>
      </FormField>
      <Stack gap="1.5">
        <FormField htmlFor={instructionsId}>Component instructions</FormField>
        <Textarea
          id={instructionsId}
          maxLength={10000}
          disabled={disabled}
          value={component.instructions}
          onChange={(event) => change({ ...component, instructions: event.target.value })}
        />
      </Stack>
      {targetDefinitions.map(({ key, label, fields }) => {
        const values = component.targets[key];
        if (!values) return null;
        return (
          <Stack key={key} borderWidth="1px" borderRadius="md" p="2" gap="2">
            {fields.map(({ label, required, ...props }, index) => (
              <FormField key={label}>
                {label}
                <Input
                  {...props}
                  disabled={disabled}
                  required={required ?? true}
                  value={values[index]}
                  onChange={(event) =>
                    change({
                      ...component,
                      targets: {
                        ...component.targets,
                        [key]: values.map((value, i) => (i === index ? event.target.value : value)),
                      },
                    })
                  }
                />
              </FormField>
            ))}
            <Button
              size="xs"
              variant="ghost"
              alignSelf="start"
              disabled={disabled}
              onClick={() => {
                const next = { ...component.targets };
                delete next[key];
                change({ ...component, targets: next });
              }}
            >
              Remove {label} target
            </Button>
          </Stack>
        );
      })}
      {available.length > 0 && (
        <NativeSelect.Root disabled={disabled} size="sm">
          <NativeSelect.Field
            aria-label="Add target"
            value=""
            onChange={(event) => {
              const target = available.find(({ key }) => key === event.target.value);
              if (target)
                change({
                  ...component,
                  targets: { ...component.targets, [target.key]: target.fields.map(() => "") },
                });
            }}
          >
            <option value="">Add target</option>
            {available.map(({ key, label }) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </NativeSelect.Field>
          <NativeSelect.Indicator />
        </NativeSelect.Root>
      )}
    </>
  );
};
