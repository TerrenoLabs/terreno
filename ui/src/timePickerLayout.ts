// UIPickerView only lays out correctly at its natural heights (~162/180/216pt). A forced
// 104pt wheel looks fine on the simulator, but on physical devices it can place its labels in
// the snapped natural-height space while clipping to 104pt, so every label lands outside the
// clip and the wheel shows empty rows. Android's picker is a dropdown and keeps the compact
// height.
const IOS_TIME_PICKER_HEIGHT = 216;
const COMPACT_TIME_PICKER_HEIGHT = 104;

export interface TimePickerLayout {
  height: number;
  /** Set on every platform: an item with no color uses the system label color, which is
   * white on a dark-mode iPhone even when the sheet follows a light app theme. */
  itemColor: string;
  /** iOS-only `itemStyle`; omitted on Android, where it breaks some spinner versions. */
  itemStyle: {fontSize?: number; height: number} | undefined;
}

export const getTimePickerLayout = ({
  os,
  textColor,
  fontSize,
}: {
  os: string;
  textColor: string;
  fontSize?: number;
}): TimePickerLayout => {
  const height = os === "ios" ? IOS_TIME_PICKER_HEIGHT : COMPACT_TIME_PICKER_HEIGHT;
  return {
    height,
    itemColor: textColor,
    itemStyle: os === "ios" ? {...(fontSize ? {fontSize} : {}), height} : undefined,
  };
};
