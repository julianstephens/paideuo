import { Badge, Flex, Stack, Text } from "@chakra-ui/react";

const number = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
const signedNumber = new Intl.NumberFormat(undefined, {
  signDisplay: "exceptZero",
  maximumFractionDigits: 2,
});

export const comparisonDelta = (first: number | null, second: number | null) =>
  first === null || second === null ? null : second - first;

export const NumericChange = ({
  label,
  first,
  second,
  unit,
  deltaUnit = unit,
  comparable = true,
}: {
  label: string;
  first: number | null;
  second: number | null;
  unit?: string;
  deltaUnit?: string;
  comparable?: boolean;
}) => {
  const delta = comparable ? comparisonDelta(first, second) : null;
  const valueLabel = (value: number | null) =>
    value === null ? "Unavailable" : `${number.format(value)}${unit ? ` ${unit}` : ""}`;
  return (
    <Stack gap="1" bg="bg.inset" borderRadius="md" p="3">
      <Flex gap="2" wrap="wrap" justify="space-between" align="baseline">
        <Text fontWeight="semibold">{label}</Text>
        <Badge colorPalette={delta ? "teal" : "gray"} fontSize="sm">
          {delta === null
            ? "Change unavailable"
            : delta === 0
              ? "No change"
              : `${signedNumber.format(delta)}${deltaUnit ? ` ${deltaUnit}` : ""}`}
        </Badge>
      </Flex>
      <Text fontSize="sm" color="fg.muted">
        {valueLabel(first)} → {valueLabel(second)}
      </Text>
    </Stack>
  );
};
