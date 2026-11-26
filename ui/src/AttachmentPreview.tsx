import React, {memo, useCallback} from "react";
import {Image as RNImage} from "react-native";

import {Box} from "./Box";
import {DismissButton} from "./DismissButton";
import type {SelectedFile} from "./FilePickerButton";
import {Icon} from "./Icon";
import {Text} from "./Text";
import {useStableCallback} from "./useStableCallback";

export interface AttachmentPreviewProps {
  attachments: SelectedFile[];
  onRemove: (index: number) => void;
  testID?: string;
}

const IMAGE_STYLE = {borderRadius: 4, height: 40, width: 40} as const;

const isImageMimeType = (mimeType: string): boolean => {
  return mimeType.startsWith("image/");
};

interface AttachmentItemProps {
  index: number;
  mimeType: string;
  name: string;
  onRemove: (index: number) => void;
  uri: string;
}

// Memoized with primitive props so adding or removing one attachment, or a new `onRemove`
// from the caller, does not re-render every other attachment.
const AttachmentItem = memo(
  ({index, mimeType, name, onRemove, uri}: AttachmentItemProps): React.ReactElement => {
    const handleRemove = useCallback((): void => {
      onRemove(index);
    }, [index, onRemove]);

    return (
      <Box alignItems="center" border="default" direction="row" gap={1} padding={1} rounding="md">
        {isImageMimeType(mimeType) ? (
          <RNImage source={{uri}} style={IMAGE_STYLE} />
        ) : (
          <Box alignItems="center" justifyContent="center" padding={1}>
            <Icon iconName="file" size="sm" />
          </Box>
        )}
        <Text size="sm" truncate>
          {name}
        </Text>
        <DismissButton
          accessibilityHint="Removes this attachment"
          accessibilityLabel={`Remove ${name}`}
          onClick={handleRemove}
        />
      </Box>
    );
  }
);
AttachmentItem.displayName = "AttachmentItem";

export const AttachmentPreview = ({
  attachments,
  onRemove,
  testID,
}: AttachmentPreviewProps): React.ReactElement | null => {
  const handleRemove = useStableCallback(onRemove);

  if (attachments.length === 0) {
    return null;
  }

  return (
    <Box direction="row" gap={2} padding={2} testID={testID ?? "attachment-preview"} wrap>
      {attachments.map((attachment, index) => (
        <AttachmentItem
          index={index}
          key={`attachment-${index}`}
          mimeType={attachment.mimeType}
          name={attachment.name}
          onRemove={handleRemove}
          uri={attachment.uri}
        />
      ))}
    </Box>
  );
};
