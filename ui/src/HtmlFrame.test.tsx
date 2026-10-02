import {describe, expect, it, mock} from "bun:test";
import {Platform, View} from "react-native";

import {HtmlFrame, htmlFrameSrcDoc} from "./HtmlFrame";
import {renderWithTheme} from "./test-utils";

mock.module("react-native-webview", () => ({
  default: ({
    javaScriptEnabled,
    onShouldStartLoadWithRequest,
  }: {
    javaScriptEnabled?: boolean;
    onShouldStartLoadWithRequest?: () => boolean;
  }) => {
    const first = onShouldStartLoadWithRequest?.();
    const second = onShouldStartLoadWithRequest?.();
    return (
      <View
        accessibilityLabel={`js:${String(javaScriptEnabled)};first:${String(first)};second:${String(second)}`}
        testID="html-frame-webview"
      />
    );
  },
}));

describe("HtmlFrame", () => {
  const originalOS = Platform.OS;

  it("starts the web srcdoc with the CSP meta tag inside an empty sandbox", () => {
    Platform.OS = "web";
    const srcDoc = htmlFrameSrcDoc("<h1>Invoice</h1>");
    const result = renderWithTheme(<HtmlFrame html="<h1>Invoice</h1>" title="Invoice preview" />);
    expect(srcDoc.startsWith('<meta http-equiv="Content-Security-Policy"')).toBe(true);
    expect(result.getByTestId("html-frame-web")).toBeTruthy();
    expect(JSON.stringify(result.toJSON())).toContain('sandbox":""');
    Platform.OS = originalOS;
  });

  it("turns JavaScript off and blocks navigation after the first load", () => {
    Platform.OS = "ios";
    const result = renderWithTheme(<HtmlFrame html="<p>Invoice</p>" />);
    expect(result.getByLabelText("js:false;first:true;second:false")).toBeTruthy();
    Platform.OS = originalOS;
  });
});
