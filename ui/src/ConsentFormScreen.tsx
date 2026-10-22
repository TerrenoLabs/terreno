import React, {useCallback, useRef, useState} from "react";
import {
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Platform,
  Pressable,
  ScrollView,
  type ScrollViewInstance,
  View,
} from "react-native";

import {Box} from "./Box";
import {Button} from "./Button";
import {CheckBox} from "./CheckBox";
import {MarkdownView} from "./MarkdownView";
import {Modal} from "./Modal";
import {Page} from "./Page";
import {SignatureField} from "./SignatureField";
import {Text} from "./Text";
import type {ConsentFormPublic} from "./useConsentForms";

interface ConsentFormScreenProps {
  form: ConsentFormPublic;
  isSubmitting?: boolean;
  locale: string;
  onAgree: (data: {checkboxValues: Record<string, boolean>; signature?: string}) => void;
  onDecline?: () => void;
  variables?: Record<string, string>;
}

export const ConsentFormScreen: React.FC<ConsentFormScreenProps> = ({
  form,
  isSubmitting = false,
  locale,
  onAgree,
  onDecline,
  variables,
}) => {
  const [checkboxValues, setCheckboxValues] = useState<Record<string, boolean>>({});
  const [hasScrolledToBottom, setHasScrolledToBottom] = useState(!form.requireScrollToBottom);
  const [signatureValue, setSignatureValue] = useState<string | undefined>(undefined);
  const [confirmModalVisible, setConfirmModalVisible] = useState(false);
  const [confirmModalCheckboxIndex, setConfirmModalCheckboxIndex] = useState<number | null>(null);
  const [scrollEnabled, setScrollEnabled] = useState(true);
  const [contentHeight, setContentHeight] = useState(0);
  const [layoutHeight, setLayoutHeight] = useState(0);
  const [isMarkdownLoaded, setIsMarkdownLoaded] = useState(false);
  const lastContentHeightRef = useRef(0);
  const scrollViewRef = useRef<ScrollViewInstance>(null);

  const rawContent = form.content[locale] ?? form.content[form.defaultLocale] ?? "";
  const content = variables
    ? rawContent.replace(/\{\{(\w+)\}\}/g, (match, key) => variables[key] ?? match)
    : rawContent;

  const allRequiredCheckboxesChecked = form.checkboxes.every((checkbox, index) => {
    if (!checkbox.required) {
      return true;
    }
    return checkboxValues[index.toString()] === true;
  });

  const signatureProvided = !form.captureSignature || Boolean(signatureValue);
  const hasRequiredCheckboxes = form.checkboxes.some((checkbox) => checkbox.required);
  const hasDeclineButton = Boolean(form.allowDecline && onDecline);

  const canAgree = hasScrolledToBottom && allRequiredCheckboxesChecked && signatureProvided;
  const actionColumnStyle = {flexBasis: 0, minWidth: 0};

  const handleMarkdownLoad = useCallback((): void => {
    lastContentHeightRef.current = 0;
    setContentHeight(0);
    setHasScrolledToBottom(!form.requireScrollToBottom);
    setIsMarkdownLoaded(true);
    if (!form.requireScrollToBottom || Platform.OS !== "web") {
      return;
    }
    requestAnimationFrame(() => {
      const scrollNode = scrollViewRef.current?.getScrollableNode() as unknown as {
        clientHeight?: number;
        scrollHeight?: number;
      };
      if (
        typeof scrollNode?.clientHeight !== "number" ||
        typeof scrollNode.scrollHeight !== "number"
      ) {
        return;
      }
      setHasScrolledToBottom(scrollNode.scrollHeight <= scrollNode.clientHeight);
    });
  }, [form.requireScrollToBottom]);

  // Auto-satisfy only after markdown exists. Empty Spinner fallback (300ms delay) must not
  // unlock Agree. Reset only when content grows past the viewport, not when the hint unmounts.
  const handleContentSizeChange = useCallback(
    (_w: number, h: number): void => {
      const previousContentH = lastContentHeightRef.current;
      lastContentHeightRef.current = h;
      setContentHeight(h);
      if (!form.requireScrollToBottom || !isMarkdownLoaded || layoutHeight <= 0 || h <= 0) {
        return;
      }
      if (h <= layoutHeight) {
        setHasScrolledToBottom(true);
        return;
      }
      if (previousContentH > 0 && h > previousContentH) {
        setHasScrolledToBottom(false);
      }
    },
    [form.requireScrollToBottom, isMarkdownLoaded, layoutHeight]
  );

  const handleLayout = useCallback(
    (event: LayoutChangeEvent): void => {
      const h = event.nativeEvent.layout.height;
      setLayoutHeight(h);
      if (!form.requireScrollToBottom || !isMarkdownLoaded || contentHeight <= 0 || h <= 0) {
        return;
      }
      if (contentHeight <= h) {
        setHasScrolledToBottom(true);
      }
    },
    [contentHeight, form.requireScrollToBottom, isMarkdownLoaded]
  );

  const handleScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>): void => {
      if (!isMarkdownLoaded || hasScrolledToBottom) {
        return;
      }
      const {contentOffset, contentSize, layoutMeasurement} = event.nativeEvent;
      const distanceFromBottom = contentSize.height - layoutMeasurement.height - contentOffset.y;
      if (distanceFromBottom <= 20) {
        setHasScrolledToBottom(true);
      }
    },
    [hasScrolledToBottom, isMarkdownLoaded]
  );

  const handleCheckboxPress = (index: number) => {
    const checkbox = form.checkboxes[index];
    const key = index.toString();
    const currentValue = checkboxValues[key] ?? false;

    if (checkbox.confirmationPrompt && !currentValue) {
      // Show confirmation modal before toggling on
      setConfirmModalCheckboxIndex(index);
      setConfirmModalVisible(true);
    } else {
      setCheckboxValues((prev) => ({...prev, [key]: !currentValue}));
    }
  };

  const handleConfirmModalConfirm = () => {
    if (confirmModalCheckboxIndex !== null) {
      const key = confirmModalCheckboxIndex.toString();
      setCheckboxValues((prev) => ({...prev, [key]: true}));
    }
    setConfirmModalVisible(false);
    setConfirmModalCheckboxIndex(null);
  };

  const handleConfirmModalDismiss = () => {
    setConfirmModalVisible(false);
    setConfirmModalCheckboxIndex(null);
  };

  const handleAgree = () => {
    onAgree({checkboxValues, signature: signatureValue});
  };

  const confirmingCheckbox =
    confirmModalCheckboxIndex !== null ? form.checkboxes[confirmModalCheckboxIndex] : null;

  const footer = (
    <Box alignSelf="center" maxWidth={800} testID="consent-form-footer" width="100%">
      <Box
        direction={hasDeclineButton ? "row" : "column"}
        gap={4}
        paddingY={2}
        testID="consent-form-action-row"
        width="100%"
      >
        {hasDeclineButton && (
          <Box
            dangerouslySetInlineStyle={{__style: actionColumnStyle}}
            flex="grow"
            testID="consent-form-action-column"
          >
            <Button
              fullWidth
              onClick={onDecline!}
              testID="consent-form-decline-button"
              text={form.declineButtonText}
              variant="muted"
            />
          </Box>
        )}
        <Box
          dangerouslySetInlineStyle={{__style: hasDeclineButton ? actionColumnStyle : {}}}
          flex="grow"
          testID={hasDeclineButton ? "consent-form-action-column" : undefined}
        >
          <Button
            disabled={!canAgree}
            fullWidth
            loading={isSubmitting}
            onClick={handleAgree}
            testID="consent-form-agree-button"
            text={form.agreeButtonText}
          />
        </Box>
      </Box>
      {Boolean(form.requireScrollToBottom && !hasScrolledToBottom) && (
        <Text align="center" color="error" size="sm" testID="consent-footer-scroll-hint">
          Please scroll to the bottom to continue
        </Text>
      )}
      {Boolean(hasRequiredCheckboxes && !allRequiredCheckboxesChecked) && (
        <Text align="center" color="error" size="sm" testID="consent-footer-checkboxes-hint">
          Please check all required items marked with *
        </Text>
      )}
      {Boolean(form.captureSignature && !signatureValue) && (
        <Text align="center" color="error" size="sm" testID="consent-footer-signature-hint">
          Please provide your signature to continue
        </Text>
      )}
    </Box>
  );

  return (
    <Page color="base" footer={footer} maxWidth="100%" safeArea scroll={false} title={form.title}>
      <ScrollView
        onContentSizeChange={handleContentSizeChange}
        onLayout={handleLayout}
        onScroll={handleScroll}
        ref={scrollViewRef}
        scrollEnabled={scrollEnabled}
        scrollEventThrottle={16}
        style={{alignSelf: "center", flex: 1, maxWidth: 800, width: "100%"}}
        testID="consent-form-scroll-view"
      >
        <Box direction="column" gap={3} paddingY={2}>
          <MarkdownView onLoad={handleMarkdownLoad}>{content}</MarkdownView>

          {form.checkboxes.length > 0 && (
            <Box direction="column" gap={2} testID="consent-form-checkboxes">
              {hasRequiredCheckboxes && (
                <Text color="secondaryDark" size="sm" testID="consent-form-required-legend">
                  * indicates a required item
                </Text>
              )}
              {form.checkboxes.map((checkbox, index) => {
                const key = index.toString();
                const isChecked = checkboxValues[key] ?? false;

                return (
                  <Pressable
                    key={key}
                    onPress={() => handleCheckboxPress(index)}
                    testID={`consent-form-checkbox-${index}`}
                  >
                    <Box alignItems="center" direction="row" gap={2}>
                      <CheckBox selected={isChecked} size="md" />
                      <Box flex="grow">
                        <Text size="md">
                          {checkbox.label}
                          {checkbox.required && " *"}
                        </Text>
                      </Box>
                    </Box>
                  </Pressable>
                );
              })}
            </Box>
          )}

          {Boolean(form.captureSignature) && (
            <View
              onTouchEnd={Platform.OS === "ios" ? () => setScrollEnabled(true) : undefined}
              onTouchStart={Platform.OS === "ios" ? () => setScrollEnabled(false) : undefined}
              testID="consent-form-signature"
            >
              <SignatureField
                fullWidth
                onChange={(value) => setSignatureValue(value)}
                onEnd={() => setScrollEnabled(true)}
                onStart={() => setScrollEnabled(false)}
                title="Signature"
                value={signatureValue}
              />
            </View>
          )}

          {Boolean(form.requireScrollToBottom && !hasScrolledToBottom) && (
            <Box paddingY={2} testID="consent-form-scroll-hint">
              <Text color="secondaryDark" size="sm">
                Please scroll to the bottom to continue.
              </Text>
            </Box>
          )}
        </Box>
      </ScrollView>

      {confirmingCheckbox && (
        <Modal
          onDismiss={handleConfirmModalDismiss}
          primaryButtonOnClick={handleConfirmModalConfirm}
          primaryButtonText="Confirm"
          secondaryButtonOnClick={handleConfirmModalDismiss}
          secondaryButtonText="Cancel"
          text={confirmingCheckbox.confirmationPrompt}
          title="Please confirm"
          visible={confirmModalVisible}
        />
      )}
    </Page>
  );
};
