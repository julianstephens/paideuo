import { Button, Heading, Text } from "@chakra-ui/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { Notice, Panel } from "../../components/ui";
import { apiRequest, errorMessage } from "../../lib/api/request";

const endpoint = "/api/paideuo/v1/google-health";
const storageKey = (ownerId: string) => `paideuo:google-health:state:${ownerId}`;

export const GoogleHealthSettings = ({ ownerId }: { ownerId: string }) => {
  const [search, setSearch] = useSearchParams();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const handledCallback = useRef(false);
  const status = useQuery({
    queryKey: ["google-health", ownerId],
    queryFn: ({ signal }) =>
      apiRequest<{ available: boolean; connected: boolean }>(endpoint, "GET", undefined, signal),
    retry: false,
  });

  useEffect(() => {
    const state = search.get("state");
    const code = search.get("code");
    const denied = search.has("error");
    if ((!state && !code && !denied) || handledCallback.current) return;

    handledCallback.current = true;
    const cleaned = new URLSearchParams(search);
    for (const field of [
      "state",
      "code",
      "error",
      "error_description",
      "scope",
      "authuser",
      "prompt",
      "iss",
    ]) {
      cleaned.delete(field);
    }
    setSearch(cleaned, { replace: true });

    const complete = async () => {
      setBusy(true);
      try {
        const expectedState = sessionStorage.getItem(storageKey(ownerId));
        if (!state || state !== expectedState) {
          setError("Start a new Google Health connection from this tab.");
          return;
        }
        sessionStorage.removeItem(storageKey(ownerId));
        await apiRequest(`${endpoint}/complete`, "POST", { state, code, denied });
        await queryClient.invalidateQueries({ queryKey: ["google-health", ownerId] });
      } catch (cause) {
        setError(errorMessage(cause, "Unable to connect Google Health."));
      } finally {
        setBusy(false);
      }
    };
    void complete();
  }, [ownerId, queryClient, search, setSearch]);

  const connect = async () => {
    setError(null);
    setBusy(true);
    try {
      const result = await apiRequest<{ state: string; authorizationUrl: string }>(
        `${endpoint}/start`,
        "POST",
      );
      sessionStorage.setItem(storageKey(ownerId), result.state);
      window.location.assign(result.authorizationUrl);
    } catch (cause) {
      setError(errorMessage(cause, "Unable to start the Google Health connection."));
      setBusy(false);
    }
  };

  return (
    <Panel as="section" align="start" gap="3">
      <Heading as="h2" size="md">
        Google Health
      </Heading>
      {error && <Notice role="alert">{error}</Notice>}
      {status.isError && (
        <Notice role="alert">Unable to load the Google Health connection status.</Notice>
      )}
      {(status.isPending || busy) && <Notice role="status">Checking Google Health…</Notice>}
      {status.data?.connected && <Text role="status">Connected</Text>}
      {status.data &&
        !status.data.connected &&
        (status.data.available ? (
          <>
            <Text fontSize="sm" color="fg.muted">
              Set up your profile in the Google Health app with the Google Account you want to
              connect.
            </Text>
            <Button colorPalette="teal" disabled={busy} onClick={() => void connect()}>
              Connect Google Health
            </Button>
          </>
        ) : (
          <Text fontSize="sm" color="fg.muted">
            Google Health is unavailable on this server.
          </Text>
        ))}
    </Panel>
  );
};
