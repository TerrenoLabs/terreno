/**
 * Shared Sync Lab rate presets + cross-screen rate / visibility state.
 *
 * Home (SyncDB dev panel) and the admin Sync Lab screen both read/write these so
 * starting a churn engine from either place stays in sync when navigating. The
 * admin toggle also gates whether the SyncDB dev panel (with the rate dropdowns)
 * appears on the home todos screen.
 */
import {useSyncExternalStore} from "react";

export const SYNC_LAB_COLLECTION = "todos";
export const SYNC_LAB_TICK_MS = 1_000;

/** The SyncDB dev panel is opt-in from the admin Sync Lab. */
const DEFAULT_SHOW_DEV_PANEL = false;

/**
 * Rate presets → target ops PER SECOND, indexed by the selected option.
 * "Low" is a deliberate trickle (~1 op every 5s, i.e. 0.2/sec).
 */
export const SYNC_LAB_RATE_LABELS = ["Off", "Low", "Med", "High", "Max"] as const;
export const SYNC_LAB_RATE_OPS = [0, 0.2, 1, 5, 10] as const;

export type SyncLabRateIndex = 0 | 1 | 2 | 3 | 4;

export interface SyncLabRateOption {
  label: string;
  value: string;
}

/** SelectField options for Off/Low/Med/High/Max. */
export const SYNC_LAB_RATE_OPTIONS: SyncLabRateOption[] = SYNC_LAB_RATE_LABELS.map(
  (label, index) => ({
    label:
      index === 0
        ? label
        : index === 1
          ? `${label} (~1 / 5s)`
          : `${label} (${SYNC_LAB_RATE_OPS[index]}/s)`,
    value: String(index),
  })
);

interface SyncLabRatesState {
  localRate: SyncLabRateIndex;
  remoteRate: SyncLabRateIndex;
  showDevPanel: boolean;
}

let ratesState: SyncLabRatesState = {
  localRate: 0,
  remoteRate: 0,
  showDevPanel: DEFAULT_SHOW_DEV_PANEL,
};
const listeners = new Set<() => void>();

const emit = (): void => {
  for (const listener of listeners) {
    listener();
  }
};

const clampRateIndex = (value: number): SyncLabRateIndex => {
  if (!Number.isFinite(value) || value < 0) {
    return 0;
  }
  if (value > 4) {
    return 4;
  }
  return Math.floor(value) as SyncLabRateIndex;
};

export const getSyncLabRates = (): SyncLabRatesState => ratesState;

export const setSyncLabLocalRate = (rate: number): void => {
  const next = clampRateIndex(rate);
  if (ratesState.localRate === next) {
    return;
  }
  ratesState = {...ratesState, localRate: next};
  emit();
};

export const setSyncLabRemoteRate = (rate: number): void => {
  const next = clampRateIndex(rate);
  if (ratesState.remoteRate === next) {
    return;
  }
  ratesState = {...ratesState, remoteRate: next};
  emit();
};

const setShowSyncDevPanel = (show: boolean): void => {
  if (ratesState.showDevPanel === show) {
    return;
  }
  ratesState = {...ratesState, showDevPanel: show};
  emit();
};

export const parseSyncLabRateValue = (value: string): SyncLabRateIndex =>
  clampRateIndex(Number(value));

export const subscribeSyncLabRates = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return (): void => {
    listeners.delete(listener);
  };
};

/** React binding for the shared Sync Lab rate state. */
export const useSyncLabRates = (): {
  localRate: SyncLabRateIndex;
  remoteRate: SyncLabRateIndex;
  showDevPanel: boolean;
  setLocalRate: (rate: number) => void;
  setRemoteRate: (rate: number) => void;
  setShowDevPanel: (show: boolean) => void;
} => {
  const rates = useSyncExternalStore(subscribeSyncLabRates, getSyncLabRates, getSyncLabRates);
  return {
    localRate: rates.localRate,
    remoteRate: rates.remoteRate,
    setLocalRate: setSyncLabLocalRate,
    setRemoteRate: setSyncLabRemoteRate,
    setShowDevPanel: setShowSyncDevPanel,
    showDevPanel: rates.showDevPanel,
  };
};
