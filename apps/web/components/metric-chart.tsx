"use client";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";
export function MetricChart({
  points,
  unit,
}: {
  points: { at: string; value: number }[];
  unit: string;
}) {
  return (
    <div
      style={{ height: 180, width: "100%", minWidth: 0, overflow: "hidden" }}
    >
      <ResponsiveContainer
        width="100%"
        height="100%"
        initialDimension={{ width: 400, height: 180 }}
      >
        <LineChart data={points}>
          <XAxis
            dataKey="at"
            tickFormatter={(v) => String(v).slice(11, 16)}
            minTickGap={50}
            tick={{ fontSize: 10, fill: "var(--secondary)" }}
            stroke="var(--border)"
          />
          <YAxis
            width={55}
            unit={unit}
            tick={{ fontSize: 10, fill: "var(--secondary)" }}
            stroke="var(--border)"
          />
          <Tooltip
            contentStyle={{
              background: "var(--surface)",
              borderColor: "var(--border)",
              color: "var(--text)",
            }}
            itemStyle={{ color: "var(--accent)" }}
          />
          <Line
            type="linear"
            dataKey="value"
            stroke="var(--accent)"
            dot={false}
            connectNulls={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
