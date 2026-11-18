import { Button, Stack } from "@chakra-ui/react";
import { useQuery } from "@tanstack/react-query";
import { Notice, PageHeader, Panel } from "../../components/ui";
import { checkBackendHealth } from "../../lib/api/health";

export const CalendarPage = () => {
  const health = useQuery({
    queryKey: ["backend-health"],
    queryFn: ({ signal }) => checkBackendHealth(signal),
    retry: false,
  });

  return (
    <Stack gap="5">
      <PageHeader title="Calendar" />
      <Panel align="start">
        {health.isFetching || health.isPending ? (
          <Notice role="status">Checking PocketBase…</Notice>
        ) : health.isError ? (
          <>
            <Notice role="alert">PocketBase unavailable.</Notice>
            <Button variant="outline" onClick={() => void health.refetch()}>
              Retry connection
            </Button>
          </>
        ) : (
          <>
            <Notice>Training scheduling isn’t available yet.</Notice>
            <Notice role="status">PocketBase connected</Notice>
          </>
        )}
      </Panel>
    </Stack>
  );
};
