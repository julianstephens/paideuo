import { Notice } from "../../components/ui";
import MetricPlotChart from "./MetricPlotChart";

export type PlotPoint = { label: string; [key: string]: string | number | null };
export type PlotSeries = {
  name: string;
  label?: string;
  color: string;
  strokeDasharray?: string;
};

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
  signed?: boolean;
  tickFormatter?: (value: number) => string;
  formatValue?: (value: number, label: string) => string;
};

export const MetricPlot = (props: MetricPlotProps) => {
  const { data, series } = props;
  if (!data.some((point) => series.some(({ name }) => typeof point[name] === "number"))) {
    return <Notice>No measurements to chart.</Notice>;
  }

  return <MetricPlotChart {...props} />;
};
