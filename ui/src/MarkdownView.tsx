import React, {lazy, Suspense, useCallback, useEffect, useMemo} from "react";
import {Linking, Platform, ScrollView} from "react-native";
import type Markdown from "react-native-markdown-display";
import {FitImage, renderRules} from "react-native-markdown-display";

import {Box} from "./Box";
import {contrastRatio, WCAG_NORMAL_TEXT_CONTRAST} from "./colorContrast";
import {MarkdownEmbed} from "./MarkdownEmbed";
import {isEmbeddableMediaUrl, toMediaEmbedUrl} from "./markdownEmbeds";
import {Spinner} from "./Spinner";
import {useTerrenoFontsLoaded} from "./TerrenoFontProvider";
import {useTheme} from "./Theme";

const LazyMarkdown = lazy(() =>
  import("react-native-markdown-display").then((moduleNamespace) => ({
    default: moduleNamespace.default,
  }))
);

const IS_WEB = Platform.OS === "web";
const MARKDOWN_SIZES = {
  lg: IS_WEB ? 24 : 20,
  md: IS_WEB ? 18 : 16,
  sm: IS_WEB ? 16 : 14,
  xl: IS_WEB ? 32 : 28,
} as const;
const MONO_FONT = IS_WEB ? "monospace" : Platform.select({android: "monospace", ios: "Menlo"});
const TEXT_FONT_SIZE = IS_WEB ? 16 : 14;
const TEXT_LINE_HEIGHT = IS_WEB ? 24 : 20;
// Keeps columns readable; past this width per column the table scrolls sideways.
const TABLE_MIN_COLUMN_WIDTH = 96;
const TABLE_SCROLL_CONTENT_STYLE = {minWidth: "100%"} as const;

interface MarkdownViewProps {
  children: React.ReactNode;
  inverted?: boolean;
  onLoad?: () => void;
}

const MarkdownLoadNotifier: React.FC<{onLoad?: () => void}> = ({onLoad}) => {
  // Fire after react-native-markdown-display has resolved so callers can ignore spinner height.
  useEffect(() => {
    onLoad?.();
  }, [onLoad]);
  return null;
};

// Takes markdown and renders it with our theme. We should open source this component.
const MarkdownViewComponent: React.FC<MarkdownViewProps> = ({children, inverted, onLoad}) => {
  const {theme} = useTheme();
  useTerrenoFontsLoaded();
  const textColor = inverted ? theme.text.inverted : theme.text.primary;
  const markdownStyle = useMemo<React.ComponentProps<typeof Markdown>["style"]>(() => {
    const color = {color: textColor};
    const tableCellStyle = {
      borderBottomWidth: 1,
      borderColor: theme.border.default,
      borderRightWidth: 1,
      // Replaces the library's `flex: 1` so cells keep a minimum width in the scroll view.
      flex: undefined,
      flexBasis: 0,
      flexGrow: 1,
      flexShrink: 0,
      minWidth: TABLE_MIN_COLUMN_WIDTH,
      padding: 8,
    };
    const markdownTextStyle = {
      fontFamily: "text-regular",
      fontSize: TEXT_FONT_SIZE,
      lineHeight: TEXT_LINE_HEIGHT,
      ...color,
    };

    const blockquoteBackground =
      contrastRatio(textColor, theme.surface.baseAlternate) >= WCAG_NORMAL_TEXT_CONTRAST
        ? theme.surface.baseAlternate
        : theme.surface.neutralDark;
    // Inverted text on neutralLight is about 2:1 in dark mode. Prefer that fill, then
    // neutralDark, so code stays on the lighter chip when primary text already passes.
    const codeBackground =
      contrastRatio(textColor, theme.surface.neutralLight) >= WCAG_NORMAL_TEXT_CONTRAST
        ? theme.surface.neutralLight
        : theme.surface.neutralDark;

    return {
      blockquote: {
        backgroundColor: blockquoteBackground,
        borderColor: theme.border.default,
        borderLeftWidth: 4,
        marginLeft: 0,
        paddingHorizontal: 12,
        paddingVertical: 4,
      },
      body: {width: "100%", ...markdownTextStyle},
      bullet_list: {width: "100%"},
      bullet_list_content: {flex: 1, flexShrink: 1, minWidth: 0},
      bullet_list_icon: {
        flexShrink: 0,
        marginLeft: 0,
        marginRight: 8,
        minWidth: 16,
        textAlign: "center",
        ...markdownTextStyle,
      },
      code_block: {
        backgroundColor: codeBackground,
        borderColor: theme.border.default,
        borderRadius: 4,
        borderWidth: 1,
        fontFamily: MONO_FONT,
        fontSize: 13,
        padding: 8,
        ...color,
      },
      code_inline: {
        backgroundColor: codeBackground,
        borderColor: theme.border.default,
        borderRadius: 3,
        borderWidth: 1,
        fontFamily: MONO_FONT,
        fontSize: 13,
        paddingHorizontal: 4,
        paddingVertical: 1,
        ...color,
      },
      fence: {
        backgroundColor: codeBackground,
        borderColor: theme.border.default,
        borderRadius: 4,
        borderWidth: 1,
        fontFamily: MONO_FONT,
        fontSize: 13,
        padding: 8,
        ...color,
      },
      heading1: {
        fontFamily: "heading-bold",
        fontSize: MARKDOWN_SIZES.xl,
        lineHeight: MARKDOWN_SIZES.xl * 1.25,
        ...color,
      },
      heading2: {
        fontFamily: "heading-bold",
        fontSize: MARKDOWN_SIZES.lg,
        lineHeight: MARKDOWN_SIZES.lg * 1.25,
        ...color,
      },
      heading3: {
        fontFamily: "heading-bold",
        fontSize: MARKDOWN_SIZES.md,
        lineHeight: MARKDOWN_SIZES.md * 1.25,
        ...color,
      },
      heading4: {
        fontFamily: "heading-semibold",
        fontSize: MARKDOWN_SIZES.sm,
        lineHeight: MARKDOWN_SIZES.sm * 1.25,
        ...color,
      },
      // h5/h6 map to small as well for consistency, slightly smaller visually handled by weight
      heading5: {
        fontFamily: "heading-semibold",
        fontSize: MARKDOWN_SIZES.sm,
        lineHeight: MARKDOWN_SIZES.sm * 1.25,
        ...color,
      },
      heading6: {
        fontFamily: "heading-semibold",
        fontSize: MARKDOWN_SIZES.sm,
        lineHeight: MARKDOWN_SIZES.sm * 1.25,
        ...color,
      },
      list_item: {alignItems: "flex-start", flexDirection: "row", width: "100%"},
      ordered_list: {width: "100%"},
      ordered_list_content: {flex: 1, flexShrink: 1, minWidth: 0},
      ordered_list_icon: {
        flexShrink: 0,
        marginLeft: 0,
        marginRight: 8,
        minWidth: 32,
        textAlign: "right",
        ...markdownTextStyle,
      },
      paragraph: {flexShrink: 1, width: "100%", ...markdownTextStyle},
      // Grid borders: the table draws top/left, every cell draws right/bottom.
      table: {
        borderColor: theme.border.default,
        borderLeftWidth: 1,
        borderRadius: 0,
        borderTopWidth: 1,
        borderWidth: 0,
        flexGrow: 1,
      },
      td: {...tableCellStyle, fontFamily: "text-regular"},
      text: color,
      textgroup: {flexShrink: 1, minWidth: 0},
      th: {
        ...tableCellStyle,
        backgroundColor: theme.surface.secondaryLight,
        fontFamily: "text-bold",
      },
      tr: {borderBottomWidth: 0, borderColor: theme.border.default, flexDirection: "row"},
    };
  }, [
    textColor,
    theme.border.default,
    theme.surface.baseAlternate,
    theme.surface.neutralDark,
    theme.surface.neutralLight,
    theme.surface.secondaryLight,
  ]);

  const handleLinkPress = useCallback((url: string): boolean => {
    void Linking.openURL(url);
    return false;
  }, []);

  const markdownRules = useMemo<React.ComponentProps<typeof Markdown>["rules"]>(() => {
    return {
      image: (node, _children, _parent, styles, allowedImageHandlers, defaultImageHandler) => {
        const src = node.attributes?.src;
        if (typeof src === "string" && isEmbeddableMediaUrl(src) && toMediaEmbedUrl(src)) {
          return <MarkdownEmbed key={node.key} url={src} />;
        }
        if (typeof src !== "string") {
          return null;
        }
        const isAllowed = allowedImageHandlers.some((handler) =>
          src.toLowerCase().startsWith(handler.toLowerCase())
        );
        if (!isAllowed && defaultImageHandler === null) {
          return null;
        }
        const alt = node.attributes?.alt;
        return (
          <FitImage
            accessibilityLabel={typeof alt === "string" ? alt : undefined}
            accessible={Boolean(alt)}
            indicator
            key={node.key}
            source={{uri: isAllowed ? src : `${defaultImageHandler}${src}`}}
            style={styles._VIEW_SAFE_image}
          />
        );
      },
      link: (node, children, parent, styles, onLinkPress) => {
        const href = node.attributes?.href;
        if (typeof href === "string" && isEmbeddableMediaUrl(href) && toMediaEmbedUrl(href)) {
          return <MarkdownEmbed key={node.key} url={href} />;
        }
        return renderRules.link?.(node, children, parent, styles, onLinkPress);
      },
      // Tables wider than their container scroll sideways instead of squeezing columns. The
      // wrapper stays a ScrollView: Box `scroll` fixes its contentContainerStyle and puts the
      // testID on the inner view, so it cannot give the content `minWidth: 100%`.
      table: (node, children, _parent, styles) => (
        <ScrollView
          contentContainerStyle={TABLE_SCROLL_CONTENT_STYLE}
          horizontal
          key={node.key}
          testID="markdown-table-scroll"
        >
          <Box
            dangerouslySetInlineStyle={{__style: styles._VIEW_SAFE_table}}
            testID="markdown-table"
          >
            {children}
          </Box>
        </ScrollView>
      ),
      td: (node, children, parent, styles) => (
        <Box
          dangerouslySetInlineStyle={{__style: styles._VIEW_SAFE_td}}
          key={node.key}
          testID={`markdown-table-cell-${parent[0]?.index ?? 0}-${node.index}`}
        >
          {children}
        </Box>
      ),
      th: (node, children, _parent, styles) => (
        <Box
          dangerouslySetInlineStyle={{__style: styles._VIEW_SAFE_th}}
          key={node.key}
          testID={`markdown-table-header-${node.index}`}
        >
          {children}
        </Box>
      ),
    };
  }, []);

  return (
    <Suspense fallback={<Spinner />}>
      <MarkdownLoadNotifier onLoad={onLoad} />
      <LazyMarkdown onLinkPress={handleLinkPress} rules={markdownRules} style={markdownStyle}>
        {children}
      </LazyMarkdown>
    </Suspense>
  );
};

MarkdownViewComponent.displayName = "MarkdownView";

export const MarkdownView = React.memo(MarkdownViewComponent);
