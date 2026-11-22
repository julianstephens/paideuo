import { Badge, Box, Flex, Heading, Stack, Text } from "@chakra-ui/react";
import { textDiff } from "./prescriptionChanges";
import type { FieldChange, prescriptionChanges } from "./prescriptionChanges";

type Changes = ReturnType<typeof prescriptionChanges>;

export const PrescriptionChangeBadges = ({ changes }: { changes: Changes }) => (
  <Flex gap="1" wrap="wrap">
    {changes.fields.map(({ label }) => (
      <Badge key={label} colorPalette="teal" whiteSpace="normal">
        {label} changed
      </Badge>
    ))}
    {changes.components.length > 0 && <Badge colorPalette="teal">Components changed</Badge>}
  </Flex>
);

const FieldDiff = ({ label, before, after, multiline }: FieldChange) => {
  const lines = multiline
    ? textDiff(before, after)
    : [
        ...(before === null ? [] : [{ kind: "Removed" as const, text: before }]),
        ...(after === null ? [] : [{ kind: "Added" as const, text: after }]),
      ];
  return (
    <Box borderWidth="1px" borderRadius="md" overflow="hidden">
      <Text bg="bg.inset" px="3" py="1.5" fontSize="sm" fontWeight="semibold">
        {label}
      </Text>
      <Box as="ul" listStyleType="none">
        {lines.map(({ kind, text }, index) => (
          <Flex
            as="li"
            key={index}
            gap="2"
            px="3"
            py="1"
            fontSize="sm"
            bg={
              kind === "Context" ? "bg.inset" : kind === "Removed" ? "red.subtle" : "green.subtle"
            }
            color={kind === "Context" ? "fg.muted" : kind === "Removed" ? "red.fg" : "green.fg"}
          >
            <Text as="span" aria-hidden="true" fontFamily="mono" flexShrink={0}>
              {kind === "Context" ? "⋯" : kind === "Removed" ? "−" : "+"}
            </Text>
            <Text as="span" srOnly>
              {kind}:{" "}
            </Text>
            <Text as="span" whiteSpace="pre-wrap" overflowWrap="anywhere" minW="0">
              {kind === "Context" ? "" : text || "\u00a0"}
            </Text>
          </Flex>
        ))}
      </Box>
    </Box>
  );
};

export const PrescriptionDiff = ({ changes }: { changes: Changes }) => (
  <Stack gap="2">
    {changes.fields.map((field) => (
      <FieldDiff key={field.label} {...field} />
    ))}
    {changes.components.map(({ id, name, status, fields }) => (
      <Stack key={id} gap="2" borderWidth="1px" borderRadius="lg" p="3">
        <Flex justify="space-between" align="baseline" gap="2" wrap="wrap">
          <Heading size="sm">{name}</Heading>
          <Badge
            colorPalette={status === "Removed" ? "red" : status === "Added" ? "green" : "teal"}
          >
            Component {status.toLowerCase()}
          </Badge>
        </Flex>
        {fields.map((field) => (
          <FieldDiff key={field.label} {...field} />
        ))}
      </Stack>
    ))}
  </Stack>
);
