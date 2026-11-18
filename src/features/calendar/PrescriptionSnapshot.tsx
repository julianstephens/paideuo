import { Badge, Box, Button, Flex, Heading, Stack, Text } from "@chakra-ui/react";
import { useId, useState } from "react";
import { Disclosure } from "../../components/ui";
import { componentDraft, targetDefinitions } from "../prescriptions/components";
import type { SessionSnapshot } from "./scheduling";

export const PrescriptionSnapshot = ({
  prescription,
  compact = false,
}: {
  prescription: SessionSnapshot;
  compact?: boolean;
}) => {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const componentListId = useId();
  const hasDetails = prescription.components.some(
    ({ instructions, targets }) => instructions.trim() || Object.keys(targets ?? {}).length > 0,
  );
  const showDetails = !compact || detailsOpen;

  return (
    <Stack gap="3">
      {!compact && (
        <Text textTransform="capitalize">
          {prescription.plannedDurationMin === null
            ? "Duration unspecified"
            : `${prescription.plannedDurationMin} min`}
          {" · "}
          {prescription.plannedIntensity ?? "Intensity unspecified"}
        </Text>
      )}
      {prescription.description && <Text whiteSpace="pre-wrap">{prescription.description}</Text>}
      {!compact && prescription.notes && (
        <Stack gap="1">
          <Heading as="h3" size="sm">
            Programming notes
          </Heading>
          <Text whiteSpace="pre-wrap">{prescription.notes}</Text>
        </Stack>
      )}
      {prescription.components.length > 0 && (
        <Stack gap="2">
          <Flex align="center" justify="space-between" gap="2" wrap="wrap">
            <Heading as="h3" size="sm">
              Components
            </Heading>
            {compact && hasDetails && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                color="teal.fg"
                aria-expanded={detailsOpen}
                aria-controls={componentListId}
                onClick={() => setDetailsOpen((open) => !open)}
              >
                {detailsOpen ? "Hide details" : "Show details"}
                <Box
                  as="span"
                  aria-hidden="true"
                  boxSize="1.5"
                  borderBottomWidth="2px"
                  borderRightWidth="2px"
                  borderColor="currentColor"
                  transform={detailsOpen ? "rotate(225deg)" : "rotate(45deg)"}
                  mb={detailsOpen ? "0" : "0.5"}
                />
              </Button>
            )}
          </Flex>
          <Stack id={componentListId} as="ol" gap="2" ps="5">
            {prescription.components.map((component, index) => {
              const targets = showDetails ? componentDraft(index, component).targets : undefined;
              return (
                <Box as="li" key={index}>
                  <Flex gapX="2" wrap="wrap" align="baseline">
                    <Text fontWeight="medium">{component.name}</Text>
                    {compact && component.durationMin != null && (
                      <Text fontSize="xs" color="fg.muted">
                        {component.durationMin} min
                      </Text>
                    )}
                  </Flex>
                  {showDetails && component.instructions && (
                    <Text whiteSpace="pre-wrap">{component.instructions}</Text>
                  )}
                  <Flex gap="2" wrap="wrap">
                    {targetDefinitions.map(
                      ({ key, label }) =>
                        targets?.[key] &&
                        (!compact || key !== "duration") && (
                          <Badge key={key} whiteSpace="normal">
                            {label}{" "}
                            {key === "duration"
                              ? `${targets.duration?.[0]} min`
                              : targets[key]?.filter(Boolean).join(key === "grade" ? " – " : " ")}
                          </Badge>
                        ),
                    )}
                  </Flex>
                </Box>
              );
            })}
          </Stack>
        </Stack>
      )}
      {compact && prescription.notes && (
        <Disclosure label="Programming notes">
          <Text whiteSpace="pre-wrap">{prescription.notes}</Text>
        </Disclosure>
      )}
    </Stack>
  );
};
