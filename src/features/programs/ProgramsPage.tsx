import { Badge, Button, Flex, Heading, Link, Stack, Text } from "@chakra-ui/react";
import { Notice, PageHeader, Panel, ProgramStatusBadge } from "../../components/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link as RouterLink, useNavigate } from "react-router";
import { getAnnualPlan } from "../annual-plan/annualPlan";
import { dateKey, localToday } from "../calendar/dates";
import { useSession } from "../auth/session";
import { ProgramActions } from "./ProgramActions";
import { ProgramForm } from "./ProgramForm";
import { blockEditorPath, errorMessage, programKeys, programsApi, statuses } from "./programs";
import type { ProgramStatus } from "./programs";

export const ProgramsPage = () => {
  const session = useSession();
  return session.status === "signed-in" ? (
    <ProgramList key={session.ownerId} ownerId={session.ownerId} />
  ) : null;
};

const ProgramList = ({ ownerId }: { ownerId: string }) => {
  const [filter, setFilter] = useState<ProgramStatus | "all">("all");
  const [creating, setCreating] = useState(false);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const programs = useQuery({
    queryKey: programKeys.list(ownerId),
    queryFn: ({ signal }) => programsApi.list(signal),
    retry: false,
  });
  const today = localToday();
  const todayKey = dateKey(today);
  const year = today.getUTCFullYear();
  const hasActiveSchedule = programs.data?.some(
    ({ status, scheduled }) => status === "active" && scheduled,
  );
  const plan = useQuery({
    queryKey: [...programKeys.owner(ownerId), "annual-plan", year],
    queryFn: ({ signal }) => getAnnualPlan(year, false, signal),
    enabled: !!hasActiveSchedule,
    retry: false,
  });
  const active = programs.data?.filter(({ status }) => status === "active") ?? [];
  const currentBlocks =
    plan.data?.programs.flatMap((program) =>
      active.some(({ id }) => id === program.id)
        ? program.blocks
            .filter(({ start, end }) => start <= todayKey && todayKey <= end)
            .map((block) => ({ program, block }))
        : [],
    ) ?? [];
  const create = useMutation({
    mutationFn: programsApi.create,
    onSuccess: ({ id }) => {
      void queryClient.invalidateQueries({ queryKey: programKeys.list(ownerId) });
      void navigate(`/programs/${id}`);
    },
  });
  const visible = programs.data?.filter((program) => filter === "all" || program.status === filter);

  return (
    <Stack gap="6">
      <PageHeader
        title="Programs"
        action={
          <Button
            variant={creating ? "outline" : "solid"}
            aria-expanded={creating}
            disabled={create.isPending}
            onClick={() => {
              create.reset();
              setCreating((open) => !open);
            }}
          >
            {creating ? "Cancel" : "New program"}
          </Button>
        }
      />
      {creating && (
        <Panel maxW="xl">
          <Heading as="h2" mb="3">
            New program
          </Heading>
          <ProgramForm
            buttonLabel="Create draft"
            pending={create.isPending}
            onSave={create.mutate}
            error={
              create.isError
                ? errorMessage(create.error, "Unable to create the program. Try again.")
                : undefined
            }
          />
        </Panel>
      )}
      {currentBlocks.length > 0 ? (
        <Panel as="section">
          <Heading size="md">Current training blocks</Heading>
          {currentBlocks.map(({ program, block }) => (
            <Flex key={block.id} justify="space-between" align="center" gap="3" wrap="wrap">
              <Stack gap="1">
                <Heading as="h3" size="sm">
                  {block.name}
                </Heading>
                <Text color="fg.muted" fontSize="sm">
                  {program.name}
                </Text>
                {block.objective && <Text>{block.objective}</Text>}
              </Stack>
              <Flex gap="2" wrap="wrap">
                <Button asChild size="sm">
                  <RouterLink to={blockEditorPath(program.id, block.id)}>Open block</RouterLink>
                </Button>
                <Button asChild size="sm" variant="outline">
                  <RouterLink
                    to={`/metrics?${new URLSearchParams({ view: "block", program: program.id, block: block.id })}`}
                  >
                    Block metrics
                  </RouterLink>
                </Button>
              </Flex>
            </Flex>
          ))}
        </Panel>
      ) : (
        active.length > 0 && (
          <Panel as="section">
            <Heading size="md">Active programs</Heading>
            <Flex gap="2" wrap="wrap">
              {active.map(({ id, name }) => (
                <Button key={id} asChild variant="outline" size="sm">
                  <RouterLink to={`/programs/${id}`}>{name}</RouterLink>
                </Button>
              ))}
            </Flex>
          </Panel>
        )
      )}
      <Flex gap="2" wrap="wrap" role="group" aria-label="Filter programs">
        {(["all", ...statuses] as const).map((status) => (
          <Button
            key={status}
            size="sm"
            textTransform="capitalize"
            aria-pressed={filter === status}
            variant={filter === status ? "solid" : "outline"}
            onClick={() => setFilter(status)}
          >
            {status}
          </Button>
        ))}
      </Flex>
      {programs.isPending && <Notice role="status">Loading programs…</Notice>}
      {programs.isError && (
        <Stack align="start">
          <Notice role="alert">{errorMessage(programs.error, "Unable to load programs.")}</Notice>
          <Button onClick={() => void programs.refetch()}>Retry</Button>
        </Stack>
      )}
      {visible?.length === 0 && <Notice>No programs in this view.</Notice>}
      {visible?.map((program) => (
        <Panel as="article" key={program.id}>
          <Heading as="h2" size="md">
            <Link asChild variant="underline">
              <RouterLink to={`/programs/${program.id}`}>{program.name}</RouterLink>
            </Link>
          </Heading>
          {program.objective && <Text>{program.objective}</Text>}
          <Flex gap="3" wrap="wrap" align="center">
            <ProgramStatusBadge status={program.status} />
            <Badge colorPalette={program.scheduled ? "teal" : "gray"} variant="outline">
              {program.scheduled ? "Scheduled" : "Unscheduled"}
            </Badge>
            <Text fontSize="sm" color="fg.muted">
              {program.blockCount} {program.blockCount === 1 ? "block" : "blocks"} ·{" "}
              {program.weekCount} {program.weekCount === 1 ? "week" : "weeks"}
            </Text>
          </Flex>
          <ProgramActions program={program} ownerId={ownerId} />
        </Panel>
      ))}
    </Stack>
  );
};
