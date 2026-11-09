import type {FC, ReactNode} from "react";

import {ChartCard} from "../ChartCard";
import {resolveTestID} from "../testing/resolveTestId";

export interface ChartFacadeContainerProps {
  children: ReactNode;
  onPeriodPress?: () => void;
  periodLabel?: string;
  testID?: string;
  title?: string;
}

export const ChartFacadeContainer: FC<ChartFacadeContainerProps> = ({
  children,
  onPeriodPress,
  periodLabel,
  testID,
  title,
}) => {
  if (!title) {
    return children;
  }

  return (
    <ChartCard
      onPeriodPress={onPeriodPress}
      periodLabel={periodLabel}
      testID={resolveTestID(testID, "card")}
      title={title}
    >
      {children}
    </ChartCard>
  );
};
