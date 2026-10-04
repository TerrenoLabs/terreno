import debounce from "lodash/debounce";
import type React from "react";
import {useEffect, useState} from "react";
import {ActivityIndicator, Text as NativeText, Pressable, View} from "react-native";

import {Box} from "./Box";
import type {BannerProps, IconName, SurfaceTheme} from "./Common";
import {DismissButton} from "./DismissButton";
import {Icon} from "./Icon";
import {useTheme} from "./Theme";
import {Unifier} from "./Unifier";

interface BannerButtonProps {
  buttonIconName?: string;
  buttonOnClick: () => void | Promise<void>;
  buttonText: string;
  loading?: boolean;
}

export const BannerButton = ({
  loading: propsLoading,
  buttonText,
  buttonIconName,
  buttonOnClick,
}: BannerButtonProps): React.ReactElement | null => {
  const [loading, setLoading] = useState(propsLoading);
  const {theme} = useTheme();

  if (!theme) {
    return null;
  }

  return (
    <Pressable
      accessibilityHint={`Press to perform action ${buttonText}`}
      aria-label={buttonText}
      aria-role="button"
      onPress={debounce(
        async () => {
          await Unifier.utils.haptic();
          setLoading(true);
          try {
            await buttonOnClick();
          } catch (error) {
            setLoading(false);
            throw error;
          }
          setLoading(false);
        },
        500,
        {leading: true}
      )}
      style={{
        alignItems: "center",
        alignSelf: "stretch",
        backgroundColor: theme.surface.base,
        borderRadius: theme.radius.rounded,
        flexDirection: "column",
        justifyContent: "center",
        paddingHorizontal: 12,
        paddingVertical: 4,
      }}
    >
      <View style={{flexDirection: "row"}}>
        <View style={{flexDirection: "row-reverse"}}>
          {Boolean(buttonIconName) && (
            <View
              style={{
                alignSelf: "center",
                marginLeft: 8,
                marginRight: 0,
              }}
            >
              <Icon iconName={buttonIconName as IconName} type="solid" />
            </View>
          )}
          <NativeText style={{color: theme.text.primary, fontSize: 12}}>{buttonText}</NativeText>
        </View>
        {Boolean(loading) && (
          <Box marginLeft={2}>
            <ActivityIndicator size="small" />
          </Box>
        )}
      </View>
    </Pressable>
  );
};

const getKey = (id: string): string => {
  return `@TerrenoUI:${id}`;
};

export const hideBanner = (id: string): Promise<void> => {
  console.debug(`[banner] Hiding ${getKey(id)} `);
  return Unifier.storage.setItem(getKey(id), "true");
};

export const Banner = (props: BannerProps): React.ReactElement | null => {
  const {id, text, status = "info", dismissible = false, hasIcon = false, buttonOnClick} = props;

  const {buttonText, buttonIconName} = props as BannerButtonProps;

  const {theme} = useTheme();

  let bgColor: keyof SurfaceTheme = "secondaryDark";

  if (status === "alert") {
    bgColor = "error";
  } else if (status === "warning") {
    bgColor = "warning";
  }

  const [show, setShow] = useState(true);

  // Load seen from async storage (only when id is provided).
  useEffect(() => {
    if (dismissible && id) {
      void Unifier.storage.getItem(getKey(id)).then((isSeen) => {
        console.debug(`[banner] ${getKey(id)} seen? ${isSeen}`);
        setShow(!isSeen);
      });
    }
  }, [id, dismissible]);

  const dismiss = async (): Promise<void> => {
    if (!dismissible) {
      return;
    }
    if (id) {
      await hideBanner(id);
    }
    setShow(false);
  };

  if (!show) {
    return null;
  }

  return (
    <View
      style={{
        alignItems: "center",
        backgroundColor: theme.surface[bgColor],
        borderRadius: theme.radius.default,
        flexDirection: "row",
        height: "auto",
        margin: "auto",
        minHeight: theme.spacing.xl,
        padding: theme.spacing.xs,
        width: "100%",
      }}
    >
      <View
        style={{
          alignItems: "center",
          flex: 1,
          flexDirection: "row",
          justifyContent: "center",
        }}
      >
        {Boolean(hasIcon) && (
          <View style={{paddingLeft: 10, paddingRight: 12}}>
            <Icon color="inverted" iconName="triangle-exclamation" />
          </View>
        )}
        <NativeText
          style={{
            color: theme.text.inverted,
            flexShrink: 1,
            flexWrap: "wrap",
            fontWeight: "bold",
            textAlign: "center",
          }}
        >
          {text}
        </NativeText>
        {Boolean(buttonText && buttonIconName && buttonOnClick) && (
          <View style={{paddingLeft: 16, paddingRight: 10}}>
            <BannerButton
              buttonIconName={buttonIconName}
              buttonOnClick={buttonOnClick!}
              buttonText={buttonText}
            />
          </View>
        )}
        {Boolean(buttonText && !buttonIconName && buttonOnClick) && (
          <View style={{paddingLeft: 16, paddingRight: 10}}>
            <BannerButton buttonOnClick={buttonOnClick!} buttonText={buttonText} />
          </View>
        )}
      </View>
      {Boolean(dismissible) && (
        <DismissButton
          accessibilityHint="Press to dismiss banner"
          accessibilityLabel="Dismiss"
          color="inverted"
          onClick={dismiss}
        />
      )}
    </View>
  );
};
