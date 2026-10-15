import {type FC, useEffect, useState} from "react";
import {Pressable, View} from "react-native";

import type {AccordionProps} from "./Common";
import {Heading} from "./Heading";
import {Icon} from "./Icon";
import {InfoModalIcon} from "./InfoModalIcon";
import {Text} from "./Text";
import {useTheme} from "./Theme";

export const Accordion: FC<AccordionProps> = ({
  children,
  isCollapsed = false,
  title,
  subtitle,
  includeInfoModal = false,
  infoModalChildren,
  infoModalSubtitle,
  infoModalText,
  infoModalTitle,
  onToggle,
  testID,
}) => {
  const {theme} = useTheme();
  const [collapsed, setCollapsed] = useState(isCollapsed);

  // The external collapse state should override the internal collapse state.
  useEffect(() => {
    setCollapsed(isCollapsed);
  }, [isCollapsed]);

  return (
    <View
      style={{
        borderBottomColor: theme.border.default,
        borderBottomWidth: 2,
        borderTopColor: theme.border.default,
        borderTopWidth: 2,
        padding: 16,
        width: "100%",
      }}
      testID={testID}
    >
      <View style={{alignItems: "center", flexDirection: "row", justifyContent: "space-between"}}>
        <View style={{flexDirection: "column", gap: 4}}>
          <View style={{alignItems: "center", flexDirection: "row"}}>
            <Heading>{title}</Heading>
            {includeInfoModal && infoModalTitle && (
              <InfoModalIcon
                infoModalChildren={infoModalChildren}
                infoModalSubtitle={infoModalSubtitle}
                infoModalText={infoModalText}
                infoModalTitle={infoModalTitle}
              />
            )}
          </View>
          {subtitle && <Text>{subtitle}</Text>}
        </View>
        <View>
          <Pressable
            aria-role="button"
            hitSlop={{bottom: 20, left: 20, right: 20, top: 20}}
            onPress={() => {
              setCollapsed(!collapsed);
              if (onToggle) {
                onToggle(!collapsed);
              }
            }}
            testID={testID ? `${testID}.toggle` : "accordion-toggle"}
          >
            <Icon color="link" iconName={collapsed ? "chevron-down" : "chevron-up"} size="sm" />
          </Pressable>
        </View>
      </View>
      {collapsed ? null : <View style={{marginTop: 8}}>{children}</View>}
    </View>
  );
};
