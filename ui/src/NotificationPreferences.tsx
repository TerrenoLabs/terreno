import {type FC, memo, useCallback} from "react";

import {BooleanField} from "./BooleanField";
import {Box} from "./Box";
import {Heading} from "./Heading";
import {Text} from "./Text";
import {useStableCallback} from "./useStableCallback";

export interface NotificationPreferencesState {
  inapp: boolean;
  mail: boolean;
  push: boolean;
  sms: boolean;
}

export type NotificationPreferenceChannel = keyof NotificationPreferencesState;

export interface NotificationPreferencesProps {
  onChange: (channel: NotificationPreferenceChannel, value: boolean) => void;
  preferences: NotificationPreferencesState;
  testID?: string;
}

const CHANNEL_COPY: Record<NotificationPreferenceChannel, {description: string; title: string}> = {
  inapp: {
    description: "Show notifications inside the app inbox.",
    title: "In-app inbox",
  },
  mail: {
    description: "Send notification email when a destination address is available.",
    title: "Email",
  },
  push: {
    description: "Send push notifications to registered devices.",
    title: "Push",
  },
  sms: {
    description: "Send SMS when a phone number is available.",
    title: "SMS",
  },
};

const CHANNELS = Object.keys(CHANNEL_COPY) as NotificationPreferenceChannel[];

interface NotificationChannelRowProps {
  channel: NotificationPreferenceChannel;
  onChange: (channel: NotificationPreferenceChannel, value: boolean) => void;
  testID: string;
  value: boolean;
}

// Memoized so toggling one channel re-renders that channel's switch, not all of them.
const NotificationChannelRow: FC<NotificationChannelRowProps> = memo(
  ({channel, onChange, testID, value}) => {
    const copy = CHANNEL_COPY[channel];
    const handleChange = useCallback(
      (newValue: boolean): void => {
        onChange(channel, newValue);
      },
      [channel, onChange]
    );

    return (
      <Box gap={1}>
        <BooleanField
          onChange={handleChange}
          testID={`${testID}-${channel}`}
          title={copy.title}
          value={value}
        />
        <Text color="secondaryLight" size="sm">
          {copy.description}
        </Text>
      </Box>
    );
  }
);
NotificationChannelRow.displayName = "NotificationChannelRow";

export const NotificationPreferences: FC<NotificationPreferencesProps> = ({
  onChange,
  preferences,
  testID = "notification-preferences",
}) => {
  const handleChange = useStableCallback(onChange);

  return (
    <Box gap={4} testID={testID}>
      <Box gap={1}>
        <Heading size="lg">Notification preferences</Heading>
        <Text color="secondaryLight">
          Choose which channels can deliver notifications from this app.
        </Text>
      </Box>
      {CHANNELS.map((channel) => (
        <NotificationChannelRow
          channel={channel}
          key={channel}
          onChange={handleChange}
          testID={testID}
          value={preferences[channel]}
        />
      ))}
    </Box>
  );
};
