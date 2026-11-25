import { Button, Flex, Heading, Input, Stack, Text } from "@chakra-ui/react";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { FormField, Notice, Panel } from "../../components/ui";
import { errorMessage } from "../../lib/api/request";
import { openAIQueryKey, removeOpenAIKey, saveOpenAISettings, useOpenAIStatus } from "./openai";

export const OpenAISettings = ({ ownerId }: { ownerId: string }) => {
  const status = useOpenAIStatus(ownerId);
  const queryClient = useQueryClient();
  const [apiKey, setApiKey] = useState("");
  const [modelDraft, setModelDraft] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const model = modelDraft ?? status.data?.model ?? "";

  const update = async (remove: boolean) => {
    setBusy(true);
    setError("");
    try {
      const result = remove
        ? await removeOpenAIKey()
        : await saveOpenAISettings({ model: model.trim(), apiKey: apiKey.trim() || undefined });
      const queryKey = openAIQueryKey(ownerId);
      await queryClient.cancelQueries({ queryKey });
      queryClient.setQueryData(queryKey, result);
      setApiKey("");
      setModelDraft(undefined);
    } catch (cause) {
      setError(errorMessage(cause, "Unable to update OpenAI settings."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel as="section" gap="3">
      <Heading as="h2" size="md">
        OpenAI
      </Heading>
      <Text fontSize="sm" color="fg.muted">
        Macro prediction sends the title, category, serving description, serving size, serving unit,
        and any food description to OpenAI using your API key.
      </Text>
      {status.isPending && <Notice role="status">Loading OpenAI settings…</Notice>}
      {status.isError && (
        <Notice role="alert">
          Unable to load OpenAI settings.
          <Button variant="ghost" size="sm" onClick={() => void status.refetch()}>
            Retry
          </Button>
        </Notice>
      )}
      {status.data && !status.data.available && (
        <Notice role="status">
          To enable API key entry, set PAIDEUO_OPENAI_ENCRYPTION_KEY to a 32-character secret in the
          PocketBase environment and restart PocketBase.
        </Notice>
      )}
      {status.data && (status.data.available || status.data.configured) && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void update(false);
          }}
        >
          <Stack gap="3">
            <Text role="status" fontSize="sm">
              {status.data.configured ? "API key saved." : "No API key saved."}
            </Text>
            <FormField>
              OpenAI API key
              <Input
                type="password"
                autoComplete="new-password"
                value={apiKey}
                maxLength={500}
                placeholder={
                  status.data.configured ? "Enter a new key to replace the saved key" : undefined
                }
                required={!status.data.configured}
                disabled={busy || !status.data.available}
                onChange={(event) => setApiKey(event.target.value)}
              />
            </FormField>
            <FormField>
              Model ID
              <Input
                value={model}
                maxLength={200}
                required
                disabled={busy || !status.data.available}
                onChange={(event) => setModelDraft(event.target.value)}
              />
            </FormField>
            {error && <Notice role="alert">{error}</Notice>}
            <Flex gap="2" wrap="wrap">
              <Button
                type="submit"
                loading={busy}
                disabled={
                  busy ||
                  !status.data.available ||
                  !model.trim() ||
                  (!apiKey.trim() && !status.data.configured)
                }
              >
                Save OpenAI settings
              </Button>
              {status.data.configured && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void update(true)}
                >
                  Remove API key
                </Button>
              )}
            </Flex>
          </Stack>
        </form>
      )}
    </Panel>
  );
};
