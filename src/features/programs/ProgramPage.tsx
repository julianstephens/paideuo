import {
  Badge,
  Button,
  Flex,
  Heading,
  Input,
  Link,
  NativeSelect,
  Stack,
  Text,
  Textarea,
} from "@chakra-ui/react";
import {
  Disclosure,
  FormField,
  Notice,
  PageHeader,
  Panel,
  ProgramStatusBadge,
} from "../../components/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link as RouterLink, useParams } from "react-router";
import { useSession } from "../auth/session";
import { SavedReviews } from "../reviews/SavedReviews";
import { ProgramScheduling } from "../calendar/ProgramScheduling";
import { ProgramCompliance } from "../compliance/ComplianceSummary";
import { ProgramTargets } from "../nutrition/ProgramTargets";
import { ProgramActions } from "./ProgramActions";
import { ProgramForm } from "./ProgramForm";
import {
  blockEditorPath,
  errorMessage,
  isProgramEditable,
  programKeys,
  programsApi,
} from "./programs";
import type { BlockFields, Program, ProgramFields } from "./programs";

export const ProgramPage = () => {
  const session = useSession();
  const { programId } = useParams();
  return session.status === "signed-in" && programId ? (
    <ProgramDetail
      key={`${session.ownerId}/${programId}`}
      id={programId}
      ownerId={session.ownerId}
    />
  ) : null;
};

const ProgramDetail = ({ id, ownerId }: { id: string; ownerId: string }) => {
  const program = useQuery({
    queryKey: programKeys.detail(ownerId, id),
    queryFn: ({ signal }) => programsApi.get(id, signal),
    retry: false,
  });

  return (
    <Stack gap="5" align="stretch">
      <Link asChild variant="underline" alignSelf="start">
        <RouterLink to="/programs">All programs</RouterLink>
      </Link>
      {program.isPending && <Notice role="status">Loading program…</Notice>}
      {program.isError && (
        <Stack align="start">
          <Notice role="alert">{errorMessage(program.error, "Unable to load the program.")}</Notice>
          <Button onClick={() => void program.refetch()}>Retry</Button>
        </Stack>
      )}
      {program.data && <ProgramEditor program={program.data} ownerId={ownerId} />}
    </Stack>
  );
};

const ProgramEditor = ({ program, ownerId }: { program: Program; ownerId: string }) => {
  const editable = isProgramEditable(program.status);
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const queryClient = useQueryClient();
  const sync = () => queryClient.invalidateQueries({ queryKey: programKeys.owner(ownerId) });
  const update = useMutation({
    mutationFn: (fields: ProgramFields) => programsApi.update(program.id, fields),
    onSuccess: async () => {
      await sync();
      setEditing(false);
    },
  });
  const add = useMutation({
    mutationFn: (fields: AddBlockFields) => programsApi.addBlock(program.id, fields),
    onSuccess: async () => {
      await sync();
      setAdding(false);
    },
  });
  const reorder = useMutation({
    mutationFn: (ids: string[]) => programsApi.reorder(program.id, ids),
    onSuccess: sync,
    onError: sync,
  });

  const move = (index: number, offset: number) => {
    const ids = program.blocks.map((block) => block.id);
    const destination = index + offset;
    [ids[index], ids[destination]] = [ids[destination], ids[index]];
    reorder.mutate(ids);
  };

  return (
    <>
      <PageHeader title={program.name} />
      <Panel>
        <Flex gap="2" wrap="wrap" align="center">
          <ProgramStatusBadge status={program.status} />
          <Badge colorPalette={program.scheduled ? "teal" : "gray"} variant="outline">
            {program.scheduled ? "Scheduled" : "Unscheduled"}
          </Badge>
        </Flex>
        {program.objective && <Text whiteSpace="pre-wrap">{program.objective}</Text>}
        {program.description && (
          <Text whiteSpace="pre-wrap" color="fg.muted">
            {program.description}
          </Text>
        )}
        {editable && (
          <Button
            alignSelf="start"
            variant="outline"
            aria-expanded={editing}
            disabled={update.isPending}
            onClick={() => {
              update.reset();
              setEditing((open) => !open);
            }}
          >
            {editing ? "Cancel edit" : "Edit program"}
          </Button>
        )}
        {editable && editing && (
          <Panel maxW="xl">
            <ProgramForm
              initial={program}
              buttonLabel="Save changes"
              pending={update.isPending}
              onSave={update.mutate}
              error={
                update.isError
                  ? errorMessage(update.error, "Unable to save changes. Try again.")
                  : undefined
              }
            />
          </Panel>
        )}
        <ProgramScheduling program={program} ownerId={ownerId} />
        <ProgramActions program={program} ownerId={ownerId} onDetailPage />
      </Panel>
      {program.scheduled && <ProgramCompliance ownerId={ownerId} programId={program.id} />}
      <ProgramTargets ownerId={ownerId} program={program} />
      <SavedReviews ownerId={ownerId} programId={program.id} />
      <Stack gap="3">
        <Flex justify="space-between" align="center" wrap="wrap" gap="3">
          <Heading as="h2">Blocks</Heading>
          {editable && (
            <Button
              variant={adding ? "outline" : "solid"}
              aria-expanded={adding}
              disabled={add.isPending || reorder.isPending}
              onClick={() => {
                add.reset();
                setAdding((open) => !open);
              }}
            >
              {adding ? "Cancel block" : "Add block"}
            </Button>
          )}
        </Flex>
        {editable && adding && (
          <Panel maxW="xl">
            <BlockForm
              ownerId={ownerId}
              pending={add.isPending || reorder.isPending}
              onSave={add.mutate}
              error={
                add.isError
                  ? errorMessage(add.error, "Unable to add the block. Try again.")
                  : undefined
              }
            />
          </Panel>
        )}
        {reorder.isError && (
          <Notice role="alert">
            {errorMessage(reorder.error, "Unable to save block order. Try again.")}
          </Notice>
        )}
        {program.blocks.length === 0 && <Notice>No blocks yet.</Notice>}
        {program.blocks.length > 0 && (
          <Stack as="ol" gap="3" listStyleType="none">
            {program.blocks.map((block, index) => (
              <Panel as="li" key={block.id}>
                <Heading as="h3" size="sm">
                  <Link asChild variant="underline">
                    <RouterLink to={blockEditorPath(program.id, block.id)}>
                      {block.position}. {block.name}
                    </RouterLink>
                  </Link>
                </Heading>
                <Text fontSize="sm" color="fg.muted">
                  {block.durationWeeks} {block.durationWeeks === 1 ? "week" : "weeks"}
                </Text>
                {block.objective && <Text>{block.objective}</Text>}
                {editable && (
                  <Disclosure label="Block order">
                    <Flex wrap="wrap" gap="2">
                      <Button
                        size="sm"
                        variant="outline"
                        aria-label={`Move ${block.name} up`}
                        disabled={index === 0 || reorder.isPending || add.isPending}
                        onClick={() => move(index, -1)}
                      >
                        Move up
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        aria-label={`Move ${block.name} down`}
                        disabled={
                          index === program.blocks.length - 1 || reorder.isPending || add.isPending
                        }
                        onClick={() => move(index, 1)}
                      >
                        Move down
                      </Button>
                    </Flex>
                  </Disclosure>
                )}
              </Panel>
            ))}
          </Stack>
        )}
      </Stack>
    </>
  );
};

type AddBlockFields = BlockFields & { sourceBlockId?: string };
type BlockFormProps = {
  ownerId: string;
  pending: boolean;
  error?: string;
  onSave: (fields: AddBlockFields) => void;
};

const BlockForm = ({ ownerId, pending, error, onSave }: BlockFormProps) => {
  const [name, setName] = useState("");
  const [objective, setObjective] = useState("");
  const [duration, setDuration] = useState("1");
  const [source, setSource] = useState("");
  const sources = useQuery({
    queryKey: programKeys.blockSources(ownerId),
    queryFn: ({ signal }) => programsApi.blockSources(signal),
    retry: false,
  });

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSave({
          name,
          objective,
          durationWeeks: Number(duration),
          sourceBlockId: source || undefined,
        });
      }}
    >
      <Stack gap="3">
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
        <FormField>
          Duration in weeks
          <Input
            required
            type="number"
            min={1}
            max={520}
            step={1}
            value={duration}
            onChange={(event) => setDuration(event.target.value)}
          />
        </FormField>
        <FormField>
          Weekly schedule
          <NativeSelect.Root>
            <NativeSelect.Field value={source} onChange={(event) => setSource(event.target.value)}>
              <option value="">Empty weekly schedule</option>
              {sources.data?.map((block) => (
                <option key={block.id} value={block.id}>
                  {block.programName} / {block.name}
                </option>
              ))}
            </NativeSelect.Field>
            <NativeSelect.Indicator />
          </NativeSelect.Root>
        </FormField>
        {sources.isPending && <Notice role="status">Loading block layouts…</Notice>}
        {sources.isError && (
          <Flex gap="2" align="center">
            <Notice role="alert">Unable to load block layouts.</Notice>
            <Button size="sm" onClick={() => void sources.refetch()}>
              Retry
            </Button>
          </Flex>
        )}
        {error && <Notice role="alert">{error}</Notice>}
        <Button type="submit" alignSelf="start" loading={pending}>
          Create block
        </Button>
      </Stack>
    </form>
  );
};
