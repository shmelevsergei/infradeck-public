"use client";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";
export function AvailabilityChart({
  points,
}: {
  points: { time: string; latency: number }[];
}) {
  return (
    <div style={{ height: 110, width: "100%", minWidth: 0 }}>
      <ResponsiveContainer
        width="100%"
        height="100%"
        initialDimension={{ width: 400, height: 110 }}
      >
        <LineChart
          data={points}
          margin={{ top: 5, right: 12, bottom: 0, left: 0 }}
        >
          <XAxis
            dataKey="time"
            tick={{ fontSize: 9, fill: "var(--secondary)" }}
            minTickGap={45}
            stroke="var(--border)"
          />
          <YAxis
            width={35}
            tick={{ fontSize: 9, fill: "var(--secondary)" }}
            unit="ms"
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
            type="monotone"
            dataKey="latency"
            name="Latency, ms"
            stroke="var(--accent)"
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
