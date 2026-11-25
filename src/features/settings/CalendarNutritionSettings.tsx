import { Button, Flex, Grid, Heading, Input, Text } from "@chakra-ui/react";
import { useState } from "react";
import { FormField, Notice, Panel } from "../../components/ui";
import { errorMessage } from "../../lib/api/request";
import { useCheckInPreferences, useSaveCheckInPreferences } from "../recovery/checkInPreferences";
import { defaultCalendarMacroTolerance } from "../recovery/recovery";

export const CalendarNutritionSettings = ({ ownerId }: { ownerId: string }) => {
  const query = useCheckInPreferences(ownerId);
  const save = useSaveCheckInPreferences(ownerId);
  const saved = query.data?.calendarMacroTolerance ?? defaultCalendarMacroTolerance;
  const [draft, setDraft] = useState<{ within: string; warning: string }>();
  const fields = draft ?? {
    within: String(saved.withinPercent),
    warning: String(saved.warningPercent),
  };
  const withinPercent = Number(fields.within);
  const warningPercent = Number(fields.warning);
  const valid =
    fields.within !== "" &&
    fields.warning !== "" &&
    Number.isFinite(withinPercent) &&
    Number.isFinite(warningPercent) &&
    withinPercent >= 0 &&
    warningPercent > withinPercent;

  return (
    <Panel as="section">
      <Heading as="h2" size="md">
        Calendar nutrition colors
      </Heading>
      <Text fontSize="sm" color="fg.muted">
        Compare past actuals with planned amounts. Teal applies through the within-range limit,
        yellow through the warning limit, and red above it. Each limit applies above and below the
        plan.
      </Text>
      {query.isError && !query.data ? (
        <>
          <Notice role="alert">Unable to load calendar nutrition colors.</Notice>
          <Button alignSelf="start" size="sm" onClick={() => void query.refetch()}>
            Retry
          </Button>
        </>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!query.data || !valid || !draft || save.isPending) return;
            save.mutate(
              {
                group: "calendarMacroTolerance",
                calendarMacroTolerance: { withinPercent, warningPercent },
              },
              { onSuccess: () => setDraft(undefined) },
            );
          }}
        >
          <Grid
            gap="3"
            templateColumns={{ base: "minmax(0, 1fr)", sm: "repeat(2, minmax(0, 1fr))" }}
            maxW="lg"
          >
            <FormField>
              Within-range limit (%)
              <Input
                type="number"
                min="0"
                step="any"
                required
                value={fields.within}
                disabled={!query.data || save.isPending}
                onChange={(event) => setDraft({ ...fields, within: event.target.value })}
              />
            </FormField>
            <FormField>
              Warning limit (%)
              <Input
                type="number"
                min="0"
                step="any"
                required
                value={fields.warning}
                disabled={!query.data || save.isPending}
                onChange={(event) => setDraft({ ...fields, warning: event.target.value })}
              />
            </FormField>
          </Grid>
          {draft && !valid && (
            <Text mt="2" fontSize="sm">
              Enter nonnegative percentages with a warning limit above the within-range limit.
            </Text>
          )}
          <Flex mt="3">
            <Button
              type="submit"
              size="sm"
              loading={save.isPending}
              disabled={!query.data || !draft || !valid}
            >
              Save nutrition colors
            </Button>
          </Flex>
        </form>
      )}
      {save.isError && (
        <Notice role="alert">
          {errorMessage(save.error, "Unable to save calendar nutrition colors.")}
        </Notice>
      )}
      {save.isSuccess && !draft && (
        <Text role="status" fontSize="sm">
          Nutrition colors saved.
        </Text>
      )}
    </Panel>
  );
};
