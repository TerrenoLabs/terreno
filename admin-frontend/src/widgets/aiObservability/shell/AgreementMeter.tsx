import {Badge, Box, type SurfaceColor, Text} from "@terreno/ui";
import React from "react";
import {
  AGREEMENT_LEVEL_STYLE,
  formatRate,
  getAgreementLevel,
  type ObservabilityTone,
  toMeterWidth,
} from "./observabilityStatus";

const TONE_SURFACE: Record<ObservabilityTone, SurfaceColor> = {
  error: "error",
  info: "primary",
  neutral: "neutralLight",
  success: "success",
  warning: "warning",
};

export interface MeterBarProps {
  /** 0–1 fraction of the bar to fill. */
  fraction?: number;
  testID?: string;
  tone?: ObservabilityTone;
}

/** Thin rounded bar. Brand blue (`info`) for progress, status tones for outcomes. */
export const MeterBar: React.FC<MeterBarProps> = ({fraction, testID, tone = "info"}) => {
  return (
    <Box
      color="neutralExtraLight"
      flex="grow"
      height={6}
      overflow="hidden"
      rounding="3xl"
      testID={testID}
    >
      <Box
        color={TONE_SURFACE[tone]}
        height={6}
        rounding="3xl"
        testID={testID ? `${testID}-fill` : undefined}
        width={toMeterWidth(fraction)}
      />
    </Box>
  );
};

export interface ProgressMeterProps {
  done: number;
  testID?: string;
  total: number;
}

/** "8 of 10" with a progress bar, for answered items and running experiments. */
export const ProgressMeter: React.FC<ProgressMeterProps> = ({done, testID, total}) => {
  const fraction = total > 0 ? done / total : 0;
  return (
    <Box gap={1} testID={testID}>
      <Text bold size="sm">{`${done} of ${total}`}</Text>
      <MeterBar fraction={fraction} testID={testID ? `${testID}-bar` : undefined} />
    </Box>
  );
};

export interface AgreementMeterProps {
  /** Hide the bar for compact cells; the percent and badge stay. */
  compact?: boolean;
  /** Agreement with people, 0–1. Undefined means nothing to compare yet. */
  rate?: number;
  testID?: string;
}

/**
 * How often a judge agrees with people: percent, bar, and Matches / Close / Off badge.
 * Cut-offs come from AGREEMENT_THRESHOLDS so every screen agrees.
 */
export const AgreementMeter: React.FC<AgreementMeterProps> = ({compact, rate, testID}) => {
  const level = getAgreementLevel(rate);
  const style = AGREEMENT_LEVEL_STYLE[level];
  if (level === "none") {
    return (
      <Text color="secondaryLight" size="sm" testID={testID}>
        {style.label}
      </Text>
    );
  }
  return (
    <Box alignItems="center" direction="row" gap={2} testID={testID}>
      <Text bold testID={testID ? `${testID}-percent` : undefined}>
        {formatRate(rate)}
      </Text>
      {compact ? null : (
        <MeterBar fraction={rate} testID={testID ? `${testID}-bar` : undefined} tone={style.tone} />
      )}
      <Badge
        secondary
        status={style.tone}
        testID={testID ? `${testID}-badge` : undefined}
        value={style.label}
      />
    </Box>
  );
};
