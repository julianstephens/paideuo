import { Button, Flex, Heading, Input, NativeSelect, Stack, Text } from "@chakra-ui/react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Link } from "react-router";
import { ConfirmationDialog } from "../../components/ConfirmationDialog";
import { FormField, Notice, Panel } from "../../components/ui";
import { errorMessage } from "../../lib/api/request";
import { blocksApi, programKeys } from "../programs/programs";
import type { Program } from "../programs/programs";
import { macroLabels, targetKey, targetMacros, targetsApi } from "./targets";
import type { EffectiveTarget, NutritionPlan, TargetLayer, TargetSelector } from "./targets";

const weekdays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const sourceLabels = {
  program: "Program",
  block: "Block",
  week: "Week",
  weekday: "Weekday",
  date: "Date",
};

export const TargetValues = ({
  target,
  showSources,
}: {
  target?: EffectiveTarget;
  showSources?: boolean;
}) => {
  if (!target?.active) {
    return showSources && target ? (
      <Text fontSize="sm">
        No active target
        {target.activationSource && ` · ${sourceLabels[target.activationSource.kind]} layer`}
      </Text>
    ) : null;
  }
  return (
    <Stack gap="0" fontSize="sm" aria-label="Macro targets">
      {targetMacros.map((key) => {
        const macro = target.macros?.[key];
        if (!macro || (!showSources && macro.value === null)) return null;
        return (
          <Text key={key}>
            {macroLabels[key]} {macro.value ?? (macro.source ? "cleared" : "unset")}
            {showSources && macro.source && ` · ${sourceLabels[macro.source.kind]}`}
          </Text>
        );
      })}
    </Stack>
  );
};

export const ProgramTargets = ({ program, ownerId }: { program: Program; ownerId: string }) => {
  const key = targetKey(ownerId, program.id);
  const plan = useQuery({
    queryKey: [...key, "plan"],
    queryFn: ({ signal }) => targetsApi.plan(program.id, signal),
  });
  const [open, setOpen] = useState(false);
  return (
    <Panel>
      <Flex align="center" justify="space-between" gap="3" wrap="wrap">
        <Heading as="h2" size="md">
          Nutrition targets
        </Heading>
        {plan.isSuccess && (
          <Button variant="outline" aria-expanded={open} onClick={() => setOpen(!open)}>
            {open ? "Close target editor" : plan.data ? "Edit targets" : "Set targets"}
          </Button>
        )}
      </Flex>
      {plan.isError && (
        <Notice role="alert">{errorMessage(plan.error, "Unable to load nutrition plan.")}</Notice>
      )}
      {open && plan.isSuccess && (
        <TargetEditor program={program} ownerId={ownerId} plan={plan.data} />
      )}
    </Panel>
  );
};

const TargetEditor = ({
  program,
  ownerId,
  plan,
}: {
  program: Program;
  ownerId: string;
  plan: NutritionPlan | null;
}) => {
  const key = targetKey(ownerId, program.id);
  const client = useQueryClient();
  const [layer, setLayer] = useState("program");
  const [previewDate, setPreviewDate] = useState<string>();
  const preview = previewDate ?? program.schedule?.startDate ?? "";
  const overrides = useQuery({
    queryKey: [...key, "overrides", plan?.id],
    queryFn: ({ signal }) => targetsApi.overrides(plan!.id, signal),
    enabled: !!plan,
  });
  const blockQueries = useQueries({
    queries: program.blocks.map((block) => ({
      queryKey: programKeys.block(ownerId, program.id, block.id),
      queryFn: ({ signal }: { signal: AbortSignal }) => blocksApi(program.id, block.id).get(signal),
      enabled: !!plan,
    })),
  });
  const weeks = blockQueries.flatMap(
    ({ data }) =>
      data?.weeks.map((week) => ({
        id: week.id,
        label: `${data.name} · Week ${week.position}`,
      })) ?? [],
  );
  const current = overrides.data?.find(({ id }) => id === layer);
  const describe = (selector: TargetSelector) => {
    if (selector.kind === "date") return selector.date;
    if (selector.kind === "block")
      return program.blocks.find(({ id }) => id === selector.blockId)?.name ?? "Removed block";
    const week = weeks.find(({ id }) => id === selector.weekId)?.label ?? "Training week";
    return selector.kind === "weekday" ? `${week} · ${weekdays[selector.weekday - 1]}` : week;
  };
  const resolved = useQuery({
    queryKey: [...key, "resolve", preview],
    queryFn: ({ signal }) => targetsApi.resolve(program.id, preview, signal),
    enabled: !!plan && !!preview,
  });
  return (
    <Stack gap="4" align="stretch">
      {plan && (
        <FormField>
          Target layer
          <NativeSelect.Root>
            <NativeSelect.Field value={layer} onChange={(e) => setLayer(e.target.value)}>
              <option value="program">Program defaults</option>
              {overrides.data?.map(({ id, data }) => (
                <option key={id} value={id}>
                  {describe(data.selector)}
                </option>
              ))}
              <option value="new">Add override</option>
            </NativeSelect.Field>
            <NativeSelect.Indicator />
          </NativeSelect.Root>
        </FormField>
      )}
      {overrides.isError && (
        <Notice role="alert">{errorMessage(overrides.error, "Unable to load overrides.")}</Notice>
      )}
      {blockQueries.some((query) => query.isError) && (
        <Notice role="alert">Some training weeks could not be loaded.</Notice>
      )}
      {(!plan || layer === "program" || layer === "new" || current) && (
        <LayerForm
          key={plan ? layer : "new-plan"}
          initial={layer === "program" ? plan?.data : current?.data}
          kind={layer === "program" ? "plans" : "targets"}
          id={layer === "program" ? plan?.id : current?.id}
          program={program}
          planId={plan?.id}
          weeks={weeks}
          onSaved={async (id) => {
            await client.invalidateQueries({ queryKey: key });
            setLayer(id ?? "program");
          }}
        />
      )}
      {plan && program.schedule && (
        <Stack gap="2" align="start">
          <FormField>
            Preview targets on
            <Input type="date" value={preview} onChange={(e) => setPreviewDate(e.target.value)} />
          </FormField>
          {resolved.isFetching && <Text role="status">Resolving targets…</Text>}
          {resolved.isError && (
            <Notice role="alert">
              {errorMessage(resolved.error, "Unable to resolve targets.")}
            </Notice>
          )}
          <TargetValues target={resolved.data} showSources />
          <Button asChild variant="outline">
            <Link to={`/?program=${program.id}&date=${preview || program.schedule.startDate}`}>
              View targets in calendar
            </Link>
          </Button>
        </Stack>
      )}
    </Stack>
  );
};

const LayerForm = ({
  initial,
  kind,
  id,
  program,
  planId,
  weeks,
  onSaved,
}: {
  initial?: TargetLayer;
  kind: "plans" | "targets";
  id?: string;
  program: Program;
  planId?: string;
  weeks: { id: string; label: string }[];
  onSaved: (id?: string) => Promise<void>;
}) => {
  const [active, setActive] = useState(
    initial?.active === undefined
      ? kind === "plans" && !id
        ? "true"
        : ""
      : String(initial.active),
  );
  const [macros, setMacros] = useState(initial?.macros ?? {});
  const [selectorKind, setSelectorKind] = useState<TargetSelector["kind"]>("block");
  const [blockId, setBlockId] = useState("");
  const [weekId, setWeekId] = useState("");
  const [weekday, setWeekday] = useState(1);
  const [date, setDate] = useState("");
  const [confirm, setConfirm] = useState(false);
  const remove = useRef<HTMLButtonElement>(null);
  const save = useMutation({
    mutationFn: ({
      change,
      operationId,
      externalId,
    }: {
      change: Parameters<typeof targetsApi.mutate>[0];
      operationId: string;
      externalId: string;
    }) => targetsApi.mutate(change, operationId, externalId),
    onSuccess: async (result, { change }) =>
      onSaved(change.kind === "targets" && change.action !== "delete" ? result.id : undefined),
  });
  const submit = (change: Parameters<typeof targetsApi.mutate>[0]) => {
    const previous = save.variables;
    if (save.isError && previous && JSON.stringify(previous.change) === JSON.stringify(change)) {
      save.mutate(previous);
      return;
    }
    save.mutate({ change, operationId: crypto.randomUUID(), externalId: crypto.randomUUID() });
  };
  const newOverride = kind === "targets" && !id;
  const selector: TargetSelector =
    selectorKind === "block"
      ? { kind: "block", blockId }
      : selectorKind === "week"
        ? { kind: "week", weekId }
        : selectorKind === "weekday"
          ? { kind: "weekday", weekId, weekday }
          : { kind: "date", date };
  const selectorReady =
    selector.kind === "block" ? !!blockId : selector.kind === "date" ? !!date : !!weekId;
  return (
    <Stack
      as="form"
      gap="3"
      onSubmit={(event) => {
        event.preventDefault();
        const data = { active: active === "" ? undefined : active === "true", macros };
        if (id) submit({ kind, action: "update", id, data });
        else if (kind === "plans") submit({ kind, action: "create", programId: program.id, data });
        else if (planId && selectorReady)
          submit({ kind, action: "create", planId, data: { ...data, selector } });
      }}
    >
      {newOverride && (
        <Stack gap="2">
          <TargetSelect
            label="Applies to"
            value={selectorKind}
            onChange={(value) => setSelectorKind(value as TargetSelector["kind"])}
          >
            <option value="block">Block</option>
            <option value="week">Training week</option>
            <option value="weekday">Weekday within a training week</option>
            <option value="date" disabled={!program.schedule}>
              Exact date
            </option>
          </TargetSelect>
          {selectorKind === "block" && (
            <TargetSelect label="Block" value={blockId} onChange={setBlockId}>
              <option value="">Select block</option>
              {program.blocks.map((block) => (
                <option key={block.id} value={block.id}>
                  {block.name}
                </option>
              ))}
            </TargetSelect>
          )}
          {(selectorKind === "week" || selectorKind === "weekday") && (
            <TargetSelect label="Training week" value={weekId} onChange={setWeekId}>
              <option value="">Select training week</option>
              {weeks.map((week) => (
                <option key={week.id} value={week.id}>
                  {week.label}
                </option>
              ))}
            </TargetSelect>
          )}
          {selectorKind === "weekday" && (
            <TargetSelect
              label="Weekday"
              value={String(weekday)}
              onChange={(value) => setWeekday(Number(value))}
            >
              {weekdays.map((day, index) => (
                <option key={day} value={index + 1}>
                  {day}
                </option>
              ))}
            </TargetSelect>
          )}
          {selectorKind === "date" && (
            <FormField>
              Date
              <Input
                type="date"
                min={program.schedule?.startDate}
                value={date}
                onChange={(e) => setDate(e.target.value)}
                required
              />
            </FormField>
          )}
        </Stack>
      )}
      <TargetSelect label="Activation" value={active} onChange={setActive}>
        <option value="">{kind === "plans" ? "Off by default" : "Inherit"}</option>
        <option value="true">On</option>
        <option value="false">Off</option>
      </TargetSelect>
      <Flex gap="3" wrap="wrap">
        {targetMacros.map((key) => {
          const value = macros[key];
          const mode = value === undefined ? "inherit" : value === null ? "clear" : "set";
          const change = (next: number | null | undefined) =>
            setMacros((previous) => ({ ...previous, [key]: next }));
          return (
            <Stack key={key} flex="1 1 10rem">
              <TargetSelect
                label={macroLabels[key]}
                value={mode}
                onChange={(next) =>
                  change(next === "inherit" ? undefined : next === "clear" ? null : 0)
                }
              >
                <option value="inherit">Inherit</option>
                <option value="clear">Clear target</option>
                <option value="set">Set target</option>
              </TargetSelect>
              {mode === "set" && (
                <Input
                  aria-label={macroLabels[key] + " target"}
                  type="number"
                  min="0"
                  max="1000000"
                  step="0.001"
                  required
                  value={Number.isNaN(value) ? "" : (value ?? "")}
                  onChange={(e) => change(e.target.valueAsNumber)}
                />
              )}
            </Stack>
          );
        })}
      </Flex>
      {save.isError && (
        <Notice role="alert">{errorMessage(save.error, "Unable to save targets.")}</Notice>
      )}
      <Flex gap="2" wrap="wrap">
        <Button type="submit" loading={save.isPending} disabled={newOverride && !selectorReady}>
          Save targets
        </Button>
        {id && (
          <Button
            ref={remove}
            type="button"
            variant="outline"
            colorPalette="red"
            disabled={save.isPending}
            onClick={() => setConfirm(true)}
          >
            {kind === "plans" ? "Remove plan" : "Remove override"}
          </Button>
        )}
      </Flex>
      {confirm && id && (
        <ConfirmationDialog
          title={kind === "plans" ? "Remove nutrition plan?" : "Remove target override?"}
          description={
            kind === "plans"
              ? "This removes the program defaults and all its target overrides."
              : "This removes this layer from target resolution."
          }
          confirmLabel="Remove"
          destructive
          returnFocus={() => remove.current}
          onDismiss={() => setConfirm(false)}
          onConfirm={() => submit({ kind, action: "delete", id })}
        />
      )}
    </Stack>
  );
};

const TargetSelect = ({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
}) => (
  <FormField>
    {label}
    <NativeSelect.Root>
      <NativeSelect.Field value={value} onChange={(e) => onChange(e.target.value)}>
        {children}
      </NativeSelect.Field>
      <NativeSelect.Indicator />
    </NativeSelect.Root>
  </FormField>
);
