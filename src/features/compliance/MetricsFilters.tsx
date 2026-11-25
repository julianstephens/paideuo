import { Button, Flex, Heading, NativeSelect } from "@chakra-ui/react";
import { useId } from "react";
import type { ReactNode } from "react";
import { FormField, Panel } from "../../components/ui";

export type UpdateFilters = (changes: Record<string, string | null>) => void;

export const MetricsFilters = ({
  children,
  onReset,
  resetDisabled,
}: {
  children: ReactNode;
  onReset: () => void;
  resetDisabled: boolean;
}) => (
  <Panel as="section" aria-label="Filters">
    <Flex align="center" justify="space-between" wrap="wrap" gap="2">
      <Heading as="h2" size="sm">
        Filters
      </Heading>
      <Button size="sm" variant="ghost" onClick={onReset} disabled={resetDisabled}>
        Reset filters
      </Button>
    </Flex>
    {children}
  </Panel>
);

export const FilterFields = ({ children }: { children: ReactNode }) => (
  <Flex gap="3" wrap="wrap" align="end">
    {children}
  </Flex>
);

export const FilterSelect = ({
  label,
  value,
  onChange,
  disabled,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  children: ReactNode;
}) => {
  const id = useId();
  return (
    <FormField as="div" flex="1 1 12rem" minW="0" maxW="sm">
      <label htmlFor={id}>{label}</label>
      <NativeSelect.Root disabled={disabled}>
        <NativeSelect.Field id={id} value={value} onChange={({ target }) => onChange(target.value)}>
          {children}
        </NativeSelect.Field>
        <NativeSelect.Indicator />
      </NativeSelect.Root>
    </FormField>
  );
};
