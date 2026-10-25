import {Box, Heading, IconButton, Modal, NumberField, Text, TextField, useTheme} from "@terreno/ui";
import React, {useCallback, useRef, useState} from "react";
import {type NativeSyntheticEvent, useWindowDimensions} from "react-native";
import {
  EnrichedText,
  EnrichedTextInput,
  type EnrichedTextInputInstance,
  type OnChangeHtmlEvent,
  type OnChangeSelectionEvent,
  type OnChangeStateEvent,
} from "react-native-enriched-html";

import {StorybookContainer} from "./StorybookContainer";

const SAMPLE_HTML =
  "<h2>Weekly update</h2><p>Maria attended two groups and reported <b>better sleep</b>.</p><ul><li>Meds taken as prescribed</li><li>Missed Thursday session</li></ul><p>Next step: confirm the <i>safety plan</i> review.</p>";

const EDITOR_HEIGHT = 320;
const DEFAULT_IMAGE_WIDTH = "320";
const DEFAULT_IMAGE_HEIGHT = "180";

const RichTextPreview = (): React.ReactElement => (
  <Box alignItems="center" gap={2} justifyContent="center" padding={3} width="100%">
    <Heading size="sm">Weekly update</Heading>
    <Text align="center" color="secondaryLight" size="sm">
      Bold, lists, and headings stored as HTML.
    </Text>
  </Box>
);

export const RichTextMarkdownDemo = (props: {preview?: boolean}): React.ReactElement => {
  if (props.preview) {
    return <RichTextPreview />;
  }

  return <RichTextInteractive />;
};

const RichTextInteractive = (): React.ReactElement => {
  const editorRef = useRef<EnrichedTextInputInstance>(null);
  const selectionRef = useRef<OnChangeSelectionEvent>({end: 0, start: 0, text: ""});
  const {theme} = useTheme();
  const {width} = useWindowDimensions();
  const isDesktop = width >= 768;
  const [html, setHtml] = useState(SAMPLE_HTML);
  const [styleState, setStyleState] = useState<OnChangeStateEvent | null>(null);
  const [isLinkOpen, setIsLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("https://");
  const [isImageOpen, setIsImageOpen] = useState(false);
  const [imageUrl, setImageUrl] = useState("https://");
  const [imageWidth, setImageWidth] = useState(DEFAULT_IMAGE_WIDTH);
  const [imageHeight, setImageHeight] = useState(DEFAULT_IMAGE_HEIGHT);

  const handleHtmlChange = useCallback((event: NativeSyntheticEvent<OnChangeHtmlEvent>): void => {
    setHtml(event.nativeEvent.value);
  }, []);

  const handleStateChange = useCallback((event: NativeSyntheticEvent<OnChangeStateEvent>): void => {
    setStyleState(event.nativeEvent);
  }, []);

  const handleSelectionChange = useCallback(
    (event: NativeSyntheticEvent<OnChangeSelectionEvent>): void => {
      selectionRef.current = event.nativeEvent;
    },
    []
  );

  const toggleBold = useCallback((): void => {
    editorRef.current?.toggleBold();
  }, []);
  const toggleItalic = useCallback((): void => {
    editorRef.current?.toggleItalic();
  }, []);
  const toggleHeading = useCallback((): void => {
    editorRef.current?.toggleH2();
  }, []);
  const toggleBullets = useCallback((): void => {
    editorRef.current?.toggleUnorderedList();
  }, []);
  const toggleNumbers = useCallback((): void => {
    editorRef.current?.toggleOrderedList();
  }, []);

  const openLink = useCallback((): void => {
    if (styleState?.link.isActive) {
      const {start, end} = selectionRef.current;
      editorRef.current?.removeLink(start, end);
      return;
    }
    setLinkUrl("https://");
    setIsLinkOpen(true);
  }, [styleState?.link.isActive]);

  const applyLink = useCallback((): void => {
    const url = linkUrl.trim();
    if (!url) {
      return;
    }
    const {end, start, text} = selectionRef.current;
    editorRef.current?.setLink(start, end, text || "link", url);
    setIsLinkOpen(false);
  }, [linkUrl]);

  const dismissLink = useCallback((): void => {
    setIsLinkOpen(false);
  }, []);

  const openImage = useCallback((): void => {
    setImageUrl("https://");
    setImageWidth(DEFAULT_IMAGE_WIDTH);
    setImageHeight(DEFAULT_IMAGE_HEIGHT);
    setIsImageOpen(true);
  }, []);

  const applyImage = useCallback((): void => {
    const src = imageUrl.trim();
    const width = Number.parseInt(imageWidth, 10);
    const height = Number.parseInt(imageHeight, 10);
    if (!src || !Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
      return;
    }
    editorRef.current?.setImage(src, width, height);
    setIsImageOpen(false);
  }, [imageHeight, imageUrl, imageWidth]);

  const dismissImage = useCallback((): void => {
    setIsImageOpen(false);
  }, []);

  return (
    <StorybookContainer>
      <Box gap={3} width="100%">
        <Heading size="md">Weekly update</Heading>
        <Text color="secondaryLight" size="sm">
          The note is stored as HTML. The same editor runs on web, iOS, and Android. The preview
          uses EnrichedText.
        </Text>
        <Box alignItems="stretch" direction={isDesktop ? "row" : "column"} gap={4}>
          <Box direction="column" flex="grow" gap={2}>
            <Box direction="row" gap={1} wrap>
              <IconButton
                accessibilityLabel="Bold"
                iconName="bold"
                onClick={toggleBold}
                size="sm"
                state={styleState?.bold.isActive ? "active" : "default"}
                testID="rich-text-bold"
                variant="muted"
              />
              <IconButton
                accessibilityLabel="Italic"
                iconName="italic"
                onClick={toggleItalic}
                size="sm"
                state={styleState?.italic.isActive ? "active" : "default"}
                testID="rich-text-italic"
                variant="muted"
              />
              <IconButton
                accessibilityLabel="Heading"
                iconName="heading"
                onClick={toggleHeading}
                size="sm"
                state={styleState?.h2.isActive ? "active" : "default"}
                testID="rich-text-heading"
                variant="muted"
              />
              <IconButton
                accessibilityLabel="Bullet list"
                iconName="list-ul"
                onClick={toggleBullets}
                size="sm"
                state={styleState?.unorderedList.isActive ? "active" : "default"}
                testID="rich-text-bullets"
                variant="muted"
              />
              <IconButton
                accessibilityLabel="Numbered list"
                iconName="list-ol"
                onClick={toggleNumbers}
                size="sm"
                state={styleState?.orderedList.isActive ? "active" : "default"}
                testID="rich-text-numbers"
                variant="muted"
              />
              <IconButton
                accessibilityLabel={styleState?.link.isActive ? "Remove link" : "Add link"}
                iconName="link"
                onClick={openLink}
                size="sm"
                state={styleState?.link.isActive ? "active" : "default"}
                testID="rich-text-link"
                variant="muted"
              />
              <IconButton
                accessibilityLabel="Insert image"
                iconName="image"
                onClick={openImage}
                size="sm"
                testID="rich-text-image"
                variant="muted"
              />
            </Box>
            <Box border="default" height={EDITOR_HEIGHT} overflow="hidden" rounding="md">
              <EnrichedTextInput
                defaultValue={SAMPLE_HTML}
                htmlStyle={{
                  h2: {fontSize: 20},
                }}
                onChangeHtml={handleHtmlChange}
                onChangeSelection={handleSelectionChange}
                onChangeState={handleStateChange}
                placeholder="Write a weekly update..."
                ref={editorRef}
                style={{
                  color: theme.text.primary,
                  fontSize: 16,
                  height: EDITOR_HEIGHT,
                  padding: 12,
                }}
                testID="rich-text-editor"
              />
            </Box>
          </Box>
          <Box direction="column" flex="grow" gap={3}>
            <Box gap={1}>
              <Heading size="sm">Stored HTML</Heading>
              <Box
                border="default"
                color="neutralLight"
                padding={3}
                rounding="md"
                testID="rich-text-html"
              >
                <Text size="sm">{html}</Text>
              </Box>
            </Box>
            <Box gap={1}>
              <Heading size="sm">EnrichedText</Heading>
              <Box border="default" padding={3} rounding="md" testID="rich-text-preview">
                <EnrichedText style={{color: theme.text.primary, fontSize: 16}}>
                  {html}
                </EnrichedText>
              </Box>
            </Box>
          </Box>
        </Box>
      </Box>
      <Modal
        onDismiss={dismissLink}
        primaryButtonOnClick={applyLink}
        primaryButtonText="Apply"
        secondaryButtonOnClick={dismissLink}
        secondaryButtonText="Cancel"
        title="Add link"
        visible={isLinkOpen}
      >
        <Box gap={2}>
          <Text size="sm">Select text in the editor, then apply a URL.</Text>
          <TextField
            onChange={setLinkUrl}
            placeholder="https://"
            testID="rich-text-link-url"
            title="URL"
            value={linkUrl}
          />
        </Box>
      </Modal>
      <Modal
        onDismiss={dismissImage}
        primaryButtonOnClick={applyImage}
        primaryButtonText="Insert"
        secondaryButtonOnClick={dismissImage}
        secondaryButtonText="Cancel"
        title="Insert image"
        visible={isImageOpen}
      >
        <Box gap={2}>
          <Text size="sm">The image is inserted at the cursor and stored in the HTML.</Text>
          <TextField
            onChange={setImageUrl}
            placeholder="https://"
            testID="rich-text-image-url"
            title="Image URL"
            value={imageUrl}
          />
          <Box direction="row" gap={2}>
            <Box flex="grow">
              <NumberField
                onChange={setImageWidth}
                testID="rich-text-image-width"
                title="Width"
                type="number"
                value={imageWidth}
              />
            </Box>
            <Box flex="grow">
              <NumberField
                onChange={setImageHeight}
                testID="rich-text-image-height"
                title="Height"
                type="number"
                value={imageHeight}
              />
            </Box>
          </Box>
        </Box>
      </Modal>
    </StorybookContainer>
  );
};
