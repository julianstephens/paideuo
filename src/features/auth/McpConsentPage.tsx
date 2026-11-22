import { Button, Container, HStack, Text } from "@chakra-ui/react";
import { useState } from "react";
import { useLocation } from "react-router";
import { Notice, PageHeader, Panel } from "../../components/ui";
import { pocketbase } from "../../lib/api/pocketbase";

export const McpConsentPage = () => {
  const { search } = useLocation();
  const [pending, setPending] = useState<"allow" | "deny" | null>(null);
  const [error, setError] = useState(false);

  const respond = async (approved: boolean) => {
    setPending(approved ? "allow" : "deny");
    setError(false);
    try {
      const { redirect } = await pocketbase.send<{ redirect: string }>(
        "/api/paideuo/v1/mcp-oauth/consent",
        {
          method: "POST",
          body: { ...Object.fromEntries(new URLSearchParams(search)), approved },
        },
      );
      window.location.replace(redirect);
    } catch {
      setError(true);
      setPending(null);
    }
  };

  return (
    <Container as="main" maxW="md" py="12">
      <Panel align="start">
        <PageHeader title="Connect ChatGPT to Paideuo" />
        <Text>
          ChatGPT can read your training programs and metrics, create program drafts, import
          training data, log workouts, and submit check-ins.
        </Text>
        {error && (
          <Notice role="alert">Unable to connect. Restart setup in ChatGPT and try again.</Notice>
        )}
        <HStack gap="3">
          <Button
            loading={pending === "allow"}
            disabled={pending !== null}
            onClick={() => void respond(true)}
          >
            Allow access
          </Button>
          <Button
            variant="outline"
            loading={pending === "deny"}
            disabled={pending !== null}
            onClick={() => void respond(false)}
          >
            Deny
          </Button>
        </HStack>
      </Panel>
    </Container>
  );
};
