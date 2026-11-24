import { StructuralImpact } from "./StructuralImpact";
import { Button, Flex, Heading, Input, NativeSelect, Stack, Text } from "@chakra-ui/react";
import { Disclosure, FormField, Notice, Panel } from "../../components/ui";
import { useMutation } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { errorMessage } from "../programs/programs";
import type {
  BlockDetail,
  RemovalPreview,
  Slot,
  SlotFields,
  blocksApi,
} from "../programs/programs";
import { weekdays } from "./BlockWeeks";
import { SlotBaselineForm } from "./SlotBaselineForm";

type SlotCommand =
  | { kind: "save"; id?: string; fields: SlotFields }
  | { kind: "move"; id: string; offset: -1 | 1 }
  | { kind: "remove"; id: string; confirmation: RemovalPreview };

type SlotEditorProps = {
  ownerId: string;
  block: BlockDetail;
  api: ReturnType<typeof blocksApi>;
  sync: () => Promise<void>;
};

export const BlockSlots = ({ ownerId, block, api, sync }: SlotEditorProps) => {
  const [baselineSlot, setBaselineSlot] = useState<string>();
  const [editing, setEditing] = useState<string>();
  const [removal, setRemoval] = useState<{ slot: Slot; confirmation: RemovalPreview }>();
  const removalPanel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (removal) removalPanel.current?.focus();
  }, [removal]);

  const preview = useMutation({
    mutationFn: (slot: Slot) => api.removeSlotPreview(slot.id),
    onSuccess: (confirmation, slot) => setRemoval({ slot, confirmation }),
  });
  const change = useMutation({
    mutationFn: (command: SlotCommand) => {
      switch (command.kind) {
        case "save":
          return command.id
            ? api.updateSlot(command.id, command.fields)
            : api.addSlot(command.fields);
        case "move":
          return api.moveSlot(command.id, command.offset);
        case "remove":
          return api.removeSlot(command.id, command.confirmation);
      }
    },
    onSuccess: async (_result, command) => {
      await sync();
      if (command.kind === "save") setEditing(undefined);
      if (command.kind === "remove") setRemoval(undefined);
    },
    onError: (_error, command) => {
      if (command.kind === "remove") setRemoval(undefined);
    },
  });
  const pending = change.isPending || preview.isPending;
  const locked = pending || removal !== undefined || baselineSlot !== undefined;
  const openEditor = (id?: string) => {
    change.reset();
    preview.reset();
    setEditing(id);
  };
  const renderForm = (slot?: Slot) => (
    <SlotForm
      key={slot?.id ?? "new"}
      slot={slot}
      pending={locked}
      onSave={(fields) => change.mutate({ kind: "save", id: slot?.id, fields })}
      onCancel={() => openEditor()}
    />
  );
  const error = change.error ?? preview.error;

  return (
    <Panel id="weekly-session-slots" as="section" tabIndex={-1}>
      <Heading as="h2" size="lg">
        Weekly session slots
      </Heading>
      {block.editable && editing !== "new" && (
        <Button
          alignSelf="start"
          variant="outline"
          disabled={locked || editing !== undefined}
          onClick={() => openEditor("new")}
        >
          Add slot
        </Button>
      )}
      {block.editable && editing === "new" && renderForm()}
      {error && (
        <Notice role="alert">
          {errorMessage(error, "Unable to change the weekly slots. Try again.")}
        </Notice>
      )}
      {block.editable && removal && (
        <Panel
          ref={removalPanel}
          role="group"
          aria-label="Confirm slot removal"
          tabIndex={-1}
          bg="orange.subtle"
        >
          <Text>
            Remove {removal.slot.label}? This will remove{" "}
            {removal.confirmation.prescriptionIds.length} prescriptions and their components.
          </Text>
          <StructuralImpact sessions={removal.confirmation.scheduledSessions} />
          <Flex gap="2" wrap="wrap">
            <Button
              colorPalette="red"
              disabled={pending}
              onClick={() =>
                change.mutate({
                  kind: "remove",
                  id: removal.slot.id,
                  confirmation: removal.confirmation,
                })
              }
            >
              Confirm slot removal
            </Button>
            <Button variant="outline" disabled={pending} onClick={() => setRemoval(undefined)}>
              Cancel removal
            </Button>
          </Flex>
        </Panel>
      )}
      {weekdays.map((day, index) => {
        const slots = block.slots.filter(({ weekday }) => weekday === index + 1);
        if (!slots.length) return null;
        return (
          <Stack key={day} gap="2">
            <Heading as="h3" size="sm">
              {day}
            </Heading>
            {slots.map((slot, position) => (
              <Stack key={slot.id} p="3" gap="2" bg="bg.inset" borderRadius="md">
                <Text fontWeight="semibold">{slot.label}</Text>
                {slot.baselineName && (
                  <Text fontSize="sm" color="fg.muted">
                    Baseline: {slot.baselineName}
                    {block.editable && slot.templateId ? " · Linked to Library" : ""}
                  </Text>
                )}
                {block.editable &&
                  (editing === slot.id ? (
                    renderForm(slot)
                  ) : baselineSlot === slot.id ? (
                    <SlotBaselineForm
                      ownerId={ownerId}
                      slot={slot}
                      api={api}
                      sync={sync}
                      close={() => setBaselineSlot(undefined)}
                    />
                  ) : (
                    <Flex wrap="wrap" gap="2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={locked || editing !== undefined}
                        aria-label={`Edit ${slot.label}`}
                        onClick={() => openEditor(slot.id)}
                      >
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={locked || editing !== undefined}
                        aria-label={`Set baseline for ${slot.label}`}
                        onClick={() => setBaselineSlot(slot.id)}
                      >
                        Set baseline
                      </Button>
                      <Disclosure label="Slot actions">
                        <Flex gap="2" wrap="wrap">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={locked || editing !== undefined || position === 0}
                            aria-label={`Move ${slot.label} earlier`}
                            onClick={() => change.mutate({ kind: "move", id: slot.id, offset: -1 })}
                          >
                            Move earlier
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={
                              locked || editing !== undefined || position === slots.length - 1
                            }
                            aria-label={`Move ${slot.label} later`}
                            onClick={() => change.mutate({ kind: "move", id: slot.id, offset: 1 })}
                          >
                            Move later
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={locked || editing !== undefined}
                            aria-label={`Remove ${slot.label}`}
                            onClick={() => {
                              change.reset();
                              preview.mutate(slot);
                            }}
                          >
                            Remove
                          </Button>
                        </Flex>
                      </Disclosure>
                    </Flex>
                  ))}
              </Stack>
            ))}
          </Stack>
        );
      })}
    </Panel>
  );
};

const SlotForm = ({
  slot,
  pending,
  onSave,
  onCancel,
}: {
  slot?: Slot;
  pending: boolean;
  onSave: (fields: SlotFields) => void;
  onCancel: () => void;
}) => {
  const [label, setLabel] = useState(slot?.label ?? "");
  const [weekday, setWeekday] = useState(slot?.weekday ?? 1);

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSave({ label, weekday });
      }}
    >
      <Stack gap="2" maxW="xl">
        <FormField>
          Slot label
          <Input
            required
            maxLength={200}
            value={label}
            onChange={(event) => setLabel(event.target.value)}
          />
        </FormField>
        <FormField>
          Weekday
          <NativeSelect.Root>
            <NativeSelect.Field
              value={weekday}
              onChange={(event) => setWeekday(Number(event.target.value))}
            >
              {weekdays.map((day, index) => (
                <option key={day} value={index + 1}>
                  {day}
                </option>
              ))}
            </NativeSelect.Field>
            <NativeSelect.Indicator />
          </NativeSelect.Root>
        </FormField>
        <Flex wrap="wrap" gap="2">
          <Button type="submit" disabled={pending}>
            {slot ? "Save slot" : "Create slot"}
          </Button>
          <Button variant="outline" disabled={pending} onClick={onCancel}>
            Cancel slot edit
          </Button>
        </Flex>
      </Stack>
    </form>
  );
};
