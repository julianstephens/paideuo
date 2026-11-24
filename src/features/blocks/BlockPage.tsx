import { StructuralImpact } from "./StructuralImpact";
import {
  Button,
  Flex,
  Grid,
  Input,
  Link,
  NativeSelect,
  Stack,
  Text,
  Textarea,
} from "@chakra-ui/react";
import { Disclosure, FormField, Notice, PageHeader, Panel } from "../../components/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link as RouterLink, useNavigate, useParams } from "react-router";
import { useSession } from "../auth/session";
import {
  blockEditorPath,
  blocksApi,
  errorMessage,
  isProgramEditable,
  programKeys,
  programsApi,
} from "../programs/programs";
import type { BlockDetail, RemovalPreview } from "../programs/programs";
import { BlockSlots } from "./BlockSlots";
import { BlockWeeks } from "./BlockWeeks";

type BlockContext = {
  api: ReturnType<typeof blocksApi>;
  block: BlockDetail;
  sync: () => Promise<void>;
};

export const BlockPage = () => {
  const session = useSession();
  const { programId, blockId } = useParams();
  return session.status === "signed-in" && programId && blockId ? (
    <BlockEditor
      key={`${session.ownerId}/${programId}/${blockId}`}
      ownerId={session.ownerId}
      programId={programId}
      blockId={blockId}
    />
  ) : null;
};

const BlockEditor = ({
  ownerId,
  programId,
  blockId,
}: {
  ownerId: string;
  programId: string;
  blockId: string;
}) => {
  const api = blocksApi(programId, blockId);
  const queryClient = useQueryClient();
  const sync = () => queryClient.invalidateQueries({ queryKey: programKeys.owner(ownerId) });
  const block = useQuery({
    queryKey: programKeys.block(ownerId, programId, blockId),
    queryFn: ({ signal }) => api.get(signal),
    retry: false,
  });

  return (
    <Stack gap="6" minW="0">
      <Link asChild alignSelf="start" variant="underline">
        <RouterLink to={`/programs/${encodeURIComponent(programId)}`}>Back to program</RouterLink>
      </Link>
      {block.isPending && <Notice role="status">Loading block…</Notice>}
      {block.isError && (
        <Stack align="start">
          <Notice role="alert">{errorMessage(block.error, "Unable to load the block.")}</Notice>
          <Button onClick={() => void block.refetch()}>Retry</Button>
        </Stack>
      )}
      {block.data && (
        <>
          <PageHeader title={block.data.name} />
          {!block.data.editable && <Notice>This program is read-only.</Notice>}
          <Grid
            gap="5"
            alignItems="start"
            templateColumns={{ base: "minmax(0, 1fr)", "2xl": "minmax(0, 1fr) 19rem" }}
          >
            <BlockWeeks
              block={block.data}
              ownerId={ownerId}
              programId={programId}
              api={api}
              cacheKey={programKeys.block(ownerId, programId, blockId)}
              sync={sync}
            />
            <Stack gap="5" minW="0">
              <Panel>
                <Text fontWeight="semibold">
                  {block.data.durationWeeks} {block.data.durationWeeks === 1 ? "week" : "weeks"}
                </Text>
                {block.data.objective && (
                  <Text color="fg.muted" whiteSpace="pre-wrap">
                    {block.data.objective}
                  </Text>
                )}
                <Disclosure label="Block settings">
                  <BlockSettings api={api} block={block.data} sync={sync} ownerId={ownerId} />
                </Disclosure>
              </Panel>
              <BlockSlots ownerId={ownerId} api={api} block={block.data} sync={sync} />
            </Stack>
          </Grid>
        </>
      )}
    </Stack>
  );
};

const BlockSettings = (props: BlockContext & { ownerId: string }) => {
  const [form, setForm] = useState<"details" | "duration" | "duplicate">();
  const close = () => setForm(undefined);

  return (
    <Stack gap="3">
      <Flex gap="2" wrap="wrap">
        {props.block.editable && (
          <Button
            variant="outline"
            aria-expanded={form === "details"}
            disabled={form !== undefined}
            onClick={() => setForm("details")}
          >
            Edit block
          </Button>
        )}
        {props.block.editable && (
          <Button
            variant="outline"
            aria-expanded={form === "duration"}
            disabled={form !== undefined}
            onClick={() => setForm("duration")}
          >
            Change duration
          </Button>
        )}
        <Button
          variant="outline"
          aria-expanded={form === "duplicate"}
          disabled={form !== undefined}
          onClick={() => setForm("duplicate")}
        >
          Duplicate block
        </Button>
      </Flex>
      {props.block.editable && form === "details" && <DetailsForm {...props} close={close} />}
      {props.block.editable && form === "duration" && <DurationForm {...props} close={close} />}
      {form === "duplicate" && <DuplicateForm {...props} close={close} />}
    </Stack>
  );
};

type FormProps = BlockContext & { close: () => void };

const DetailsForm = ({ block, api, sync, close }: FormProps) => {
  const [name, setName] = useState(block.name);
  const [objective, setObjective] = useState(block.objective);
  const update = useMutation({
    mutationFn: api.update,
    onSuccess: async () => {
      await sync();
      close();
    },
  });

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        update.mutate({ name, objective });
      }}
    >
      <Stack gap="3" maxW="xl">
        <FormField>
          Block name
          <Input
            required
            maxLength={200}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </FormField>
        <FormField>
          Block objective
          <Textarea
            maxLength={10000}
            value={objective}
            onChange={(event) => setObjective(event.target.value)}
          />
        </FormField>
        {update.isError && (
          <Notice role="alert">
            {errorMessage(update.error, "Unable to save changes. Try again.")}
          </Notice>
        )}
        <Flex gap="2" wrap="wrap">
          <Button type="submit" loading={update.isPending}>
            Save block
          </Button>
          <Button variant="outline" disabled={update.isPending} onClick={close}>
            Cancel edit
          </Button>
        </Flex>
      </Stack>
    </form>
  );
};

const DurationForm = ({ block, api, sync, close }: FormProps) => {
  const [value, setValue] = useState(String(block.durationWeeks));
  const [review, setReview] = useState<{ duration: number; confirmation: RemovalPreview }>();
  const preview = useMutation({
    mutationFn: api.resizePreview,
    onSuccess: (confirmation, duration) => setReview({ duration, confirmation }),
  });
  const resize = useMutation({
    mutationFn: ({ duration, confirmation }: { duration: number; confirmation?: RemovalPreview }) =>
      api.resize(duration, confirmation),
    onSuccess: async () => {
      await sync();
      close();
    },
    onError: async () => {
      setReview(undefined);
      await sync();
    },
  });
  const pending = preview.isPending || resize.isPending;
  const error = resize.error ?? preview.error;

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const duration = Number(value);
        if (review && review.duration === duration) {
          resize.mutate(review);
        } else if (duration < block.durationWeeks || block.scheduled) {
          resize.reset();
          preview.mutate(duration);
        } else {
          resize.mutate({ duration });
        }
      }}
    >
      <Stack gap="3" maxW="xl">
        <FormField>
          Duration in weeks
          <Input
            required
            type="number"
            min={1}
            max={520}
            step={1}
            value={value}
            disabled={pending}
            onChange={(event) => {
              setValue(event.target.value);
              setReview(undefined);
              resize.reset();
              preview.reset();
            }}
          />
        </FormField>
        {review && review.duration < block.durationWeeks && (
          <Notice role="status">
            This will remove {review.confirmation.weekIds.length} weeks and{" "}
            {review.confirmation.prescriptionIds.length} prescriptions from the end of the block.
          </Notice>
        )}
        {review && <StructuralImpact sessions={review.confirmation.scheduledSessions} />}
        {error && (
          <Notice role="alert">
            {errorMessage(error, "Unable to change the block duration. Try again.")}
          </Notice>
        )}
        <Flex gap="2" wrap="wrap">
          <Button
            type="submit"
            loading={pending}
            disabled={Number(value) === block.durationWeeks && !review}
            colorPalette={review && review.duration < block.durationWeeks ? "red" : undefined}
          >
            {review
              ? review.duration < block.durationWeeks
                ? "Confirm shorter block"
                : "Confirm duration"
              : Number(value) < block.durationWeeks
                ? "Preview reduction"
                : block.scheduled
                  ? "Preview duration"
                  : "Save duration"}
          </Button>
          <Button variant="outline" disabled={pending} onClick={close}>
            Cancel duration change
          </Button>
        </Flex>
      </Stack>
    </form>
  );
};

const DuplicateForm = ({ api, sync, close, ownerId }: FormProps & { ownerId: string }) => {
  const [destination, setDestination] = useState("");
  const navigate = useNavigate();
  const programs = useQuery({
    queryKey: programKeys.list(ownerId),
    queryFn: ({ signal }) => programsApi.list(signal),
    retry: false,
  });
  const destinations = programs.data?.filter(({ status }) => isProgramEditable(status));
  const duplicate = useMutation({
    mutationFn: api.duplicate,
    onSuccess: async ({ programId, id }) => {
      await sync();
      void navigate(blockEditorPath(programId, id));
    },
  });

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (destination) duplicate.mutate(destination);
      }}
    >
      <Stack gap="3" maxW="xl">
        <FormField>
          Destination program
          <NativeSelect.Root disabled={duplicate.isPending}>
            <NativeSelect.Field
              value={destination}
              onChange={(event) => setDestination(event.target.value)}
            >
              <option value="">Choose a program</option>
              {destinations?.map((program) => (
                <option key={program.id} value={program.id}>
                  {program.name}
                </option>
              ))}
            </NativeSelect.Field>
            <NativeSelect.Indicator />
          </NativeSelect.Root>
        </FormField>
        {programs.isPending && <Notice role="status">Loading programs…</Notice>}
        {destinations?.length === 0 && <Text>No editable programs available.</Text>}
        {programs.isError && (
          <Flex align="center" gap="2">
            <Notice role="alert">Unable to load programs.</Notice>
            <Button size="sm" onClick={() => void programs.refetch()}>
              Retry
            </Button>
          </Flex>
        )}
        {duplicate.isError && (
          <Notice role="alert">
            {errorMessage(duplicate.error, "Unable to duplicate the block. Try again.")}
          </Notice>
        )}
        <Flex gap="2" wrap="wrap">
          <Button type="submit" disabled={!destination} loading={duplicate.isPending}>
            Create block copy
          </Button>
          <Button variant="outline" disabled={duplicate.isPending} onClick={close}>
            Cancel duplication
          </Button>
        </Flex>
      </Stack>
    </form>
  );
};
