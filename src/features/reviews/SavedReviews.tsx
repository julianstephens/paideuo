import { Button, Heading, Link, Stack, Text } from "@chakra-ui/react";
import { useQuery } from "@tanstack/react-query";
import { Link as RouterLink } from "react-router";
import { Notice, Panel } from "../../components/ui";
import { windowLabel } from "../compliance/MetricsCharts";
import { reviewKey, reviewsApi, weeklyReviewUrl } from "./reviews";

export const SavedReviews = ({ ownerId, programId }: { ownerId: string; programId: string }) => {
  const query = useQuery({
    queryKey: reviewKey(ownerId, programId),
    queryFn: ({ signal }) => reviewsApi.list(programId, signal),
    retry: false,
  });

  return (
    <Panel as="section">
      <Heading as="h2" size="md">
        Saved reviews
      </Heading>
      {query.isPending && <Notice role="status">Loading reviews…</Notice>}
      {query.isError && (
        <Stack align="start">
          <Notice role="alert">Unable to load saved reviews.</Notice>
          <Button size="sm" variant="outline" onClick={() => void query.refetch()}>
            Retry
          </Button>
        </Stack>
      )}
      {query.data?.length === 0 && <Text color="fg.muted">No saved reviews yet.</Text>}
      {query.data && query.data.length > 0 && (
        <Stack as="ul" gap="2" listStyleType="none">
          {query.data.map(({ weekId, blockLabel, label, window }) => (
            <Stack as="li" key={weekId} gap="0.5">
              <Link asChild variant="underline" alignSelf="start">
                <RouterLink to={weeklyReviewUrl(programId, weekId)}>
                  {blockLabel} · {label}
                </RouterLink>
              </Link>
              {window && (
                <Text fontSize="sm" color="fg.muted">
                  {windowLabel(window)}
                </Text>
              )}
            </Stack>
          ))}
        </Stack>
      )}
    </Panel>
  );
};
