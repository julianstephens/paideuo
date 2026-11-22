import {
  Button,
  Dialog,
  Flex,
  Input,
  NativeSelect,
  Portal,
  Stack,
  Text,
  Textarea,
  chakra,
} from "@chakra-ui/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useId, useRef, useState } from "react";
import { FormField, Notice } from "../../components/ui";
import { errorMessage } from "../../lib/api/request";
import { PrescriptionComponents } from "../prescriptions/PrescriptionComponents";
import { PrescriptionTemplatePicker } from "../prescriptions/PrescriptionTemplatePicker";
import { componentDraft, componentPayload } from "../prescriptions/components";
import type { ComponentDraft } from "../prescriptions/components";
import { plannedIntensities } from "../programs/programs";
import type { PrescriptionFields } from "../programs/programs";
import { sessionTypes } from "../templates/templates";
import type { SessionTemplate } from "../templates/templates";
import { fullDate } from "./dates";
import { calendarKey, schedulingApi } from "./scheduling";
import type { CalendarSession } from "./scheduling";

export const WorkoutDialog = ({
  date,
  ownerId,
  close,
  trigger,
  session,
  onSaved,
}: {
  date: string;
  ownerId: string;
  close: () => void;
  trigger?: () => HTMLElement | null;
  session?: CalendarSession;
  onSaved?: () => Promise<unknown>;
}) => {
  const formId = useId();
  const titleInput = useRef<HTMLInputElement>(null);
  const operationId = useRef<string>(undefined);
  const componentKey = useRef(session?.prescription.components.length ?? 0);
  const [showTemplates, setShowTemplates] = useState(false);
  const [fields, setFields] = useState<PrescriptionFields>(
    session?.prescription ?? {
      title: "",
      sessionType: "other",
      description: "",
      notes: "",
      plannedDurationMin: null,
      plannedDurationMax: null,
      plannedRpeMin: null,
      plannedRpeMax: null,
      plannedIntensity: null,
    },
  );
  const [components, setComponents] = useState<ComponentDraft[]>(
    () =>
      session?.prescription.components.map((component, index) =>
        componentDraft(index, component),
      ) ?? [],
  );
  const queryClient = useQueryClient();
  const save = useMutation({
    mutationFn: () => {
      const prescription = { ...fields, components: components.map(componentPayload) };
      if (session) return schedulingApi.edit(session, prescription);
      operationId.current ??= crypto.randomUUID();
      return schedulingApi.createOneOff({
        scheduledDate: date,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
        operationId: operationId.current,
        prescription,
      });
    },
    onSuccess: async () => {
      if (onSaved) await onSaved();
      else await queryClient.invalidateQueries({ queryKey: calendarKey(ownerId) });
      close();
    },
  });

  const field = <K extends keyof PrescriptionFields>(name: K, value: PrescriptionFields[K]) =>
    setFields((current) => ({ ...current, [name]: value }));
  const nextKey = () => componentKey.current++;
  const insert = (template: SessionTemplate) => {
    const {
      name,
      sessionType,
      description,
      plannedDurationMin,
      plannedDurationMax,
      plannedRpeMin,
      plannedRpeMax,
      plannedIntensity,
    } = template;
    setFields((current) => ({
      ...current,
      title: name,
      sessionType,
      description,
      plannedDurationMin,
      plannedDurationMax: plannedDurationMax ?? null,
      plannedRpeMin: plannedRpeMin ?? null,
      plannedRpeMax: plannedRpeMax ?? null,
      plannedIntensity,
    }));
    setComponents(template.components.map((component) => componentDraft(nextKey(), component)));
    setShowTemplates(false);
  };

  return (
    <Dialog.Root
      open
      onOpenChange={({ open }) => {
        if (!open && !save.isPending) close();
      }}
      closeOnEscape={!save.isPending}
      closeOnInteractOutside={!save.isPending}
      initialFocusEl={() => titleInput.current}
      finalFocusEl={trigger}
      placement="center"
      scrollBehavior="inside"
    >
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner
          p={{ base: "3", md: "6" }}
          pt={{ base: "max(0.75rem, env(safe-area-inset-top))", md: "6" }}
          pb={{ base: "max(0.75rem, env(safe-area-inset-bottom))", md: "6" }}
        >
          <Dialog.Content maxH={{ base: "100%", md: "calc(100dvh - 4rem)" }}>
            <Dialog.Header borderBottomWidth="1px">
              <Stack gap="1">
                <Dialog.Title>{session ? "Edit workout" : "Add workout"}</Dialog.Title>
                <Text color="fg.muted" fontSize="sm">
                  {fullDate(date)}
                </Text>
              </Stack>
            </Dialog.Header>
            <Dialog.Body py="4">
              <form
                id={formId}
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!save.isPending && !showTemplates && fields.title.trim()) save.mutate();
                }}
              >
                <chakra.fieldset disabled={save.isPending} display="grid" gap="4" minW="0">
                  {showTemplates ? (
                    <PrescriptionTemplatePicker
                      ownerId={ownerId}
                      populated={Boolean(
                        fields.title ||
                        fields.description ||
                        fields.sessionType !== "other" ||
                        fields.plannedDurationMin !== null ||
                        fields.plannedIntensity ||
                        components.length,
                      )}
                      insert={insert}
                      close={() => setShowTemplates(false)}
                    />
                  ) : (
                    <Button
                      type="button"
                      alignSelf="start"
                      variant="outline"
                      onClick={() => setShowTemplates(true)}
                    >
                      Use a template
                    </Button>
                  )}
                  <FormField>
                    Workout title
                    <Input
                      ref={titleInput}
                      required
                      maxLength={200}
                      value={fields.title}
                      onChange={(event) => field("title", event.target.value)}
                    />
                  </FormField>
                  <FormField>
                    Session type
                    <NativeSelect.Root>
                      <NativeSelect.Field
                        value={fields.sessionType}
                        onChange={(event) =>
                          field(
                            "sessionType",
                            event.target.value as PrescriptionFields["sessionType"],
                          )
                        }
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
                    Description
                    <Textarea
                      maxLength={10000}
                      value={fields.description}
                      onChange={(event) => field("description", event.target.value)}
                    />
                  </FormField>
                  <FormField>
                    Notes
                    <Textarea
                      maxLength={10000}
                      value={fields.notes}
                      onChange={(event) => field("notes", event.target.value)}
                    />
                  </FormField>
                  <FormField>
                    Planned duration in minutes
                    <Flex gap="2">
                      <Input
                        aria-label="Minimum planned duration"
                        type="number"
                        min={0}
                        step={1}
                        value={fields.plannedDurationMin ?? ""}
                        onChange={(event) =>
                          field(
                            "plannedDurationMin",
                            event.target.value === "" ? null : Number(event.target.value),
                          )
                        }
                      />
                      <Input
                        aria-label="Maximum planned duration"
                        type="number"
                        min={fields.plannedDurationMin ?? 0}
                        step={1}
                        value={fields.plannedDurationMax ?? ""}
                        onChange={(event) =>
                          field(
                            "plannedDurationMax",
                            event.target.value === "" ? null : Number(event.target.value),
                          )
                        }
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
                        value={fields.plannedRpeMin ?? ""}
                        onChange={(event) =>
                          field(
                            "plannedRpeMin",
                            event.target.value === "" ? null : Number(event.target.value),
                          )
                        }
                      />
                      <Input
                        aria-label="Maximum planned RPE"
                        type="number"
                        min={fields.plannedRpeMin ?? 1}
                        max={10}
                        step="any"
                        value={fields.plannedRpeMax ?? ""}
                        onChange={(event) =>
                          field(
                            "plannedRpeMax",
                            event.target.value === "" ? null : Number(event.target.value),
                          )
                        }
                      />
                    </Flex>
                  </FormField>
                  <FormField>
                    Planned intensity
                    <NativeSelect.Root>
                      <NativeSelect.Field
                        value={fields.plannedIntensity ?? ""}
                        onChange={(event) =>
                          field(
                            "plannedIntensity",
                            (event.target.value || null) as PrescriptionFields["plannedIntensity"],
                          )
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
                    nextKey={nextKey}
                    disabled={save.isPending || showTemplates}
                  />
                </chakra.fieldset>
              </form>
            </Dialog.Body>
            <Dialog.Footer
              borderTopWidth="1px"
              flexShrink="0"
              flexDirection="column"
              alignItems="stretch"
              gap="3"
            >
              {save.isError && (
                <Notice role="alert">
                  {errorMessage(save.error, "Unable to save the workout.")}
                </Notice>
              )}
              <Stack direction="row" justify="end" wrap="wrap">
                <Button variant="outline" onClick={close} disabled={save.isPending}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  form={formId}
                  loading={save.isPending}
                  disabled={showTemplates || !fields.title.trim()}
                >
                  Save workout
                </Button>
              </Stack>
            </Dialog.Footer>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
};
