import {Badge} from "@terreno/ui";
import React from "react";
import {getObservabilityStatusStyle} from "./observabilityStatus";

export interface ObservabilityStatusBadgeProps {
  /** Override the label, e.g. "Running 3 of 12"; the colour and icon still come from `status`. */
  label?: string;
  /** Raw status from the API: pending, in_progress, done, skipped, failed, running, completed, ok, error. */
  status?: string;
  testID?: string;
}

/** The one status badge for AI observability: same word, same colour, same icon on every screen. */
export const ObservabilityStatusBadge: React.FC<ObservabilityStatusBadgeProps> = ({
  label,
  status,
  testID,
}) => {
  const style = getObservabilityStatusStyle({status});
  return (
    <Badge
      iconName={style.iconName}
      secondary
      status={style.tone}
      testID={testID}
      value={label ?? style.label}
    />
  );
};
