import { Skeleton } from "@chakra-ui/react";
import { lazy, Suspense } from "react";
import { Notice } from "../../components/ui";

export type PlotPoint = { label: string; [key: string]: string | number | null };
export type PlotSeries = { name: string; label?: string; color: string };

export const plotColors = [
  "teal.solid",
  "blue.solid",
  "orange.solid",
  "purple.solid",
  "pink.solid",
];

export type MetricPlotProps = {
  title: string;
  data: PlotPoint[];
  series: PlotSeries[];
  unit?: string;
  line?: boolean;
  ceiling?: number;
};

const MetricPlotChart = lazy(() => import("./MetricPlotChart"));

export const MetricPlot = (props: MetricPlotProps) => {
  const { data, series } = props;
  if (!data.some((point) => series.some(({ name }) => typeof point[name] === "number"))) {
    return <Notice>No measurements to chart.</Notice>;
  }

  return (
    <Suspense fallback={<Skeleton h="64" aria-label="Loading chart" />}>
      <MetricPlotChart {...props} />
    </Suspense>
  );
};
