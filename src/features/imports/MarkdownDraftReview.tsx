import { Badge, Box, Button, Flex, Grid, Heading, Stack, Text, Textarea } from "@chakra-ui/react";
import type { Ref } from "react";
import { Disclosure, FormField, Notice, Panel } from "../../components/ui";
import type { ProgramDraftConversion } from "./imports";

type Props = {
  draft: ProgramDraftConversion;
  headingRef: Ref<HTMLHeadingElement>;
  value: string;
  error: string | null;
  busy: boolean;
  validating: boolean;
  saved: boolean;
  onEdit: (value: string) => void;
  onReject: () => void;
  onPreview: () => void;
};

const weekdays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export const MarkdownDraftReview = ({
  draft,
  headingRef,
  value,
  error,
  busy,
  validating,
  saved,
  onEdit,
  onReject,
  onPreview,
}: Props) => {
  const { program, blocks } = draft.document.data;
  const provenance = new Map(draft.provenance.map((entry) => [entry.field, entry]));

  const sourceBadge = (field: string) => {
    const state = provenance.get(field)?.state;
    return (
      <Badge
        colorPalette={state === "extracted" ? "teal" : state === "inferred" ? "orange" : "gray"}
      >
        {state === "extracted" ? "Extracted" : state === "inferred" ? "Inferred" : "Unsupplied"}
      </Badge>
    );
  };

  return (
    <Panel as="section" gap="4">
      <Heading as="h2" size="md" ref={headingRef} tabIndex={-1}>
        Review program draft
      </Heading>
      <Grid gap="5" templateColumns={{ base: "minmax(0, 1fr)", lg: "repeat(2, minmax(0, 1fr))" }}>
        <Stack gap="3" minW="0">
          <Heading as="h3" size="sm">
            Original Markdown conversion
          </Heading>
          <Flex align="center" gap="2" wrap="wrap">
            <Text fontWeight="semibold" overflowWrap="anywhere">
              {program.name || "Untitled program"}
            </Text>
            {sourceBadge("program.name")}
          </Flex>
          {draft.issues.map((issue) => (
            <Notice key={issue.field}>{issue.message}</Notice>
          ))}
          {blocks.map((block, index) => {
            const path = `blocks[${index}]`;
            return (
              <Box key={block.externalId} borderWidth="1px" borderRadius="md" p="3">
                <Flex gap="2" align="center" wrap="wrap">
                  <Heading as="h4" size="sm" overflowWrap="anywhere">
                    {block.name || "Untitled block"}
                  </Heading>
                  {sourceBadge(`${path}.name`)}
                </Flex>
                <Text fontSize="sm" color="fg.muted" mt="1">
                  {block.weeks.length} {block.weeks.length === 1 ? "week" : "weeks"} ·{" "}
                  {block.slots.length} {block.slots.length === 1 ? "session slot" : "session slots"}
                </Text>
                <Disclosure label="Weeks and sessions">
                  <Stack gap="2" fontSize="sm">
                    {block.weeks.map((week, weekIndex) => (
                      <Flex key={week.externalId} gap="2" align="center" wrap="wrap">
                        <Text overflowWrap="anywhere">
                          Week {week.position}
                          {week.label ? ` · ${week.label}` : " · Label unsupplied"}
                        </Text>
                        {week.label && sourceBadge(`${path}.weeks[${weekIndex}].label`)}
                      </Flex>
                    ))}
                    {block.slots.map((slot, slotIndex) => (
                      <Flex key={slot.externalId} gap="2" align="center" wrap="wrap">
                        <Text overflowWrap="anywhere">
                          {slot.label} · {weekdays[slot.weekday - 1]}
                        </Text>
                        {sourceBadge(`${path}.slots[${slotIndex}].weekday`)}
                      </Flex>
                    ))}
                    <Text color="fg.muted">
                      Component prescriptions are empty in the generated draft.
                    </Text>
                  </Stack>
                </Disclosure>
              </Box>
            );
          })}
          <Disclosure label="Source evidence">
            <Stack gap="2" fontSize="sm">
              {draft.provenance.map(({ field, evidence }) => (
                <Box key={field} overflowWrap="anywhere">
                  <Flex gap="2" align="center" wrap="wrap">
                    <Text fontFamily="mono">{field}</Text>
                    {sourceBadge(field)}
                  </Flex>
                  {evidence && <Text color="fg.muted">{evidence}</Text>}
                </Box>
              ))}
            </Stack>
          </Disclosure>
        </Stack>
        <Stack gap="3" minW="0">
          <FormField>
            Program draft JSON
            <Textarea
              rows={18}
              fontFamily="mono"
              spellCheck={false}
              value={value}
              disabled={busy}
              readOnly={saved}
              onChange={(event) => onEdit(event.target.value)}
            />
          </FormField>
          {!saved && (
            <Text fontSize="sm" color="fg.muted">
              Edit the draft to supply missing values or correct inferences, then preview the
              changes before saving.
            </Text>
          )}
          {error && <Notice role="alert">{error}</Notice>}
          {!saved && (
            <Flex gap="2" wrap="wrap">
              <Button
                colorPalette="teal"
                disabled={busy || !value.trim()}
                loading={validating}
                loadingText="Validating…"
                onClick={onPreview}
              >
                Preview changes
              </Button>
              <Button variant="outline" disabled={busy} onClick={onReject}>
                Reject draft
              </Button>
            </Flex>
          )}
        </Stack>
      </Grid>
    </Panel>
  );
};
