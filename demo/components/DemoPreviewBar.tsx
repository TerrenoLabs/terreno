import {BooleanField, Box, IconButton, Modal, SelectField, Text} from "@terreno/ui";
import type React from "react";
import {useCallback, useState} from "react";
import {useWindowDimensions} from "react-native";
import type {DemoPreviewState} from "../previewState";

const THEME_OPTIONS = [
  {label: "Light", value: "light"},
  {label: "Dark", value: "dark"},
];
const VIEWPORT_OPTIONS = [
  {label: "Full width", value: "full"},
  {label: "320px", value: "320"},
  {label: "375px", value: "375"},
  {label: "1024px", value: "1024"},
  {label: "1280px", value: "1280"},
];
const BACKGROUND_OPTIONS = [
  {label: "Default bg", value: "default"},
  {label: "Inverse bg", value: "inverse"},
  {label: "Transparent bg", value: "transparent"},
];
// Below this width the header has no room for dropdowns, so every control moves into the modal.
const COMPACT_MAX_WIDTH = 768;

const LOCALE_OPTIONS = [
  {label: "en", value: "en"},
  {label: "en-US", value: "en-US"},
];

/** Header preview controls: quick dropdowns plus a settings modal; narrow windows use only the modal. */
export const DemoPreviewBar: React.FC<{
  onChange: (state: DemoPreviewState) => void;
  shareQuery: string;
  state: DemoPreviewState;
}> = ({onChange, shareQuery, state}) => {
  const [isSettingsVisible, setIsSettingsVisible] = useState(false);

  const update = useCallback(
    (patch: Partial<DemoPreviewState>): void => {
      onChange({...state, ...patch});
    },
    [onChange, state]
  );

  const closeSettings = useCallback((): void => {
    setIsSettingsVisible(false);
  }, []);

  const isCompact = useWindowDimensions().width < COMPACT_MAX_WIDTH;
  const hasAdvancedOverrides = state.rtl || state.reducedMotion || state.locale !== "en";
  const hasQuickOverrides =
    state.theme !== "light" || state.viewport !== "full" || state.background !== "default";
  const hasHiddenOverrides = hasAdvancedOverrides || (isCompact && hasQuickOverrides);

  // Keep a free-form locale from the URL selectable so the dropdown never shows a blank value.
  const localeOptions = LOCALE_OPTIONS.some((option) => option.value === state.locale)
    ? LOCALE_OPTIONS
    : [...LOCALE_OPTIONS, {label: state.locale, value: state.locale}];

  const quickSelects = (
    <>
      <Box width={isCompact ? "100%" : 110}>
        <SelectField
          disableSearch
          onChange={(theme): void => {
            update({theme: theme as DemoPreviewState["theme"]});
          }}
          options={THEME_OPTIONS}
          requireValue
          testID="preview-theme"
          title={isCompact ? "Theme" : undefined}
          value={state.theme}
        />
      </Box>
      <Box width={isCompact ? "100%" : 130}>
        <SelectField
          disableSearch
          onChange={(viewport): void => {
            update({viewport: viewport as DemoPreviewState["viewport"]});
          }}
          options={VIEWPORT_OPTIONS}
          requireValue
          testID="preview-viewport"
          title={isCompact ? "Viewport" : undefined}
          value={state.viewport}
        />
      </Box>
      <Box width={isCompact ? "100%" : 160}>
        <SelectField
          disableSearch
          onChange={(background): void => {
            update({background: background as DemoPreviewState["background"]});
          }}
          options={BACKGROUND_OPTIONS}
          requireValue
          testID="preview-background"
          title={isCompact ? "Background" : undefined}
          value={state.background}
        />
      </Box>
    </>
  );

  return (
    <Box alignItems="center" direction="row" gap={2} marginRight={2} testID="demo-preview-bar">
      {isCompact ? null : quickSelects}
      <IconButton
        accessibilityLabel="More preview settings"
        iconName="sliders"
        indicator={hasHiddenOverrides ? "primary" : undefined}
        onClick={(): void => {
          setIsSettingsVisible(true);
        }}
        testID="preview-settings"
        tooltipText={isCompact ? "Preview settings" : "Direction, motion, locale"}
        variant="muted"
      />
      <Modal
        onDismiss={closeSettings}
        primaryButtonOnClick={closeSettings}
        primaryButtonText="Done"
        size="sm"
        title="Preview settings"
        visible={isSettingsVisible}
      >
        <Box gap={4} testID="demo-preview-settings">
          {isCompact ? quickSelects : null}
          <BooleanField
            onChange={(rtl): void => {
              update({rtl});
            }}
            testID="preview-rtl"
            title="Right-to-left (RTL)"
            value={state.rtl}
          />
          <BooleanField
            onChange={(reducedMotion): void => {
              update({reducedMotion});
            }}
            testID="preview-motion"
            title="Reduced motion"
            value={state.reducedMotion}
          />
          <SelectField
            disableSearch
            onChange={(locale): void => {
              update({locale});
            }}
            options={localeOptions}
            requireValue
            testID="preview-locale"
            title="Locale"
            value={state.locale}
          />
          {shareQuery ? (
            <Box gap={1}>
              <Text bold size="sm">
                Share query
              </Text>
              <Text size="sm" testID="demo-preview-query">{`?${shareQuery}`}</Text>
            </Box>
          ) : null}
        </Box>
      </Modal>
    </Box>
  );
};
