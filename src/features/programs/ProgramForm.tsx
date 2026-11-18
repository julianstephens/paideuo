import { Button, Input, Stack, Textarea } from "@chakra-ui/react";
import { FormField, Notice } from "../../components/ui";
import { useState } from "react";
import type { FormEvent } from "react";
import type { ProgramFields } from "./programs";

type Props = {
  initial?: ProgramFields;
  buttonLabel: string;
  pending: boolean;
  error?: string;
  onSave: (fields: ProgramFields) => void;
};

export const ProgramForm = ({ initial, buttonLabel, pending, error, onSave }: Props) => {
  const [fields, setFields] = useState<ProgramFields>(() => ({
    name: initial?.name ?? "",
    description: initial?.description ?? "",
    objective: initial?.objective ?? "",
  }));

  const setField = (field: keyof ProgramFields, value: string) =>
    setFields((previous) => ({ ...previous, [field]: value }));

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSave(fields);
  };

  return (
    <form onSubmit={submit}>
      <Stack gap="3" align="stretch">
        <FormField>
          Name
          <Input
            required
            maxLength={200}
            value={fields.name}
            onChange={(event) => setField("name", event.target.value)}
          />
        </FormField>
        <FormField>
          Objective
          <Textarea
            maxLength={10000}
            value={fields.objective}
            onChange={(event) => setField("objective", event.target.value)}
          />
        </FormField>
        <FormField>
          Description
          <Textarea
            maxLength={10000}
            value={fields.description}
            onChange={(event) => setField("description", event.target.value)}
          />
        </FormField>
        {error && <Notice role="alert">{error}</Notice>}
        <Button alignSelf="start" type="submit" loading={pending}>
          {buttonLabel}
        </Button>
      </Stack>
    </form>
  );
};
