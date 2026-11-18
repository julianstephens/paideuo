import { Chart, useChart } from "@chakra-ui/charts";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { MetricPlotProps } from "./MetricPlot";

const MetricPlotChart = ({ title, data, series, unit, line = false, ceiling }: MetricPlotProps) => {
  const chart = useChart({ data, series });
  const number = chart.formatNumber({ maximumFractionDigits: 2 });
  const axes = [
    <CartesianGrid key="grid" vertical={false} stroke={chart.color("border.muted")} />,
    <XAxis key="x" dataKey="label" tickLine={false} minTickGap={16} />,
    <YAxis key="y" width={48} tickLine={false} domain={[0, ceiling ?? "auto"]} />,
    <Tooltip
      key="tooltip"
      cursor={false}
      content={
        <Chart.Tooltip
          formatter={(value) =>
            typeof value === "number" ? `${number(value)}${unit ? ` ${unit}` : ""}` : value
          }
        />
      }
    />,
    series.length > 1 && <Legend key="legend" content={<Chart.Legend />} />,
  ];

  return (
    <Chart.Root chart={chart} h="64" minW="0" w="full">
      {line ? (
        <LineChart responsive data={chart.data} aria-label={title}>
          {axes}
          {series.map(({ name, label, color }) => (
            <Line
              key={name}
              dataKey={name}
              name={label ?? name}
              stroke={chart.color(color)}
              strokeWidth={2}
              connectNulls={false}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      ) : (
        <BarChart responsive data={chart.data} aria-label={title}>
          {axes}
          {series.map(({ name, label, color }) => (
            <Bar
              key={name}
              dataKey={name}
              name={label ?? name}
              fill={chart.color(color)}
              radius={[3, 3, 0, 0]}
              maxBarSize={48}
              isAnimationActive={false}
            />
          ))}
        </BarChart>
      )}
    </Chart.Root>
  );
};

export default MetricPlotChart;
