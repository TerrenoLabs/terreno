import type {BuildResult} from "../build";

interface StageTime {
  id: string;
  totalMinutes: number;
  previous?: number;
  regressed: boolean;
}

export interface TimeReport {
  stages: StageTime[];
  scoreMinutes: number;
  totalMinutes: number;
  previousTotal?: number;
  totalRegressed: boolean;
}

/** More than 25% and more than 2 minutes slower than the previous version. */
export const isTimeRegression = (now: number, previous: number): boolean =>
  now > previous * 1.25 && now - previous > 2;

const round = (value: number): number => Math.round(value * 10) / 10;

/**
 * Compares a build's per-stage and total minutes (every attempt counted) with the previous
 * version's `build.json`. Total build time includes the scorer's own minutes.
 */
export const compareTimes = ({
  build,
  previous,
  scoreMinutes,
}: {
  build: BuildResult;
  previous?: BuildResult;
  scoreMinutes: number;
}): TimeReport => {
  const stages = build.stages.map((stage): StageTime => {
    const before = previous?.stages.find((item) => item.id === stage.id)?.totalMinutes;
    return {
      id: stage.id,
      previous: before,
      regressed: before !== undefined && isTimeRegression(stage.totalMinutes, before),
      totalMinutes: stage.totalMinutes,
    };
  });
  const totalMinutes = round(build.totalMinutes + scoreMinutes);
  const previousTotal = previous ? previous.totalMinutes : undefined;
  return {
    previousTotal,
    scoreMinutes: round(scoreMinutes),
    stages,
    totalMinutes,
    totalRegressed:
      previousTotal !== undefined && isTimeRegression(build.totalMinutes, previousTotal),
  };
};
