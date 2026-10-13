import {ImageManipulator, type ImageResult, SaveFormat} from "expo-image-manipulator";
import {launchImageLibraryAsync} from "expo-image-picker";
import {LinearGradient} from "expo-linear-gradient";
import type React from "react";
import {type FC, useState} from "react";
import {
  Image,
  type ImageErrorEventData,
  type NativeSyntheticEvent,
  Pressable,
  Text,
  View,
} from "react-native";

import type {AvatarProps, CustomSvgProps} from "./Common";
import {Icon} from "./Icon";
import {MobileIcon} from "./icons/MobileIcon";
import {OfflineIcon} from "./icons/OfflineIcon";
import {OnlineIcon} from "./icons/OnlineIcon";
import {OutOfOfficeIcon} from "./icons/OutOfficeIcon";
import {isNarrowViewport} from "./MediaQuery";
import {useTheme} from "./Theme";
import {Tooltip} from "./Tooltip";

const sizes = {
  lg: 72,
  md: 56,
  sm: 38,
  xl: 120,
  xs: 28,
};

const initialsFontSizes = {
  lg: 32,
  md: 24,
  sm: 16,
  xl: 60,
  xs: 12,
};

const iconSizeScale = {
  lg: 1.1,
  md: 0.9,
  sm: 0.7,
  xl: 1.5,
  xs: 0.5,
};

const sizeIconPadding = {
  lg: 7,
  md: 9,
  sm: 10,
  xl: 0,
  xs: 12,
};

export const Avatar: FC<AvatarProps> = ({
  name,
  hasBorder = false,
  size = "md",
  src,
  onChange,
  status,
  doNotDisturb = false,
}) => {
  const {theme} = useTheme();
  const [isImageLoaded, setIsImageLoaded] = useState(true);
  const avatarImageFormat = SaveFormat.PNG;
  const avatarImageDiameter = sizes[size];
  const showEditIcon = status === "imagePicker";

  const avatarRadius = avatarImageDiameter / 2;
  const computedInitials =
    (name.match(/(^\S\S?|\s\S)?/g) ?? []) // Use nullish coalescing to handle the case where match returns null
      .map((v) => v.trim())
      .join("")
      .match(/(^\S|\S$)?/g) ??
    [] // Use nullish coalescing to handle the case where match returns null
      .join("")
      .toLocaleUpperCase();
  const statusIcons: {
    [id: string]: {
      icon: (props: CustomSvgProps) => React.ReactElement;
      label: string;
    };
  } = {
    activeMobile: {
      icon: MobileIcon,

      label: "Active on Mobile",
    },
    offline: {icon: OfflineIcon, label: "Offline"},
    online: {icon: OnlineIcon, label: "Online"},
    outOfOffice: {icon: OutOfOfficeIcon, label: "Out of Office"},
  };

  if (showEditIcon && !onChange) {
    console.warn("Avatars with the status of 'imagePicker' should also have an onChange property.");
  }

  const handleImageError = (event: NativeSyntheticEvent<ImageErrorEventData>) => {
    setIsImageLoaded(false);
    console.warn("Image load error: ", event);
  };

  const pickImage = async () => {
    // TODO: Add permission request to use camera to take a picture
    const result = await launchImageLibraryAsync({
      allowsEditing: true,
      base64: true,
      mediaTypes: "images",
    });

    if (!result.canceled && result.assets) {
      const resizedImage = await resizeAndFormatImage(result.assets[0].uri);
      // convert base64 to data uri
      resizedImage.uri = `data:image/${avatarImageFormat.toLowerCase()};base64,${resizedImage.base64}`;
      if (onChange) {
        onChange({avatarImageFormat, ...resizedImage});
      }
    }
  };

  const resizeAndFormatImage = async (imageUri: string): Promise<ImageResult> => {
    const imageContext = await ImageManipulator.manipulate(imageUri);
    const resizedImage = await imageContext.resize({
      height: avatarImageDiameter,
    });
    const renderedImage = await resizedImage.renderAsync();
    return await renderedImage.saveAsync({base64: true, format: avatarImageFormat});
  };

  const renderEditIcon = () => {
    if (size !== "xl") {
      console.error(`Avatar: "imagePicker" status is only supported for size "xl"`);
      return null;
    }

    return (
      <Pressable
        aria-role="button"
        onPress={pickImage}
        style={{
          alignItems: "center",
          backgroundColor: "rgba(255,255,255,0.75)",
          borderRadius: avatarRadius,
          height: avatarImageDiameter,
          justifyContent: "center",
          position: "absolute",
          width: avatarImageDiameter,
          zIndex: 5,
        }}
      >
        <Icon color="primary" iconName="pen-to-square" size="2xl" type="regular" />
        <Text
          style={{
            fontSize: 12,
            fontWeight: "bold",
            marginTop: 10,
            textAlign: "center",
          }}
        >
          Upload Image
        </Text>
      </Pressable>
    );
  };

  const renderStatusIcon = () => {
    if (!status || showEditIcon) {
      return null;
    }
    const {icon} = statusIcons[status];

    if (!icon) {
      console.warn(`Avatar: Invalid status ${status}`);
      return null;
    }

    return (
      <View
        style={{
          bottom: 0,
          position: "absolute",
          right: 0,
          zIndex: 5,
        }}
        testID="status-indicator"
      >
        {icon({
          doNotDisturb,
          transform: [{scale: iconSizeScale[size]}],
        })}
      </View>
    );
  };

  let avatar = (
    <View
      accessibilityHint={showEditIcon ? "Opens file explorer" : "Avatar image"}
      aria-label={`${name}'s avatar`}
      aria-role="image"
      style={{height: avatarImageDiameter, position: "relative", width: avatarImageDiameter}}
    >
      <Pressable
        aria-role="button"
        style={{
          borderRadius: 1,
          cursor: showEditIcon ? "pointer" : "auto",
          overflow: "hidden",
          position: "relative",
        }}
      >
        {src && isImageLoaded ? (
          // TODO: Make our Image component rounding work so that we can use it for Avatar.
          // Currently it creates an unrounded box around the Image.
          <Image
            accessibilityIgnoresInvertColors
            onError={handleImageError}
            source={{cache: "force-cache", uri: src}}
            style={{
              borderColor: hasBorder ? "white" : "transparent",
              borderRadius: avatarRadius,
              borderWidth: hasBorder && status !== "imagePicker" ? avatarImageDiameter * 0.04 : 0,
              height: avatarImageDiameter,
              overflow: "hidden",
            }}
            testID="avatar-image"
          />
        ) : (
          <View
            style={{
              alignItems: "center",
              backgroundColor: theme.surface.secondaryDark,
              borderColor: hasBorder && status !== "imagePicker" ? "white" : "transparent",
              borderRadius: avatarRadius,
              borderWidth: hasBorder && status !== "imagePicker" ? avatarImageDiameter * 0.04 : 0,
              display: "flex",
              height: avatarImageDiameter,
              justifyContent: "center",
              width: avatarImageDiameter,
            }}
          >
            <Text
              style={{
                color: theme.text.inverted,
                fontSize: initialsFontSizes[size],
                fontWeight: 500,
              }}
            >
              {computedInitials}
            </Text>
          </View>
        )}
      </Pressable>
      {/* Needs to come after the image so it renders on top. */}
      {showEditIcon && renderEditIcon()}
    </View>
  );

  if (hasBorder && status !== "imagePicker") {
    const gradientDiameter = avatarImageDiameter * 1.1;
    const gradientStartColor = "#FFC947";
    const gradientEndColor = "#EA9095";
    // Start the first color in the top left corner and end the second color in the bottom
    // right corner.

    avatar = (
      <LinearGradient
        colors={[gradientStartColor, gradientEndColor]}
        end={{x: 1, y: 1}}
        start={{x: 0, y: 0}}
        style={{
          alignItems: "center",
          borderRadius: gradientDiameter / 2,
          height: gradientDiameter,
          justifyContent: "center",
          width: gradientDiameter,
        }}
      >
        {avatar}
      </LinearGradient>
    );
  }

  if (status) {
    // Need to wrap the tooltip so it doesn't expand to 100% width and render the tooltip off.
    // Don't show the tooltips on mobile because they intercept the edit avatar clicks.
    const widthPlusPadding = avatarImageDiameter + sizeIconPadding[size];

    avatar = (
      <View
        style={{
          paddingBottom: sizeIconPadding[size],
          paddingRight: sizeIconPadding[size],
          width: widthPlusPadding,
        }}
      >
        <Tooltip idealPosition="top" text={isNarrowViewport() ? undefined : status}>
          {avatar}
        </Tooltip>
        {renderStatusIcon()}
      </View>
    );
  }

  return avatar;
};
