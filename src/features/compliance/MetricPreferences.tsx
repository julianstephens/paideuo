import { Button, Flex, Grid, Heading, NativeSelect, Stack, Table, Text } from "@chakra-ui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FormField, Notice, Panel } from "../../components/ui";
import { errorMessage } from "../../lib/api/request";
import {
  checkInApi,
  checkInFieldKeys,
  checkInPreferencesKey,
  checkInSections,
} from "../recovery/recovery";
import type { PreferenceUpdate } from "../recovery/recovery";
import { metricKeys, metricLabels } from "./metrics";

const visibilityColumns = [
  { group: "hiddenSummary", label: "Weekly summary" },
  { group: "hiddenCharts", label: "Chart" },
] as const;

export const useMetricPreferences = (ownerId: string) =>
  useQuery({
    queryKey: checkInPreferencesKey(ownerId),
    queryFn: ({ signal }) => checkInApi.preferences(signal),
    retry: false,
  });

export const MetricPreferences = ({ ownerId }: { ownerId: string }) => {
  const query = useMetricPreferences(ownerId);
  const client = useQueryClient();
  const save = useMutation({
    mutationFn: (change: PreferenceUpdate) => checkInApi.updatePreferences(change),
    onSuccess: (data) => {
      client.setQueryData(checkInPreferencesKey(ownerId), data);
    },
  });
  const preferences = query.data;
  if (!preferences) {
    return query.isError ? (
      <Stack align="start">
        <Notice role="alert">Unable to load metric preferences.</Notice>
        <Button onClick={() => void query.refetch()}>Retry</Button>
      </Stack>
    ) : (
      <Notice role="status">Loading metric preferences…</Notice>
    );
  }

  return (
    <Stack gap="4">
      <Panel as="section">
        <Heading as="h2" size="md">
          Display preferences
        </Heading>
        <FormField as="div" maxW="xs">
          <label htmlFor="metrics-duration-unit">Display duration in</label>
          <NativeSelect.Root disabled={save.isPending}>
            <NativeSelect.Field
              id="metrics-duration-unit"
              value={preferences.durationUnit}
              onChange={({ target }) =>
                save.mutate({
                  group: "durationUnit",
                  durationUnit: target.value === "minutes" ? "minutes" : "hours",
                })
              }
            >
              <option value="hours">Hours</option>
              <option value="minutes">Minutes</option>
            </NativeSelect.Field>
            <NativeSelect.Indicator />
          </NativeSelect.Root>
        </FormField>
      </Panel>
      {save.isError && (
        <Notice role="alert">{errorMessage(save.error, "Unable to save preferences.")}</Notice>
      )}
      <Panel as="section">
        <Heading as="h2" size="md" id="metrics-visibility-heading">
          Dashboard visibility
        </Heading>
        <Table.Root size="sm" aria-labelledby="metrics-visibility-heading">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeader scope="col">Metric</Table.ColumnHeader>
              {visibilityColumns.map(({ group, label }) => (
                <Table.ColumnHeader key={group} scope="col" textAlign="center">
                  <Stack align="center" gap="1">
                    {label}
                    <Button
                      type="button"
                      size="xs"
                      variant="outline"
                      aria-label={`Select all metrics for ${label === "Chart" ? "dashboard charts" : "weekly summary"}`}
                      disabled={
                        save.isPending ||
                        !metricKeys.some((key) => preferences[group].includes(key))
                      }
                      onClick={() => save.mutate({ group, keys: metricKeys, enabled: true })}
                    >
                      Select all
                    </Button>
                  </Stack>
                </Table.ColumnHeader>
              ))}
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {metricKeys.map((key) => (
              <Table.Row key={key}>
                <Table.Cell as="th" scope="row">
                  {metricLabels[key]}
                </Table.Cell>
                {visibilityColumns.map(({ group }) => (
                  <Table.Cell key={group} textAlign="center" p="0">
                    <Flex as="label" justify="center" align="center" minH="10" cursor="pointer">
                      <input
                        type="checkbox"
                        aria-label={`${metricLabels[key]} in ${group === "hiddenSummary" ? "weekly summary" : "dashboard charts"}`}
                        disabled={save.isPending}
                        checked={!preferences[group].includes(key)}
                        onChange={({ target }) =>
                          save.mutate({ group, key, enabled: target.checked })
                        }
                      />
                    </Flex>
                  </Table.Cell>
                ))}
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Root>
      </Panel>
      <Panel as="section">
        <Heading as="h2" size="md">
          Daily check-in fields
        </Heading>
        <Button
          type="button"
          size="sm"
          variant="outline"
          alignSelf="start"
          aria-label="Select all daily check-in fields"
          disabled={
            save.isPending || !checkInFieldKeys.some((key) => preferences.disabled.includes(key))
          }
          onClick={() => save.mutate({ group: "disabled", keys: checkInFieldKeys, enabled: true })}
        >
          Select all
        </Button>
        <Grid templateColumns={{ base: "minmax(0, 1fr)", sm: "repeat(2, minmax(0, 1fr))" }} gap="4">
          {checkInSections.map(({ label, fields }) => (
            <Stack key={label} as="fieldset" gap="0">
              <Text as="legend" fontWeight="semibold" mb="1">
                {label}
              </Text>
              {fields.map(({ key, label: fieldLabel }) => (
                <Flex
                  key={key}
                  as="label"
                  gap="2"
                  align="center"
                  minH="9"
                  fontSize="sm"
                  cursor="pointer"
                >
                  <input
                    type="checkbox"
                    disabled={save.isPending}
                    checked={!preferences.disabled.includes(key)}
                    onChange={({ target }) =>
                      save.mutate({ group: "disabled", key, enabled: target.checked })
                    }
                  />
                  {fieldLabel}
                </Flex>
              ))}
            </Stack>
          ))}
        </Grid>
      </Panel>
    </Stack>
  );
};
