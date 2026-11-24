import {
  Button,
  CloseButton,
  Dialog,
  Drawer,
  Flex,
  Input,
  NativeSelect,
  Portal,
  Stack,
  Text,
  Textarea,
} from "@chakra-ui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useRef, useState, type ReactNode } from "react";
import { FormField, Notice, Panel } from "../../components/ui";
import { errorMessage } from "../../lib/api/request";
import { plannedIntensities } from "../programs/programs";
import type {
  CopyPreview,
  CopyRequest,
  PlannedIntensity,
  PrescriptionCell,
  PrescriptionFields,
  ProgramWeek,
  Slot,
  WeekFields,
  blocksApi,
} from "../programs/programs";
import { useSession } from "../auth/session";
import { PrescriptionSnapshot } from "../calendar/PrescriptionSnapshot";
import { PrescriptionComponents } from "../prescriptions/PrescriptionComponents";
import { PrescriptionTemplatePicker } from "../prescriptions/PrescriptionTemplatePicker";
import { componentDraft, componentPayload } from "../prescriptions/components";
import { sessionTypes, templateKey } from "../templates/templates";
import type { SessionTemplate, SessionType } from "../templates/templates";

export type ProgrammingSelection =
  | { mode: "week"; week: ProgramWeek }
  | { mode: "cell"; week: ProgramWeek; slot: Slot }
  | { mode: "copy"; week: ProgramWeek; slot?: Slot };

type Props = {
  selection: ProgrammingSelection;
  editable: boolean;
  weeks: ProgramWeek[];
  slots: Slot[];
  api: ReturnType<typeof blocksApi>;
  cacheKey: readonly string[];
  sync: () => Promise<void>;
  close: () => void;
  copy: (week: ProgramWeek, slot?: Slot) => void;
};

export const weekTitle = (week: Pick<ProgramWeek, "label" | "position">) =>
  week.label ? `Week ${week.position} · ${week.label}` : `Week ${week.position}`;

export const WeekProgramming = ({ selection, ...props }: Props) => {
  const { mode, week } = selection;
  const title =
    mode === "week"
      ? `Edit ${weekTitle(week)}`
      : mode === "cell"
        ? `${weekTitle(week)} · ${selection.slot.label}`
        : selection.slot
          ? "Duplicate prescription"
          : "Copy week";
  if (mode === "cell") {
    return (
      <Drawer.Root
        open
        placement="end"
        size={{ mdDown: "full", md: "lg" }}
        closeOnEscape={false}
        closeOnInteractOutside={false}
      >
        <Portal>
          <Drawer.Backdrop />
          <Drawer.Positioner>
            <Drawer.Content>
              <CellEditor {...props} title={title} week={week} slot={selection.slot} />
            </Drawer.Content>
          </Drawer.Positioner>
        </Portal>
      </Drawer.Root>
    );
  }
  return (
    <Dialog.Root
      open
      placement="center"
      size={{ mdDown: "full", md: "lg" }}
      scrollBehavior="inside"
      closeOnEscape={false}
      closeOnInteractOutside={false}
    >
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content>
            <Dialog.Header>
              <Dialog.Title>{title}</Dialog.Title>
            </Dialog.Header>
            <Dialog.Body pb="6">
              {mode === "week" && <WeekForm {...props} week={week} />}
              {mode === "copy" && <CopyForm {...props} week={week} slot={selection.slot} />}
            </Dialog.Body>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
};

type WeekProps = Omit<Props, "selection"> & { week: ProgramWeek };

const WeekForm = ({ week, api, sync, close, copy, weeks }: WeekProps) => {
  const [fields, setFields] = useState<WeekFields>({
    label: week.label,
    focus: week.focus,
    weekType: week.weekType,
  });
  const dirty =
    fields.label !== week.label || fields.focus !== week.focus || fields.weekType !== week.weekType;
  const save = useMutation({
    mutationFn: () => api.updateWeek(week.id, fields),
    onSuccess: async () => {
      await sync();
      close();
    },
  });
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate();
      }}
    >
      <Stack gap="4">
        <FormField>
          Week name
          <Input
            maxLength={10000}
            value={fields.label}
            onChange={(event) => setFields({ ...fields, label: event.target.value })}
          />
        </FormField>
        <FormField>
          Focus
          <Textarea
            maxLength={10000}
            value={fields.focus}
            onChange={(event) => setFields({ ...fields, focus: event.target.value })}
          />
        </FormField>
        <FormField>
          Week type
          <NativeSelect.Root>
            <NativeSelect.Field
              aria-label="Week type"
              value={fields.weekType}
              onChange={(event) =>
                setFields({
                  ...fields,
                  weekType: event.target.value === "recovery" ? "recovery" : "normal",
                })
              }
            >
              <option value="normal">Normal</option>
              <option value="recovery">Recovery</option>
            </NativeSelect.Field>
            <NativeSelect.Indicator />
          </NativeSelect.Root>
        </FormField>
        {save.isError && (
          <Notice role="alert">{errorMessage(save.error, "Unable to save the week.")}</Notice>
        )}
        <Flex wrap="wrap" gap="2">
          <Button type="submit" loading={save.isPending}>
            Save week
          </Button>
          <Button
            variant="outline"
            disabled={save.isPending || weeks.length < 2 || dirty}
            onClick={() => copy(week)}
          >
            Copy week
          </Button>
          <Button variant="outline" disabled={save.isPending} onClick={close}>
            Cancel
          </Button>
        </Flex>
      </Stack>
    </form>
  );
};

type CellProps = WeekProps & { slot: Slot; title: string };

const SessionDrawerContent = ({
  title,
  close,
  closeDisabled,
  children,
}: {
  title: string;
  close: () => void;
  closeDisabled?: boolean;
  children: ReactNode;
}) => (
  <>
    <Drawer.Header alignItems="center" justifyContent="space-between">
      <Drawer.Title>{title}</Drawer.Title>
      <CloseButton aria-label="Close session drawer" disabled={closeDisabled} onClick={close} />
    </Drawer.Header>
    <Drawer.Body pb="6">{children}</Drawer.Body>
  </>
);

const CellEditor = (props: CellProps) => {
  const { api, cacheKey, week, slot, title, close, editable } = props;
  const cell = useQuery({
    queryKey: [...cacheKey, "weeks", week.id, "cells", slot.id],
    queryFn: ({ signal }) => api.getCell(week.id, slot.id, signal),
    retry: false,
    gcTime: 0,
  });
  if (cell.isPending)
    return (
      <SessionDrawerContent title={title} close={close}>
        <Notice role="status">Loading session…</Notice>
      </SessionDrawerContent>
    );
  if (cell.isError)
    return (
      <SessionDrawerContent title={title} close={close}>
        <Stack gap="3" align="start">
          <Notice role="alert">{errorMessage(cell.error, "Unable to load the session.")}</Notice>
          <Button onClick={() => void cell.refetch()}>Retry</Button>
        </Stack>
      </SessionDrawerContent>
    );
  if (!editable) {
    const prescription = cell.data.prescription;
    return (
      <SessionDrawerContent title={title} close={close}>
        <Stack gap="3">
          {prescription ? (
            <>
              <Text fontWeight="semibold">{prescription.title}</Text>
              <PrescriptionSnapshot prescription={prescription} />
            </>
          ) : (
            <Text>No prescription.</Text>
          )}
        </Stack>
      </SessionDrawerContent>
    );
  }
  return <CellForm {...props} cell={cell.data} />;
};

const CellForm = ({
  cell: loadedCell,
  slot,
  week,
  api,
  sync,
  close,
  title,
  copy,
  weeks,
  slots,
}: CellProps & { cell: PrescriptionCell }) => {
  const fieldId = useId();
  const [cell] = useState(loadedCell);
  const [originalComponents] = useState(
    () =>
      cell.prescription?.components.map((component, index) => componentDraft(index, component)) ??
      [],
  );
  const [components, setComponents] = useState(originalComponents);
  const componentKey = useRef(originalComponents.length);
  const nextKey = () => componentKey.current++;
  const [action, setAction] = useState<"insert" | "template" | "delete">();
  const [templateName, setTemplateName] = useState(cell.prescription?.title ?? "");
  const [templateSaved, setTemplateSaved] = useState(false);
  const session = useSession();
  const queryClient = useQueryClient();
  const [fields, setFields] = useState<PrescriptionFields>(() => {
    const session = cell.prescription;
    return {
      title: session?.title ?? slot.label,
      description: session?.description ?? "",
      notes: session?.notes ?? "",
      sessionType: session?.sessionType ?? "climbing",
      plannedDurationMin: session?.plannedDurationMin ?? null,
      plannedDurationMax: session?.plannedDurationMax ?? null,
      plannedRpeMin: session?.plannedRpeMin ?? null,
      plannedRpeMax: session?.plannedRpeMax ?? null,
      plannedIntensity: session?.plannedIntensity ?? null,
    };
  });
  const field = <K extends keyof PrescriptionFields>(key: K, value: PrescriptionFields[K]) =>
    setFields((current) => ({ ...current, [key]: value }));
  const save = useMutation({
    mutationFn: () =>
      api.saveCell(
        week.id,
        slot.id,
        {
          ...fields,
          ...(components !== originalComponents
            ? { components: components.map(componentPayload) }
            : {}),
        },
        cell.revision,
      ),
    onSuccess: async () => {
      await sync();
      close();
    },
  });
  const linkTemplate = useMutation({
    mutationFn: (template: SessionTemplate) =>
      api.linkCellTemplate(week.id, slot.id, template.id, cell.revision),
    onSuccess: async () => {
      await sync();
      close();
    },
  });
  const libraryOrDelete = useMutation({
    mutationFn: (command: "template" | "delete") =>
      command === "template"
        ? api.saveCellAsTemplate(week.id, slot.id, templateName.trim(), cell.revision)
        : api.deleteCell(week.id, slot.id, cell.revision),
    onSuccess: async (_result, command) => {
      if (command === "delete") {
        await sync();
        close();
      } else {
        if (session.status === "signed-in") {
          await queryClient.invalidateQueries({ queryKey: templateKey(session.ownerId) });
        }
        setAction(undefined);
        setTemplateSaved(true);
      }
    },
  });
  const dirty =
    components !== originalComponents ||
    Object.entries(fields).some(
      ([key, value]) => cell.prescription?.[key as keyof PrescriptionFields] !== value,
    );
  const pending = save.isPending || libraryOrDelete.isPending || linkTemplate.isPending;
  const setPanel = (mode?: typeof action) => {
    libraryOrDelete.reset();
    linkTemplate.reset();
    setTemplateSaved(false);
    setAction(mode);
  };
  const insert = (template: SessionTemplate) => {
    setFields((previous) => ({
      ...previous,
      title: template.name,
      sessionType: template.sessionType,
      description: template.description,
      plannedDurationMin: template.plannedDurationMin,
      plannedDurationMax: template.plannedDurationMax ?? null,
      plannedRpeMin: template.plannedRpeMin ?? null,
      plannedRpeMax: template.plannedRpeMax ?? null,
      plannedIntensity: template.plannedIntensity,
    }));
    setComponents(template.components.map((component) => componentDraft(nextKey(), component)));
    setPanel(undefined);
  };

  return (
    <SessionDrawerContent
      title={title}
      close={close}
      closeDisabled={pending || action !== undefined}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!action && !pending) save.mutate();
        }}
      >
        <Stack gap="4">
          <FormField>
            Session title
            <Input
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
                aria-label="Session type"
                value={fields.sessionType}
                onChange={(event) => field("sessionType", event.target.value as SessionType)}
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
          <Stack gap="1.5">
            <FormField htmlFor={`${fieldId}-description`}>Description</FormField>
            <Textarea
              id={`${fieldId}-description`}
              maxLength={10000}
              value={fields.description}
              onChange={(event) => field("description", event.target.value)}
            />
          </Stack>
          <Stack gap="1.5">
            <FormField htmlFor={`${fieldId}-notes`}>Notes</FormField>
            <Textarea
              id={`${fieldId}-notes`}
              maxLength={10000}
              value={fields.notes}
              onChange={(event) => field("notes", event.target.value)}
            />
          </Stack>
          <FormField>
            Planned duration in minutes
            <Flex gap="2">
              <Input
                aria-label="Minimum planned duration in minutes"
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
                aria-label="Maximum planned duration in minutes"
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
                aria-label="Planned intensity"
                value={fields.plannedIntensity ?? ""}
                onChange={(event) =>
                  field("plannedIntensity", (event.target.value || null) as PlannedIntensity | null)
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
            disabled={pending || action !== undefined}
          />
          {action === "insert" && session.status === "signed-in" && (
            <PrescriptionTemplatePicker
              ownerId={session.ownerId}
              populated={
                cell.prescription !== null ||
                components.length > 0 ||
                fields.title !== slot.label ||
                fields.description !== "" ||
                fields.plannedDurationMin !== null ||
                fields.plannedIntensity !== null ||
                fields.sessionType !== "climbing"
              }
              insert={insert}
              link={
                cell.prescription ? (dirty ? undefined : linkTemplate.mutate) : linkTemplate.mutate
              }
              pending={linkTemplate.isPending}
              close={() => setPanel()}
            />
          )}
          {linkTemplate.isError && (
            <Notice role="alert">
              {errorMessage(linkTemplate.error, "Unable to link the template.")}
            </Notice>
          )}
          {action === "template" && (
            <Panel role="group" aria-label="Save as template" bg="bg.inset">
              <FormField>
                Template name
                <Input
                  maxLength={200}
                  disabled={pending}
                  value={templateName}
                  onChange={(event) => setTemplateName(event.target.value)}
                />
              </FormField>
              <Flex wrap="wrap" gap="2">
                <Button
                  type="button"
                  loading={libraryOrDelete.isPending}
                  disabled={!templateName.trim()}
                  onClick={() => libraryOrDelete.mutate("template")}
                >
                  Create template
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={pending}
                  onClick={() => setPanel()}
                >
                  Cancel template save
                </Button>
              </Flex>
            </Panel>
          )}
          {action === "delete" && (
            <Panel role="group" aria-label="Confirm prescription deletion" bg="orange.subtle">
              <Text>
                Delete this prescription and all its components? The weekly slot and its baseline
                will remain available.
              </Text>
              <Flex wrap="wrap" gap="2">
                <Button
                  type="button"
                  colorPalette="red"
                  loading={libraryOrDelete.isPending}
                  onClick={() => libraryOrDelete.mutate("delete")}
                >
                  Confirm deletion
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={pending}
                  onClick={() => setPanel()}
                >
                  Cancel deletion
                </Button>
              </Flex>
            </Panel>
          )}
          {libraryOrDelete.isError && (
            <Notice role="alert">
              {errorMessage(libraryOrDelete.error, "Unable to apply the change.")}
            </Notice>
          )}
          {cell.templateId && (
            <Notice>
              Saving an individual edit stops this workout from following its Library template.
            </Notice>
          )}
          {templateSaved && <Notice role="status">Template saved to Library.</Notice>}
          {save.isError && (
            <Notice role="alert">{errorMessage(save.error, "Unable to save the session.")}</Notice>
          )}
          <Flex wrap="wrap" gap="2">
            <Button
              type="submit"
              loading={save.isPending}
              disabled={action !== undefined || pending}
            >
              Save session
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={pending || action !== undefined}
              onClick={() => setPanel("insert")}
            >
              Insert template
            </Button>
            {cell.prescription && (
              <>
                <Button
                  type="button"
                  variant="outline"
                  disabled={
                    pending ||
                    action !== undefined ||
                    dirty ||
                    (weeks.length < 2 && slots.length < 2)
                  }
                  onClick={() => copy(week, slot)}
                >
                  Duplicate prescription
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={pending || action !== undefined || dirty}
                  onClick={() => setPanel("template")}
                >
                  Save as template
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={pending || action !== undefined}
                  onClick={() => setPanel("delete")}
                >
                  Delete prescription
                </Button>
              </>
            )}
          </Flex>
          {cell.prescription && dirty && (
            <Text fontSize="sm" color="fg.muted">
              Save changes to duplicate this prescription or save it as a template.
            </Text>
          )}
        </Stack>
      </form>
    </SessionDrawerContent>
  );
};

const CopyForm = ({ week, slot, weeks, slots, api, sync, close }: WeekProps & { slot?: Slot }) => {
  const [destinationWeekId, setDestination] = useState("");
  const [destinationSlotId, setDestinationSlot] = useState(slot?.id ?? "");
  const [review, setReview] = useState<CopyPreview>();
  const request: CopyRequest = {
    destinationWeekId,
    slotId: slot?.id,
    destinationSlotId: slot ? destinationSlotId : undefined,
  };
  const ready =
    !!destinationWeekId &&
    (slot
      ? !!destinationSlotId && (destinationWeekId !== week.id || destinationSlotId !== slot.id)
      : destinationWeekId !== week.id);
  const execute = useMutation({
    mutationFn: async () => {
      if (review) return api.copyWeek(week.id, request, review.revision);
      const preview = await api.copyPreview(week.id, request);
      if (preview.replaced || preview.removed) {
        setReview(preview);
        return null;
      }
      return api.copyWeek(week.id, request, preview.revision);
    },
    onSuccess: async (result) => {
      if (result) {
        await sync();
        close();
      }
    },
    onError: () => setReview(undefined),
  });

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (ready && !execute.isPending) execute.mutate();
      }}
    >
      <Stack gap="4">
        <Text>
          From {weekTitle(week)}
          {slot ? ` · ${slot.label}` : ""}
        </Text>
        <FormField>
          Destination week
          <NativeSelect.Root disabled={execute.isPending}>
            <NativeSelect.Field
              aria-label="Destination week"
              value={destinationWeekId}
              onChange={(event) => {
                setDestination(event.target.value);
                setReview(undefined);
                execute.reset();
              }}
            >
              <option value="">Choose a week</option>
              {weeks
                .filter((candidate) => slot || candidate.id !== week.id)
                .map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {weekTitle(candidate)}
                  </option>
                ))}
            </NativeSelect.Field>
            <NativeSelect.Indicator />
          </NativeSelect.Root>
        </FormField>
        {slot && (
          <FormField>
            Destination slot
            <NativeSelect.Root disabled={execute.isPending}>
              <NativeSelect.Field
                aria-label="Destination slot"
                value={destinationSlotId}
                onChange={(event) => {
                  setDestinationSlot(event.target.value);
                  setReview(undefined);
                  execute.reset();
                }}
              >
                {slots.map((candidate) => (
                  <option value={candidate.id} key={candidate.id}>
                    {candidate.label}
                  </option>
                ))}
              </NativeSelect.Field>
              <NativeSelect.Indicator />
            </NativeSelect.Root>
          </FormField>
        )}
        {review && (
          <Notice role="status">
            This copy will replace {review.replaced} and remove {review.removed} existing
            prescriptions in the destination.
          </Notice>
        )}
        {execute.isError && (
          <Notice role="alert">
            {errorMessage(execute.error, "Unable to copy prescriptions.")}
          </Notice>
        )}
        <Flex wrap="wrap" gap="2">
          <Button
            type="submit"
            loading={execute.isPending}
            disabled={!ready}
            colorPalette={review ? "red" : undefined}
          >
            {review ? "Confirm copy" : "Copy"}
          </Button>
          <Button variant="outline" disabled={execute.isPending} onClick={close}>
            Cancel
          </Button>
        </Flex>
      </Stack>
    </form>
  );
};
