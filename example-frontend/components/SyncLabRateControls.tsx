/**
 * Sync Lab rate dropdowns: Other clients (server churn) and This client (local
 * outbox churn). Shared via {@link useSyncLabRates} between the SyncDB dev panel
 * and the admin Sync Lab screen.
 */
import {Box, SelectField, Text} from "@terreno/ui";
import type React from "react";
import {useCallback} from "react";
import {
  parseSyncLabRateValue,
  SYNC_LAB_RATE_OPTIONS,
  useSyncLabRates,
} from "@/components/syncLabRates";

export const SyncLabRateControls: React.FC = () => {
  const {localRate, remoteRate, setLocalRate, setRemoteRate} = useSyncLabRates();

  const handleRemoteChange = useCallback(
    (value: string): void => {
      setRemoteRate(parseSyncLabRateValue(value));
    },
    [setRemoteRate]
  );

  const handleLocalChange = useCallback(
    (value: string): void => {
      setLocalRate(parseSyncLabRateValue(value));
    },
    [setLocalRate]
  );

  return (
    <Box direction="row" gap={3} testID="sync-lab-rate-controls" wrap>
      <Box flex="grow" minWidth={140}>
        <SelectField
          onChange={handleRemoteChange}
          options={SYNC_LAB_RATE_OPTIONS}
          requireValue
          testID="sync-lab-remote-rate"
          title="Other clients"
          value={String(remoteRate)}
        />
        <Text color="secondaryLight" size="sm">
          Server churn into this device
        </Text>
      </Box>
      <Box flex="grow" minWidth={140}>
        <SelectField
          onChange={handleLocalChange}
          options={SYNC_LAB_RATE_OPTIONS}
          requireValue
          testID="sync-lab-local-rate"
          title="This client"
          value={String(localRate)}
        />
        <Text color="secondaryLight" size="sm">
          Local optimistic mutations
        </Text>
      </Box>
    </Box>
  );
};
