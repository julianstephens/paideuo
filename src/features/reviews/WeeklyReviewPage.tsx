import { Button, Flex, Grid, Heading, Link, Stack, Text, Textarea } from "@chakra-ui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link as RouterLink, useParams } from "react-router";
import { FormField, Notice, PageHeader, Panel } from "../../components/ui";
import { errorMessage } from "../../lib/api/request";
import { useSession } from "../auth/session";
import { useMetricPreferences } from "../compliance/MetricPreferences";
import { metricValues, windowLabel } from "../compliance/MetricsCharts";
import { averageRpe } from "../compliance/format";
import { metricLabels } from "../compliance/metrics";
import type { DurationUnit } from "../recovery/recovery";
import { reviewKey, reviewsApi } from "./reviews";
import type { ReviewNotes, WeeklyReview } from "./reviews";

const noteLabels = {
  worked: "What worked",
  didNotWork: "What did not work",
  recoveryObservations: "Recovery observations",
  adjustments: "Planned adjustments",
} satisfies Record<keyof ReviewNotes, string>;
const noteKeys = Object.keys(noteLabels) as (keyof ReviewNotes)[];
const trends = ["sleep", "fatigue", "soreness"] as const;

export const WeeklyReviewPage = () => {
  const { programId, weekId } = useParams();
  const session = useSession();
  if (!programId || !weekId || session.status !== "signed-in") return null;
  return (
    <Review
      key={`${session.ownerId}/${programId}/${weekId}`}
      ownerId={session.ownerId}
      programId={programId}
      weekId={weekId}
    />
  );
};

const Review = ({
  ownerId,
  programId,
  weekId,
}: {
  ownerId: string;
  programId: string;
  weekId: string;
}) => {
  const client = useQueryClient();
  const listKey = reviewKey(ownerId, programId);
  const detailKey = [...listKey, weekId];
  const review = useQuery({
    queryKey: detailKey,
    queryFn: ({ signal }) => reviewsApi.get(programId, weekId, signal),
    retry: false,
  });
  const preferences = useMetricPreferences(ownerId);
  const [draft, setDraft] = useState<ReviewNotes | null>(null);
  const save = useMutation({
    mutationFn: (notes: ReviewNotes) => reviewsApi.save(programId, weekId, notes),
    onSuccess: (result) => {
      client.setQueryData(detailKey, result);
      void client.invalidateQueries({ queryKey: listKey, exact: true });
      setDraft(null);
    },
  });
  const data = review.data;
  const notes = draft ?? data?.notes;

  return (
    <Stack gap="4">
      <PageHeader title="Weekly review" />
      <Flex gap="3" wrap="wrap">
        <Link asChild variant="underline">
          <RouterLink to={`/programs/${programId}`}>
            {data?.programName ?? "Back to program"}
          </RouterLink>
        </Link>
        {data?.editorAvailable && (
          <Link asChild variant="underline">
            <RouterLink to={`/programs/${programId}/blocks/${data.blockId}`}>
              Open block editor
            </RouterLink>
          </Link>
        )}
      </Flex>
      {!data &&
        (review.isError ? (
          <Stack align="start">
            <Notice role="alert">{errorMessage(review.error, "Unable to load the review.")}</Notice>
            <Button size="sm" variant="outline" onClick={() => void review.refetch()}>
              Retry
            </Button>
          </Stack>
        ) : (
          <Notice role="status">Loading review…</Notice>
        ))}
      {data && notes && (
        <>
          <Stack gap="1">
            <Heading as="h2" size="lg">
              {data.blockLabel} · {data.label}
            </Heading>
            {data.window && <Text color="fg.muted">{windowLabel(data.window)}</Text>}
          </Stack>
          {preferences.data ? (
            <ReviewMetrics review={data} unit={preferences.data.durationUnit} />
          ) : preferences.isError ? (
            <Stack align="start">
              <Notice role="alert">Unable to load metric preferences.</Notice>
              <Button size="sm" variant="outline" onClick={() => void preferences.refetch()}>
                Retry preferences
              </Button>
            </Stack>
          ) : (
            <Notice role="status">Loading metric preferences…</Notice>
          )}
          <Panel as="section">
            <Heading as="h2" size="md">
              Review notes
            </Heading>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                save.mutate(notes);
              }}
            >
              <Stack gap="4" align="stretch">
                {noteKeys.map((key) => (
                  <FormField key={key}>
                    <label htmlFor={`review-${key}`}>{noteLabels[key]}</label>
                    <Textarea
                      id={`review-${key}`}
                      value={notes[key]}
                      maxLength={10000}
                      rows={3}
                      disabled={save.isPending}
                      onChange={({ target }) => {
                        if (save.isSuccess || save.isError) save.reset();
                        setDraft({ ...notes, [key]: target.value });
                      }}
                    />
                  </FormField>
                ))}
                {save.isError && (
                  <Notice role="alert">
                    {errorMessage(save.error, "Unable to save the review. Try again.")}
                  </Notice>
                )}
                {save.isSuccess && <Notice role="status">Review saved.</Notice>}
                <Button type="submit" alignSelf="start" loading={save.isPending}>
                  Save review
                </Button>
              </Stack>
            </form>
          </Panel>
        </>
      )}
    </Stack>
  );
};

const ReviewMetrics = ({ review, unit }: { review: WeeklyReview; unit: DurationUnit }) => {
  const { total, days, trainingAvailable } = review;
  const sections = [
    {
      label: "Planned and actual sessions",
      values: [
        { label: "Planned", display: String(total.compliance.scheduled) },
        ...metricValues("completion", total, unit),
      ],
    },
    { label: metricLabels.duration, values: metricValues("duration", total, unit) },
    { label: metricLabels.load, values: metricValues("load", total, unit) },
    {
      label: "Average session RPE",
      values: [
        {
          label: "Recorded RPE",
          display: total.averageRpe === null ? "No measurement" : averageRpe(total.averageRpe),
          coverage: `${total.measuredRpe}/${total.compliance.completed} completions measured`,
        },
      ],
    },
  ];
  const nutritionCount = Object.values(total.nutrition).reduce((sum, value) => sum + value, 0);
  return (
    <Stack gap="4">
      <Grid
        as="section"
        aria-label="Weekly training metrics"
        gap="3"
        templateColumns={{ base: "minmax(0, 1fr)", md: "repeat(2, minmax(0, 1fr))" }}
      >
        {sections.map(({ label, values }) => (
          <Panel key={label} as="article">
            <Heading as="h3" size="md">
              {label}
            </Heading>
            {trainingAvailable ? (
              <ReviewValues values={values} />
            ) : (
              <Text color="fg.muted">Training data unavailable</Text>
            )}
          </Panel>
        ))}
      </Grid>
      <Grid
        as="section"
        aria-label="Recovery and nutrition"
        gap="3"
        templateColumns={{ base: "minmax(0, 1fr)", md: "repeat(2, minmax(0, 1fr))" }}
      >
        {trends.map((metric) => (
          <Panel key={metric} as="article">
            <Heading as="h3" size="md">
              {metricLabels[metric]} trend
            </Heading>
            {days.length > 0 ? (
              <>
                <Text fontSize="sm" color="fg.muted">
                  {metricValues(metric, total, unit)[0].coverage} out of {days.length}
                </Text>
                <ReviewValues
                  values={days.map((day) => ({
                    label: day.window ? windowLabel(day.window) : day.id,
                    display: metricValues(metric, day, unit)[0].display,
                  }))}
                />
              </>
            ) : (
              <Text color="fg.muted">Check-in dates unavailable</Text>
            )}
          </Panel>
        ))}
        <Panel as="article">
          <Heading as="h3" size="md">
            {metricLabels.nutrition}
          </Heading>
          {days.length > 0 ? (
            <>
              <Text fontSize="sm" color="fg.muted">
                {nutritionCount} of {days.length} days recorded
              </Text>
              <ReviewValues values={metricValues("nutrition", total, unit)} />
            </>
          ) : (
            <Text color="fg.muted">Check-in dates unavailable</Text>
          )}
        </Panel>
      </Grid>
    </Stack>
  );
};

const ReviewValues = ({
  values,
}: {
  values: { label: string; display: string; coverage?: string }[];
}) => (
  <Stack as="dl" gap="2">
    {values.map(({ label, display, coverage }) => (
      <Grid key={label} gapX="2" templateColumns="minmax(0, 1fr) fit-content(55%)" fontSize="sm">
        <Text as="dt">{label}</Text>
        <Text as="dd" fontWeight="semibold" textAlign="end">
          {display}
        </Text>
        {coverage && (
          <Text as="dd" gridColumn="1 / -1" color="fg.muted">
            {coverage}
          </Text>
        )}
      </Grid>
    ))}
  </Stack>
);
