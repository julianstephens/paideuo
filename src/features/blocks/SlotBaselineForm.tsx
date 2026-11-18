import { Button, Flex, NativeSelect, Stack } from "@chakra-ui/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useId, useState } from "react";
import { FormField, Notice } from "../../components/ui";
import { errorMessage } from "../../lib/api/request";
import type { Slot, blocksApi } from "../programs/programs";
import { templateKey, templatesApi } from "../templates/templates";

type Props = {
  ownerId: string;
  slot: Slot;
  api: ReturnType<typeof blocksApi>;
  sync: () => Promise<void>;
  close: () => void;
};

export const SlotBaselineForm = ({ ownerId, slot, api, sync, close }: Props) => {
  const selectId = useId();
  const [selected, setSelected] = useState("");
  const library = useQuery({
    queryKey: templateKey(ownerId),
    queryFn: ({ signal }) => templatesApi.list(signal),
    retry: false,
  });
  const change = useMutation({
    mutationFn: (templateId: string | null) => api.setSlotBaseline(slot.id, templateId),
    onSuccess: async () => {
      await sync();
      close();
    },
  });

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (selected) change.mutate(selected);
      }}
    >
      <Stack gap="2">
        <FormField htmlFor={selectId}>Session template</FormField>
        <NativeSelect.Root disabled={change.isPending}>
          <NativeSelect.Field
            id={selectId}
            value={selected}
            onChange={(event) => setSelected(event.target.value)}
          >
            <option value="">Choose a template</option>
            {library.data?.map((template) => (
              <option key={template.id} value={template.id}>
                {template.name}
              </option>
            ))}
          </NativeSelect.Field>
          <NativeSelect.Indicator />
        </NativeSelect.Root>
        {library.isPending && <Notice role="status">Loading templates…</Notice>}
        {library.data?.length === 0 && (
          <Notice>Create a session template in Library to assign it here.</Notice>
        )}
        {library.isError && (
          <>
            <Notice role="alert">Unable to load templates.</Notice>
            <Button size="sm" alignSelf="start" onClick={() => void library.refetch()}>
              Retry
            </Button>
          </>
        )}
        {change.isError && (
          <Notice role="alert">
            {errorMessage(change.error, "Unable to save the slot baseline.")}
          </Notice>
        )}
        <Flex wrap="wrap" gap="2">
          <Button size="sm" type="submit" disabled={!selected || change.isPending}>
            Assign template
          </Button>
          {slot.baselineName && (
            <Button
              size="sm"
              variant="outline"
              disabled={change.isPending}
              onClick={() => change.mutate(null)}
            >
              Clear baseline
            </Button>
          )}
          <Button size="sm" variant="outline" disabled={change.isPending} onClick={close}>
            Cancel assignment
          </Button>
        </Flex>
      </Stack>
    </form>
  );
};
