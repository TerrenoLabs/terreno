import type {IconName} from "@terreno/ui";

/** Badge tones the observability screens use. Colour always means state, never category. */
export type ObservabilityTone = "error" | "info" | "neutral" | "success" | "warning";

export interface ObservabilityStatusStyle {
  iconName: IconName;
  label: string;
  tone: ObservabilityTone;
}

/**
 * The one status scale for every AI observability screen. Review items, experiments,
 * and traces all map their raw status here so the same word gets the same colour and icon.
 */
export const OBSERVABILITY_STATUS: Record<string, ObservabilityStatusStyle> = {
  completed: {iconName: "check", label: "Done", tone: "success"},
  done: {iconName: "check", label: "Done", tone: "success"},
  error: {iconName: "triangle-exclamation", label: "Error", tone: "error"},
  failed: {iconName: "triangle-exclamation", label: "Failed", tone: "error"},
  in_progress: {iconName: "spinner", label: "In progress", tone: "info"},
  ok: {iconName: "check", label: "OK", tone: "success"},
  pending: {iconName: "clock", label: "Pending", tone: "neutral"},
  running: {iconName: "spinner", label: "Running", tone: "info"},
  skipped: {iconName: "forward-step", label: "Skipped", tone: "neutral"},
};

const humanizeStatus = (status: string): string => {
  const words = status.replace(/[_-]+/g, " ").trim();
  if (!words) {
    return "Unknown";
  }
  return words.charAt(0).toUpperCase() + words.slice(1);
};

/** Look up a raw status; unknown values fall back to a neutral badge with a readable label. */
export const getObservabilityStatusStyle = ({
  status,
}: {
  status?: string;
}): ObservabilityStatusStyle => {
  if (!status) {
    return {iconName: "circle-question", label: "Unknown", tone: "neutral"};
  }
  return (
    OBSERVABILITY_STATUS[status] ?? {
      iconName: "circle-info",
      label: humanizeStatus(status),
      tone: "neutral",
    }
  );
};

/**
 * Agreement between an LLM judge and people. One pair of cut-offs drives every
 * agreement badge, meter, and per-question cell.
 */
export const AGREEMENT_THRESHOLDS = {close: 0.75, match: 0.9} as const;

export type AgreementLevel = "close" | "match" | "none" | "off";

export const AGREEMENT_LEVEL_STYLE: Record<
  AgreementLevel,
  {label: string; tone: ObservabilityTone}
> = {
  close: {label: "Close", tone: "warning"},
  match: {label: "Matches", tone: "success"},
  none: {label: "No answers yet", tone: "neutral"},
  off: {label: "Off", tone: "error"},
};

export const getAgreementLevel = (rate?: number): AgreementLevel => {
  if (rate === undefined || Number.isNaN(rate)) {
    return "none";
  }
  if (rate >= AGREEMENT_THRESHOLDS.match) {
    return "match";
  }
  if (rate >= AGREEMENT_THRESHOLDS.close) {
    return "close";
  }
  return "off";
};

/** Rate in 0–1 as a whole percent, or an em dash when there is nothing to show. */
export const formatRate = (rate?: number): string => {
  if (rate === undefined || Number.isNaN(rate)) {
    return "—";
  }
  return `${Math.round(rate * 100)}%`;
};

/** Clamp a 0–1 fraction to a CSS-style width percentage for meters. */
export const toMeterWidth = (fraction?: number): `${number}%` => {
  if (fraction === undefined || Number.isNaN(fraction)) {
    return "0%";
  }
  const clamped = Math.min(1, Math.max(0, fraction));
  return `${Math.round(clamped * 100)}%`;
};
