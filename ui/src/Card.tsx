import type React from "react";
import {Image, useWindowDimensions} from "react-native";

import {Box} from "./Box";
import {Button} from "./Button";
import type {CardProps} from "./Common";
import {Heading} from "./Heading";
import {isSupportedDesktopWidth} from "./MediaQuery";
import {Text} from "./Text";

const DEFAULT_DISPLAY_CARD_WIDTH = 600;
const MOBILE_SMALL_DISPLAY_CARD_WIDTH = 200;
const MOBILE_ROW_IMAGE_WIDTH = 100;
const DESKTOP_ROW_IMAGE_WIDTH = 160;
const MOBILE_LARGE_IMAGE_HEIGHT = 300;
const TITLE_DESCRIPTION_GAP = 2;

const getDisplayCardWidth = ({
  isMobile,
  size,
}: {
  isMobile: boolean;
  size: CardProps["size"];
}): number | undefined => {
  if (isMobile && size === "small") {
    return MOBILE_SMALL_DISPLAY_CARD_WIDTH;
  }

  if (!isMobile && size === "default") {
    return DEFAULT_DISPLAY_CARD_WIDTH;
  }

  return undefined;
};

type DisplayCardProps = CardProps & {
  isMobile: boolean;
};

const DisplayCard = ({
  children,
  color = "base",
  padding,
  size = "default",
  title,
  description,
  buttonText,
  buttonOnClick,
  imageUri,
  imageAlt,
  imageHeight = 160,
  isMobile,
  maxWidth = "100%",
  minWidth = 0,
  overflow = "hidden",
  variant: _variant,
  ...rest
}: DisplayCardProps): React.ReactElement => {
  const isRow = !isMobile && size !== "small";
  const cardWidth = getDisplayCardWidth({isMobile, size});

  const columnImageHeight = isMobile && size === "large" ? MOBILE_LARGE_IMAGE_HEIGHT : imageHeight;

  const imageStyle = isRow
    ? {
        alignSelf: "stretch" as const,
        flexShrink: 0,
        width: isMobile ? MOBILE_ROW_IMAGE_WIDTH : DESKTOP_ROW_IMAGE_WIDTH,
      }
    : {
        flexShrink: 0,
        height: columnImageHeight,
        width: "100%" as const,
      };

  return (
    <Box
      alignItems={isRow ? "stretch" : undefined}
      alignSelf={cardWidth === undefined && isMobile ? "stretch" : undefined}
      borderBottom="default"
      borderLeft="default"
      borderRight="default"
      borderTop="default"
      color={color}
      direction={isRow ? "row" : "column"}
      gap={isMobile ? 0 : 6}
      maxWidth={maxWidth}
      minWidth={minWidth}
      overflow={overflow}
      padding={padding ?? (isMobile ? 0 : 6)}
      rounding="md"
      width={cardWidth ?? (isMobile ? "100%" : undefined)}
      {...rest}
    >
      {imageUri && (
        <Image
          accessibilityLabel={imageAlt}
          resizeMode="cover"
          source={{uri: imageUri}}
          style={imageStyle}
        />
      )}
      <Box
        direction="column"
        flex={isRow ? "shrink" : undefined}
        gap={4}
        minWidth={0}
        padding={isMobile ? 4 : 0}
        {...(isRow ? {} : {width: "100%"})}
      >
        {(Boolean(title) || Boolean(description)) && (
          <Box direction="column" gap={TITLE_DESCRIPTION_GAP} minWidth={0} width="100%">
            {Boolean(title) && (
              <Box minWidth={0} width="100%">
                <Heading size="lg">{title}</Heading>
              </Box>
            )}
            {Boolean(description) && (
              <Box minWidth={0} width="100%">
                <Text>{description}</Text>
              </Box>
            )}
          </Box>
        )}
        {Boolean(buttonText && buttonOnClick) && (
          <Button onClick={buttonOnClick!} text={buttonText!} />
        )}
        {children}
      </Box>
    </Box>
  );
};

type ContainerCardProps = CardProps & {
  isMobile: boolean;
};

const ContainerCard = ({
  children,
  color = "base",
  padding,
  isMobile,
  maxWidth = "100%",
  minWidth = 0,
  overflow = "hidden",
  variant: _variant,
  size: _size,
  title: _title,
  description: _description,
  buttonText: _buttonText,
  buttonOnClick: _buttonOnClick,
  imageUri: _imageUri,
  imageAlt: _imageAlt,
  imageHeight: _imageHeight,
  ...rest
}: ContainerCardProps): React.ReactElement => {
  const containerBoxProps = {
    borderBottom: "default" as const,
    borderLeft: isMobile ? undefined : ("default" as const),
    borderRight: isMobile ? undefined : ("default" as const),
    borderTop: "default" as const,
    color,
    direction: "column" as const,
    display: "flex" as const,
    maxWidth,
    minWidth,
    overflow,
    padding: padding ?? (isMobile ? 4 : 6),
    rounding: isMobile ? undefined : ("md" as const),
    ...rest,
  };

  return <Box {...containerBoxProps}>{children}</Box>;
};

export const Card = ({variant = "container", ...props}: CardProps): React.ReactElement => {
  const {width: windowWidth} = useWindowDimensions();
  const isMobile = !isSupportedDesktopWidth({width: windowWidth});

  if (variant === "display") {
    return <DisplayCard {...props} isMobile={isMobile} variant={variant} />;
  }

  return <ContainerCard {...props} isMobile={isMobile} variant={variant} />;
};
