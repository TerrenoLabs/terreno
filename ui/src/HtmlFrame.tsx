import React, {useRef} from "react";
import {Platform} from "react-native";
import WebView from "react-native-webview";

import {Box} from "./Box";
import type {HtmlFrameProps} from "./Common";

export type {HtmlFrameProps} from "./Common";

const HTML_FRAME_HEIGHTS = {lg: 640, md: 400, sm: 240} as const;

const CSP =
  "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; form-action 'none'; base-uri 'none'";

/** The document a frame loads. The CSP meta tag is first so it applies to the preview. */
export const htmlFrameSrcDoc = (html: string): string =>
  `<meta http-equiv="Content-Security-Policy" content="${CSP}">${html}`;

/**
 * Sandboxed preview of agent HTML. Web uses an iframe with an empty sandbox.
 * Native uses a WebView with JavaScript off and navigation blocked after the first load.
 */
export const HtmlFrame: React.FC<HtmlFrameProps> = ({height = "md", html, title}) => {
  const srcDoc = htmlFrameSrcDoc(html);
  const pixels = HTML_FRAME_HEIGHTS[height];
  const didLoad = useRef(false);

  if (Platform.OS === "web") {
    return (
      <Box height={pixels} testID="html-frame-web" width="100%">
        <iframe
          referrerPolicy="no-referrer"
          sandbox=""
          srcDoc={srcDoc}
          style={{border: 0, height: "100%", width: "100%"}}
          title={title ?? "Agent-generated preview"}
        />
      </Box>
    );
  }

  return (
    <Box height={pixels} testID="html-frame-native" width="100%">
      <WebView
        dataDetectorTypes="none"
        incognito
        javaScriptEnabled={false}
        onShouldStartLoadWithRequest={() => {
          if (didLoad.current) {
            return false;
          }
          didLoad.current = true;
          return true;
        }}
        source={{html: srcDoc}}
        style={{flex: 1}}
      />
    </Box>
  );
};
