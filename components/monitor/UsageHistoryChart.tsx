"use client";

import { useMemo, useState } from "react";
import type { MouseEvent, TouchEvent } from "react";

import type {
  ProviderType,
  ResetMarker,
  UsageHistoryPoint,
  UsageHistoryResponse,
  WindowKey,
} from "@/lib/usage-monitor/types";

const EMPHASIS_KEYS: WindowKey[] = ["five_hour", "seven_day"];
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const CLAUDE_PROVIDER_COLOR = "#D97732";
const GPT_PROVIDER_COLOR = "#12B981";

const CLAUDE_ACCOUNT_COLORS: Record<string, string> = {
  ociomirae: "#FF6B35",
  ociomirae1: "#2563EB",
  ociomirae2: "#16A34A",
  ociomirae3: "#DB2777",
  ociomirae5: "#EAB308",
  ociomirae6: "#7C3AED",
};

const GPT_ACCOUNT_COLORS: Record<string, string> = {
  ociomirae1: "#06B6D4",
  "dominic.d.cha": "#F43F5E",
};

const CLAUDE_FALLBACK_COLORS = [
  "#FF6B35",
  "#2563EB",
  "#16A34A",
  "#DB2777",
  "#EAB308",
  "#7C3AED",
  "#0891B2",
  "#DC2626",
  "#4F46E5",
  "#65A30D",
];

const GPT_FALLBACK_COLORS = [
  "#06B6D4",
  "#F43F5E",
  "#8B5CF6",
  "#10B981",
  "#F97316",
  "#84CC16",
  "#3B82F6",
  "#EC4899",
];

interface LegendAccount {
  accountId: string;
  displayName: string;
  provider: ProviderType;
  color: string;
}

interface LegendGroup {
  provider: ProviderType;
  label: string;
  accent: string;
  background: string;
  border: string;
  accounts: LegendAccount[];
}

interface TimeTick {
  atMs: number;
  x: number;
  label: string;
  isMajor: boolean;
}

interface ProjectedPoint extends UsageHistoryPoint {
  x: number;
  y: number;
}

interface ProjectedSeries {
  accountId: string;
  accountName: string;
  displayName: string;
  provider: ProviderType;
  windowKey: WindowKey;
  color: string;
  points: ProjectedPoint[];
  path: string;
}

interface ResetAnnotation extends ResetMarker {
  x: number;
  y: number;
  label: string;
  badgeLabel: string;
  color: string;
  width: number;
}

interface HoverInfo {
  kind: "series" | "reset";
  x: number;
  y: number;
  color: string;
  accountName: string;
  provider: ProviderType;
  windowKey?: WindowKey;
  utilization?: number;
  bucketStart?: string;
  resetAt?: string;
  values?: Partial<Record<WindowKey, number>>;
}

function formatWindowLabel(windowKey: WindowKey): string {
  return windowKey === "five_hour" ? "5h" : "7d";
}

function timeTickStepMs(rangeMs: number): number {
  if (rangeMs <= 36 * HOUR_MS) return HOUR_MS;
  if (rangeMs <= 8 * DAY_MS) return 6 * HOUR_MS;
  if (rangeMs <= 35 * DAY_MS) return DAY_MS;

  const targetTicks = 28;
  const rawStep = rangeMs / targetTicks;
  const steps = [
    DAY_MS,
    2 * DAY_MS,
    3 * DAY_MS,
    7 * DAY_MS,
    14 * DAY_MS,
    30 * DAY_MS,
    90 * DAY_MS,
  ];
  return steps.find((step) => step >= rawStep) || 90 * DAY_MS;
}

function formatXAxisTick(
  atMs: number,
  stepMs: number,
  rangeMs: number,
): string {
  const date = new Date(atMs);
  if (rangeMs <= 36 * HOUR_MS) {
    if (date.getHours() === 0) {
      return date.toLocaleString(undefined, {
        month: "numeric",
        day: "numeric",
        hour: "numeric",
      });
    }
    return date.toLocaleTimeString(undefined, { hour: "numeric" });
  }
  if (stepMs < DAY_MS) {
    return date.toLocaleString(undefined, {
      month: "numeric",
      day: "numeric",
      hour: "numeric",
    });
  }
  return date.toLocaleDateString(undefined, {
    month: "numeric",
    day: "numeric",
  });
}

function formatTooltipTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatPercent(value: number | undefined): string {
  if (value == null || !Number.isFinite(value)) return "n/a";
  return `${value.toFixed(value % 1 === 0 ? 0 : 1)}%`;
}

function truncateLabel(value: string, maxLength: number): string {
  return value.length > maxLength
    ? `${value.slice(0, maxLength - 3)}...`
    : value;
}

function buildXAxisTicks(
  rangeStart: number,
  rangeEnd: number,
  marginLeft: number,
  innerWidth: number,
): TimeTick[] {
  const rangeMs = Math.max(rangeEnd - rangeStart, HOUR_MS);
  const stepMs = timeTickStepMs(rangeMs);
  const firstTick = Math.ceil(rangeStart / stepMs) * stepMs;
  const ticks: TimeTick[] = [];

  for (let atMs = firstTick; atMs <= rangeEnd; atMs += stepMs) {
    const date = new Date(atMs);
    ticks.push({
      atMs,
      x: marginLeft + ((atMs - rangeStart) / rangeMs) * innerWidth,
      label: formatXAxisTick(atMs, stepMs, rangeMs),
      isMajor: date.getHours() === 0 || stepMs >= DAY_MS,
    });
  }

  return ticks;
}

function nearestProjectedPoint(
  points: ProjectedPoint[],
  x: number,
): ProjectedPoint | null {
  if (points.length === 0) return null;
  return points.reduce(
    (nearest, point) =>
      Math.abs(point.x - x) < Math.abs(nearest.x - x) ? point : nearest,
    points[0],
  );
}

function svgPointFromMouse(
  event: MouseEvent<SVGPathElement>,
  width: number,
  height: number,
): { x: number; y: number } | null {
  return svgPointFromClient(
    event.currentTarget.ownerSVGElement,
    event.clientX,
    event.clientY,
    width,
    height,
  );
}

function svgPointFromTouch(
  event: TouchEvent<SVGPathElement>,
  width: number,
  height: number,
): { x: number; y: number } | null {
  const touch = event.touches[0] || event.changedTouches[0];
  if (!touch) return null;
  return svgPointFromClient(
    event.currentTarget.ownerSVGElement,
    touch.clientX,
    touch.clientY,
    width,
    height,
  );
}

function svgPointFromClient(
  svg: SVGSVGElement | null,
  clientX: number,
  clientY: number,
  width: number,
  height: number,
): { x: number; y: number } | null {
  if (!svg) return null;
  const rect = svg.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  return {
    x: ((clientX - rect.left) / rect.width) * width,
    y: ((clientY - rect.top) / rect.height) * height,
  };
}

function resetAnnotationWidth(label: string): number {
  return Math.min(168, Math.max(74, label.length * 7.2 + 24));
}

function buildResetAnnotations({
  markers,
  rangeStart,
  rangeEnd,
  marginLeft,
  innerWidth,
  accountColorById,
}: {
  markers: ResetMarker[];
  rangeStart: number;
  rangeEnd: number;
  marginLeft: number;
  innerWidth: number;
  accountColorById: Map<string, string>;
}): ResetAnnotation[] {
  const totalRange = Math.max(rangeEnd - rangeStart, 1);
  const latestMarkerByAccount = new Map<string, ResetMarker>();
  const laneEnds = [
    Number.NEGATIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ];

  for (const marker of markers) {
    const markerTs = Date.parse(marker.at);
    if (
      !Number.isFinite(markerTs) ||
      markerTs < rangeStart ||
      markerTs > rangeEnd
    ) {
      continue;
    }
    const previous = latestMarkerByAccount.get(marker.accountId);
    if (!previous || markerTs > Date.parse(previous.at)) {
      latestMarkerByAccount.set(marker.accountId, marker);
    }
  }

  return Array.from(latestMarkerByAccount.values())
    .map((marker) => {
      const markerTs = Date.parse(marker.at);
      const label = compactAccountName(marker.accountName);
      const badgeLabel = `${label} / ${providerShortLabel(marker.provider)}`;
      const width = resetAnnotationWidth(badgeLabel);
      const x =
        marginLeft + ((markerTs - rangeStart) / totalRange) * innerWidth;
      return {
        ...marker,
        x,
        y: 0,
        label,
        badgeLabel,
        width,
        color:
          accountColorById.get(marker.accountId) ||
          providerAccent(marker.provider),
      };
    })
    .filter(
      (annotation): annotation is Omit<ResetAnnotation, "y"> & { y: number } =>
        annotation !== null,
    )
    .sort((left, right) => left.x - right.x)
    .map((annotation) => {
      const lane = laneEnds.findIndex(
        (end) => annotation.x - annotation.width / 2 > end + 8,
      );
      const resolvedLane =
        lane >= 0 ? lane : laneEnds.indexOf(Math.min(...laneEnds));
      laneEnds[resolvedLane] = annotation.x + annotation.width / 2;
      return {
        ...annotation,
        y: 10 + resolvedLane * 22,
      };
    });
}

function compactAccountName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "account";
  const atIndex = trimmed.indexOf("@");
  if (atIndex > 0) {
    return trimmed.slice(0, atIndex);
  }
  return trimmed;
}

function providerLabel(provider: ProviderType): string {
  return provider === "claude" ? "Claude" : "GPT";
}

function providerShortLabel(provider: ProviderType): string {
  return provider === "claude" ? "claude" : "gpt";
}

function providerAccent(provider: ProviderType): string {
  return provider === "claude" ? CLAUDE_PROVIDER_COLOR : GPT_PROVIDER_COLOR;
}

function providerBackground(provider: ProviderType): string {
  return provider === "claude"
    ? "rgba(217,119,50,0.10)"
    : "rgba(18,185,129,0.10)";
}

function providerBorder(provider: ProviderType): string {
  return provider === "claude"
    ? "rgba(217,119,50,0.26)"
    : "rgba(18,185,129,0.26)";
}

function withAlpha(hex: string, alpha: number): string {
  const normalized = hex.replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) return hex;
  const red = parseInt(normalized.slice(0, 2), 16);
  const green = parseInt(normalized.slice(2, 4), 16);
  const blue = parseInt(normalized.slice(4, 6), 16);
  return `rgba(${red},${green},${blue},${alpha})`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function polylinePath(points: Array<{ x: number; y: number }>): string {
  if (points.length === 0) return "";
  return points
    .map(
      (point, index) =>
        `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`,
    )
    .join(" ");
}

function paletteIndex(input: string, length: number): number {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash) % length;
}

function resolveAccountColor(
  provider: ProviderType,
  accountId: string,
  accountName: string,
): string {
  const compactName = compactAccountName(accountName).toLowerCase();
  const explicitColor =
    provider === "claude"
      ? CLAUDE_ACCOUNT_COLORS[compactName]
      : GPT_ACCOUNT_COLORS[compactName];
  if (explicitColor) return explicitColor;

  const palette =
    provider === "claude" ? CLAUDE_FALLBACK_COLORS : GPT_FALLBACK_COLORS;
  return (
    palette[
      paletteIndex(`${provider}:${accountId}:${compactName}`, palette.length)
    ] || providerAccent(provider)
  );
}

export default function UsageHistoryChart({
  history,
  emphasis,
  onEmphasisChange,
  title,
  emptyLabel = "No history yet.",
}: {
  history: UsageHistoryResponse | null;
  emphasis: WindowKey;
  onEmphasisChange: (key: WindowKey) => void;
  title: string;
  emptyLabel?: string;
}) {
  const [focusedProvider, setFocusedProvider] = useState<ProviderType | null>(
    null,
  );
  const [focusedAccountIds, setFocusedAccountIds] = useState<string[]>([]);
  const [hoverInfo, setHoverInfo] = useState<HoverInfo | null>(null);

  const chart = useMemo(() => {
    if (!history?.series?.length) return null;

    const width = 1180;
    const height = 540;
    const margin = { top: 112, right: 96, bottom: 96, left: 88 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;
    const rangeStart = Date.parse(history.range.startIso);
    const rangeEnd = Date.parse(history.range.endIso);
    const totalRange = Math.max(rangeEnd - rangeStart, 1);

    const projectedSeries = history.series
      .filter((series) => EMPHASIS_KEYS.includes(series.windowKey))
      .map((series) => {
        const displayName = compactAccountName(series.accountName);
        const color = resolveAccountColor(
          series.provider,
          series.accountId,
          series.accountName,
        );
        const points = series.points
          .map((point) => {
            const pointTs = Date.parse(point.bucketStart);
            const x =
              margin.left + ((pointTs - rangeStart) / totalRange) * innerWidth;
            const y =
              margin.top +
              innerHeight -
              (clamp(point.utilization, 0, 100) / 100) * innerHeight;
            return {
              ...point,
              x,
              y,
            };
          })
          .filter(
            (point) => Number.isFinite(point.x) && Number.isFinite(point.y),
          );

        return {
          ...series,
          displayName,
          color,
          points,
          path: polylinePath(points),
        };
      })
      .filter((series) => series.points.length > 0)
      .sort((left, right) => {
        const leftWeight = left.windowKey === emphasis ? 1 : 0;
        const rightWeight = right.windowKey === emphasis ? 1 : 0;
        if (leftWeight !== rightWeight) return leftWeight - rightWeight;
        if (left.provider !== right.provider)
          return left.provider.localeCompare(right.provider);
        return left.displayName.localeCompare(right.displayName);
      });

    const legendAccountMap = new Map<string, LegendAccount>();
    const accountColorById = new Map<string, string>();
    for (const series of projectedSeries) {
      accountColorById.set(series.accountId, series.color);
      if (!legendAccountMap.has(series.accountId)) {
        legendAccountMap.set(series.accountId, {
          accountId: series.accountId,
          displayName: series.displayName,
          provider: series.provider,
          color: series.color,
        });
      }
    }

    const legendGroups: LegendGroup[] = (["claude", "openai"] as const)
      .map((provider) => ({
        provider,
        label: providerLabel(provider),
        accent: providerAccent(provider),
        background: providerBackground(provider),
        border: providerBorder(provider),
        accounts: Array.from(legendAccountMap.values())
          .filter((account) => account.provider === provider)
          .sort((left, right) =>
            left.displayName.localeCompare(right.displayName),
          ),
      }))
      .filter((group) => group.accounts.length > 0);

    return {
      width,
      height,
      margin,
      innerWidth,
      innerHeight,
      projectedSeries,
      legendGroups,
      accountColorById,
      xAxisTicks: buildXAxisTicks(
        rangeStart,
        rangeEnd,
        margin.left,
        innerWidth,
      ),
      resetAnnotations: buildResetAnnotations({
        markers: history.resetMarkers,
        rangeStart,
        rangeEnd,
        marginLeft: margin.left,
        innerWidth,
        accountColorById,
      }),
      ticks: [0, 25, 50, 75, 100],
    };
  }, [emphasis, history]);

  if (!chart) {
    return (
      <div className="glass-card rounded-xl p-5 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-xl font-black text-[var(--text-heading)]">
            {title}
          </h2>
          <EmphasisToggle emphasis={emphasis} onChange={onEmphasisChange} />
        </div>
        <p className="text-sm text-[var(--text-dim)]">{emptyLabel}</p>
      </div>
    );
  }

  const visibleFocusedAccountIds = focusedAccountIds.filter((accountId) =>
    chart.accountColorById.has(accountId),
  );
  const focusedAccountIdSet = new Set(visibleFocusedAccountIds);
  const hasAccountFocus = focusedAccountIdSet.size > 0;
  const hasFocus = hasAccountFocus || focusedProvider !== null;
  const isActive = (accountId: string, provider: ProviderType) => {
    if (hasAccountFocus) return focusedAccountIdSet.has(accountId);
    if (focusedProvider) return focusedProvider === provider;
    return true;
  };
  const toggleProviderFocus = (provider: ProviderType) => {
    setFocusedAccountIds([]);
    setFocusedProvider((previous) => (previous === provider ? null : provider));
  };
  const toggleAccountFocus = (accountId: string) => {
    setFocusedProvider(null);
    setFocusedAccountIds((previous) =>
      previous.includes(accountId)
        ? previous.filter((id) => id !== accountId)
        : [...previous, accountId],
    );
  };
  const clearFocus = () => {
    setFocusedProvider(null);
    setFocusedAccountIds([]);
  };
  const renderedSeries = [...chart.projectedSeries].sort((left, right) => {
    const leftActive = isActive(left.accountId, left.provider) ? 1 : 0;
    const rightActive = isActive(right.accountId, right.provider) ? 1 : 0;
    return leftActive - rightActive;
  });
  const showSeriesTooltip = (
    series: ProjectedSeries,
    cursor: { x: number; y: number },
  ) => {
    const point = nearestProjectedPoint(series.points, cursor.x);
    if (!point) return;

    const values: Partial<Record<WindowKey, number>> = {};
    for (const candidate of chart.projectedSeries) {
      if (candidate.accountId !== series.accountId) continue;
      if (!EMPHASIS_KEYS.includes(candidate.windowKey)) continue;
      values[candidate.windowKey] = nearestProjectedPoint(
        candidate.points,
        cursor.x,
      )?.utilization;
    }

    setHoverInfo({
      kind: "series",
      x: point.x,
      y: point.y,
      color: series.color,
      accountName: series.displayName,
      provider: series.provider,
      windowKey: series.windowKey,
      utilization: point.utilization,
      bucketStart: point.bucketStart,
      values,
    });
  };
  const showResetTooltip = (marker: ResetAnnotation) => {
    setHoverInfo({
      kind: "reset",
      x: marker.x,
      y: marker.y + 10,
      color: marker.color,
      accountName: marker.label,
      provider: marker.provider,
      resetAt: marker.at,
    });
  };
  const handleSeriesHover = (
    event: MouseEvent<SVGPathElement>,
    series: ProjectedSeries,
  ) => {
    const cursor = svgPointFromMouse(event, chart.width, chart.height);
    if (!cursor) return;
    showSeriesTooltip(series, cursor);
  };
  const handleSeriesTouch = (
    event: TouchEvent<SVGPathElement>,
    series: ProjectedSeries,
  ) => {
    const cursor = svgPointFromTouch(event, chart.width, chart.height);
    if (!cursor) return;
    showSeriesTooltip(series, cursor);
  };
  const handleSeriesFocus = (series: ProjectedSeries) => {
    const point = series.points.at(-1);
    if (!point) return;
    showSeriesTooltip(series, point);
  };

  return (
    <div className="glass-card rounded-xl p-5 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="space-y-1">
          <h2 className="text-xl font-black text-[var(--text-heading)]">
            {title}
          </h2>
          <p className="text-base font-semibold text-[var(--text-muted)]">
            Click Claude/GPT to focus a provider. Click account pills to
            multi-select accounts. 5h is solid, 7d is dashed.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <EmphasisToggle emphasis={emphasis} onChange={onEmphasisChange} />
          {hasFocus ? (
            <button
              type="button"
              onClick={clearFocus}
              className="rounded-full border border-[var(--border-card)] bg-[var(--surface-raised)] px-4 py-2 text-base font-bold text-[var(--text-secondary)] transition-all hover:text-[var(--text-heading)]"
            >
              Clear focus
            </button>
          ) : null}
        </div>
      </div>

      <div className="space-y-2">
        {chart.legendGroups.map((group) => (
          <ProviderLegendGroup
            key={group.provider}
            group={group}
            focusedProvider={focusedProvider}
            hasAccountFocus={hasAccountFocus}
            focusedAccountIdSet={focusedAccountIdSet}
            isActive={isActive}
            onProviderClick={toggleProviderFocus}
            onAccountClick={toggleAccountFocus}
          />
        ))}
      </div>

      <div className="rounded-xl border border-[var(--border-card)] bg-[var(--surface-raised)] p-3 sm:p-4 overflow-hidden">
        <svg
          viewBox={`0 0 ${chart.width} ${chart.height}`}
          className="block w-full h-auto"
          role="img"
          aria-label={title}
          onMouseLeave={() => setHoverInfo(null)}
        >
          <rect
            x="0"
            y="0"
            width={chart.width}
            height={chart.height}
            fill="transparent"
          />

          <line
            x1={chart.margin.left}
            x2={chart.width - chart.margin.right}
            y1={chart.margin.top + chart.innerHeight}
            y2={chart.margin.top + chart.innerHeight}
            stroke="var(--border-card)"
            strokeWidth="1.3"
          />

          {chart.xAxisTicks.map((tick) => (
            <g key={tick.atMs}>
              <line
                x1={tick.x}
                x2={tick.x}
                y1={chart.margin.top}
                y2={chart.margin.top + chart.innerHeight}
                stroke="var(--border-card)"
                strokeOpacity={tick.isMajor ? "0.95" : "0.62"}
              />
              <line
                x1={tick.x}
                x2={tick.x}
                y1={chart.margin.top + chart.innerHeight}
                y2={chart.margin.top + chart.innerHeight + 8}
                stroke="var(--text-secondary)"
                strokeOpacity={tick.isMajor ? "0.85" : "0.45"}
              />
              <text
                x={tick.x + 4}
                y={chart.margin.top + chart.innerHeight + 23}
                fill="var(--text-secondary)"
                fontSize="14"
                fontWeight={tick.isMajor ? "800" : "700"}
                opacity={tick.isMajor ? "0.95" : "0.82"}
                transform={`rotate(50 ${tick.x + 4} ${chart.margin.top + chart.innerHeight + 23})`}
              >
                {tick.label}
              </text>
            </g>
          ))}

          {chart.ticks.map((tick) => {
            const y =
              chart.margin.top +
              chart.innerHeight -
              (tick / 100) * chart.innerHeight;
            return (
              <g key={tick}>
                <line
                  x1={chart.margin.left}
                  x2={chart.width - chart.margin.right}
                  y1={y}
                  y2={y}
                  stroke="var(--border-card)"
                  strokeOpacity="0.95"
                  strokeDasharray="4 7"
                />
                <text
                  x={chart.margin.left - 12}
                  y={y + 5}
                  textAnchor="end"
                  fill="var(--text-secondary)"
                  fontSize="16"
                  fontWeight="800"
                >
                  {tick}
                </text>
                <text
                  x={chart.width - chart.margin.right + 12}
                  y={y + 5}
                  textAnchor="start"
                  fill="var(--text-secondary)"
                  fontSize="16"
                  fontWeight="800"
                >
                  {tick}
                </text>
              </g>
            );
          })}

          <text
            x={22}
            y={chart.margin.top + chart.innerHeight / 2}
            textAnchor="middle"
            fill="var(--text-secondary)"
            fontSize="17"
            fontWeight="800"
            transform={`rotate(-90 22 ${chart.margin.top + chart.innerHeight / 2})`}
          >
            5h %
          </text>
          <text
            x={chart.width - 22}
            y={chart.margin.top + chart.innerHeight / 2}
            textAnchor="middle"
            fill="var(--text-secondary)"
            fontSize="17"
            fontWeight="800"
            transform={`rotate(90 ${chart.width - 22} ${chart.margin.top + chart.innerHeight / 2})`}
          >
            7d %
          </text>

          {chart.resetAnnotations.map((marker) => {
            const markerActive = isActive(marker.accountId, marker.provider);
            return (
              <g
                key={`${marker.accountId}:${marker.at}`}
                tabIndex={markerActive ? 0 : -1}
                role="img"
                aria-label={`${marker.badgeLabel} 5h reset at ${formatTooltipTime(marker.at)}`}
                onMouseEnter={() => showResetTooltip(marker)}
                onFocus={() => showResetTooltip(marker)}
                onTouchStart={() => showResetTooltip(marker)}
                onMouseLeave={() => setHoverInfo(null)}
                onBlur={() => setHoverInfo(null)}
              >
                <line
                  x1={marker.x}
                  x2={marker.x}
                  y1={chart.margin.top}
                  y2={chart.margin.top + chart.innerHeight}
                  stroke={marker.color}
                  strokeOpacity={markerActive ? "0.24" : "0.04"}
                  strokeDasharray="2 6"
                />
                <path
                  d={`M ${marker.x.toFixed(2)} ${chart.margin.top.toFixed(2)} L ${marker.x.toFixed(2)} ${(marker.y + 20).toFixed(2)}`}
                  stroke={marker.color}
                  strokeOpacity={markerActive ? "0.55" : "0.1"}
                  strokeDasharray="2 5"
                />
                <rect
                  x={marker.x - marker.width / 2}
                  y={marker.y}
                  width={marker.width}
                  height="20"
                  rx="10"
                  fill="var(--surface-page)"
                  stroke={marker.color}
                  strokeOpacity={markerActive ? "0.7" : "0.15"}
                  opacity={markerActive ? "0.96" : "0.26"}
                />
                <text
                  x={marker.x}
                  y={marker.y + 14}
                  textAnchor="middle"
                  fill={marker.color}
                  fontSize="12"
                  fontWeight="800"
                  opacity={markerActive ? "1" : "0.36"}
                >
                  {marker.badgeLabel}
                </text>
              </g>
            );
          })}

          {renderedSeries.map((series) => {
            const isEmphasized = series.windowKey === emphasis;
            const seriesActive = isActive(series.accountId, series.provider);
            return (
              <g key={`${series.accountId}:${series.windowKey}`}>
                <path
                  d={series.path}
                  fill="none"
                  stroke={series.color}
                  strokeWidth={
                    seriesActive ? (isEmphasized ? 2.4 : 1.15) : 0.75
                  }
                  strokeOpacity={
                    seriesActive ? (isEmphasized ? 0.92 : 0.22) : 0.035
                  }
                  strokeDasharray={
                    series.windowKey === "seven_day" ? "8 6" : undefined
                  }
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  pointerEvents="none"
                />
                {hasFocus && seriesActive && isEmphasized
                  ? series.points
                      .filter((point) => point.sampleKind === "carried_forward")
                      .map((point) => (
                        <circle
                          key={`${series.accountId}:${series.windowKey}:${point.bucketStart}`}
                          cx={point.x}
                          cy={point.y}
                          r="2.15"
                          fill={series.color}
                          opacity="0.48"
                        />
                      ))
                  : null}
                <path
                  d={series.path}
                  fill="none"
                  stroke="rgba(0,0,0,0)"
                  strokeWidth="14"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  tabIndex={seriesActive ? 0 : -1}
                  role="img"
                  aria-label={`${series.displayName} ${providerLabel(series.provider)} ${formatWindowLabel(series.windowKey)} usage line`}
                  pointerEvents={seriesActive ? "stroke" : "none"}
                  onMouseMove={(event) => handleSeriesHover(event, series)}
                  onTouchStart={(event) => handleSeriesTouch(event, series)}
                  onTouchMove={(event) => handleSeriesTouch(event, series)}
                  onFocus={() => handleSeriesFocus(series)}
                  onBlur={() => setHoverInfo(null)}
                  onMouseLeave={() => setHoverInfo(null)}
                />
              </g>
            );
          })}
          {hoverInfo ? (
            <ChartTooltip
              info={hoverInfo}
              chartWidth={chart.width}
              chartHeight={chart.height}
            />
          ) : null}
        </svg>
      </div>
    </div>
  );
}

function ChartTooltip({
  info,
  chartWidth,
  chartHeight,
}: {
  info: HoverInfo;
  chartWidth: number;
  chartHeight: number;
}) {
  const width = 252;
  const height = 124;
  const title = `${info.accountName} / ${providerShortLabel(info.provider)}`;
  const windowLabel = info.windowKey ? formatWindowLabel(info.windowKey) : "5h";
  const detail =
    info.kind === "reset"
      ? `5h reset at ${formatTooltipTime(info.resetAt || "")}`
      : `${windowLabel} usage at ${formatTooltipTime(info.bucketStart || "")}`;
  const primary =
    info.kind === "reset"
      ? formatTooltipTime(info.resetAt || "")
      : `${windowLabel} ${formatPercent(info.utilization)}`;
  const secondary =
    info.kind === "reset"
      ? "5h reset marker"
      : `5h ${formatPercent(info.values?.five_hour)} · 7d ${formatPercent(info.values?.seven_day)}`;
  const x = clamp(
    info.x + 16 > chartWidth - width - 12 ? info.x - width - 16 : info.x + 16,
    12,
    chartWidth - width - 12,
  );
  const y = clamp(info.y - height / 2, 12, chartHeight - height - 12);

  return (
    <g pointerEvents="none">
      <line
        x1={info.x}
        x2={info.x}
        y1={y + height}
        y2={info.y}
        stroke={info.color}
        strokeOpacity="0.42"
        strokeDasharray="3 5"
      />
      <circle
        cx={info.x}
        cy={info.y}
        r="4"
        fill={info.color}
        stroke="var(--surface-page)"
        strokeWidth="2"
      />
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        rx="14"
        fill="var(--surface-page)"
        stroke={info.color}
        strokeOpacity="0.68"
        opacity="0.98"
      />
      <text
        x={x + 16}
        y={y + 25}
        fill="var(--text-heading)"
        fontSize="15"
        fontWeight="900"
      >
        {truncateLabel(title, 28)}
      </text>
      <text
        x={x + 16}
        y={y + 47}
        fill="var(--text-secondary)"
        fontSize="13"
        fontWeight="800"
      >
        {truncateLabel(detail, 36)}
      </text>
      <text
        x={x + 16}
        y={y + 73}
        fill={info.color}
        fontSize="19"
        fontWeight="900"
      >
        {truncateLabel(primary, 25)}
      </text>
      <text
        x={x + 16}
        y={y + 99}
        fill="var(--text-secondary)"
        fontSize="14"
        fontWeight="800"
      >
        {secondary}
      </text>
    </g>
  );
}

function ProviderLegendGroup({
  group,
  focusedProvider,
  hasAccountFocus,
  focusedAccountIdSet,
  isActive,
  onProviderClick,
  onAccountClick,
}: {
  group: LegendGroup;
  focusedProvider: ProviderType | null;
  hasAccountFocus: boolean;
  focusedAccountIdSet: Set<string>;
  isActive: (accountId: string, provider: ProviderType) => boolean;
  onProviderClick: (provider: ProviderType) => void;
  onAccountClick: (accountId: string) => void;
}) {
  const providerSelected =
    !hasAccountFocus && focusedProvider === group.provider;
  const groupActive = group.accounts.some((account) =>
    isActive(account.accountId, account.provider),
  );

  return (
    <div
      className={`rounded-xl border px-3 py-2 transition-all ${groupActive ? "opacity-100" : "opacity-45"}`}
      style={{
        backgroundColor: group.background,
        borderColor: providerSelected
          ? withAlpha(group.accent, 0.75)
          : group.border,
      }}
    >
      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={() => onProviderClick(group.provider)}
          aria-pressed={providerSelected}
          className="flex shrink-0 cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-left transition-all"
          style={{
            backgroundColor: providerSelected
              ? withAlpha(group.accent, 0.16)
              : "transparent",
            borderColor: providerSelected
              ? withAlpha(group.accent, 0.75)
              : "transparent",
          }}
        >
          <span
            className="inline-block h-2.5 w-2.5 rounded-full"
            style={{ backgroundColor: group.accent }}
          />
          <span
            className="text-base font-black"
            style={{ color: group.accent }}
          >
            {group.label}
          </span>
          <span className="text-sm font-semibold text-[var(--text-muted)]">
            {group.accounts.length}
          </span>
        </button>

        <div className="flex min-w-0 flex-1 flex-wrap gap-2">
          {group.accounts.map((account) => {
            const accountSelected = focusedAccountIdSet.has(account.accountId);
            const accountActive = isActive(account.accountId, account.provider);
            return (
              <button
                key={`${group.provider}:${account.accountId}`}
                type="button"
                onClick={() => onAccountClick(account.accountId)}
                aria-pressed={accountSelected}
                className={`cursor-pointer rounded-lg border px-3 py-1.5 text-sm font-bold transition-all ${accountActive ? "text-[var(--text-heading)] opacity-100" : "text-[var(--text-muted)] opacity-35 grayscale"}`}
                style={{
                  backgroundColor: accountSelected
                    ? withAlpha(account.color, 0.16)
                    : "var(--surface-raised)",
                  borderColor: accountActive
                    ? withAlpha(account.color, 0.72)
                    : "var(--border-card)",
                  boxShadow: accountSelected
                    ? `0 0 0 2px ${withAlpha(account.color, 0.28)}`
                    : undefined,
                }}
              >
                <span
                  className="mr-2 inline-block h-2.5 w-2.5 rounded-full align-middle"
                  style={{ backgroundColor: account.color }}
                />
                {account.displayName}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function EmphasisToggle({
  emphasis,
  onChange,
}: {
  emphasis: WindowKey;
  onChange: (key: WindowKey) => void;
}) {
  return (
    <div className="flex items-center gap-1 rounded-full border border-[var(--border-card)] bg-[var(--surface-raised)] p-1">
      {EMPHASIS_KEYS.map((key) => {
        const active = emphasis === key;
        return (
          <button
            key={key}
            type="button"
            onClick={() => onChange(key)}
            className={`rounded-full px-3.5 py-1.5 text-sm font-bold transition-all ${active ? "text-[var(--surface-page)]" : "text-[var(--text-secondary)]"}`}
            style={{
              backgroundColor: active ? "var(--text-heading)" : "transparent",
            }}
          >
            {formatWindowLabel(key)}
          </button>
        );
      })}
    </div>
  );
}
