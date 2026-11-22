import { Button, Flex, Grid, Heading, Stack, Text } from "@chakra-ui/react";
import { Notice, Panel } from "../../components/ui";
import { errorMessage } from "../../lib/api/request";
import { useCheckInPreferences, useSaveCheckInPreferences } from "../recovery/checkInPreferences";
import { checkInFieldKeys, checkInSections } from "../recovery/recovery";

export const CheckInFieldSettings = ({ ownerId }: { ownerId: string }) => {
  const query = useCheckInPreferences(ownerId);
  const save = useSaveCheckInPreferences(ownerId);
  const preferences = query.data;
  if (!preferences) {
    return (
      <Panel as="section">
        <Heading as="h2" size="md">
          Check-in and nutrition fields
        </Heading>
        {query.isError ? (
          <>
            <Notice role="alert">Unable to load check-in fields.</Notice>
            <Button alignSelf="start" size="sm" onClick={() => void query.refetch()}>
              Retry
            </Button>
          </>
        ) : (
          <Notice role="status">Loading check-in fields…</Notice>
        )}
      </Panel>
    );
  }

  return (
    <Panel as="section">
      <Heading as="h2" size="md">
        Check-in and nutrition fields
      </Heading>
      <Text fontSize="sm" color="fg.muted">
        Choose which fields appear in the pre-training check-in and nutrition log.
      </Text>
      <Button
        type="button"
        size="sm"
        variant="outline"
        alignSelf="start"
        aria-label="Select all check-in and nutrition fields"
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
      {save.isError && (
        <Notice role="alert">
          {errorMessage(save.error, "Unable to update check-in fields.")}
        </Notice>
      )}
    </Panel>
  );
};
