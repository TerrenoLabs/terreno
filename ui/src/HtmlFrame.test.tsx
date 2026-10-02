import {describe, expect, it, mock} from "bun:test";
import {Platform, View} from "react-native";

import {HtmlFrame, htmlFrameSrcDoc} from "./HtmlFrame";
import {renderWithTheme} from "./test-utils";

mock.module("react-native-webview", () => ({
  default: ({
    javaScriptEnabled,
    onShouldStartLoadWithRequest,
    source,
  }: {
    javaScriptEnabled?: boolean;
    onShouldStartLoadWithRequest?: (request: {url: string}) => boolean;
    source?: {html?: string};
  }) => {
    const first = onShouldStartLoadWithRequest?.({url: "about:srcdoc"});
    const second = onShouldStartLoadWithRequest?.({url: "https://evil.test"});
    const startsWithCsp = String(source?.html ?? "").startsWith(
      '<meta http-equiv="Content-Security-Policy"'
    );
    return (
      <View
        accessibilityLabel={`js:${String(javaScriptEnabled)};csp:${String(startsWithCsp)};first:${String(first)};second:${String(second)}`}
        testID="html-frame-webview"
      />
    );
  },
}));

describe("HtmlFrame", () => {
  const originalOS = Platform.OS;

  it("starts the web srcdoc with the CSP meta tag inside an empty sandbox", () => {
    Platform.OS = "web";
    const result = renderWithTheme(<HtmlFrame html="<h1>Invoice</h1>" title="Invoice preview" />);
    const rendered = JSON.stringify(result.toJSON());
    const srcDoc = htmlFrameSrcDoc("<h1>Invoice</h1>");
    expect(result.getByTestId("html-frame-web")).toBeTruthy();
    expect(rendered).toContain('sandbox":""');
    expect(rendered).toContain(JSON.stringify(srcDoc).slice(1, -1));
    expect(rendered.indexOf("Content-Security-Policy")).toBeLessThan(
      rendered.indexOf("<h1>Invoice")
    );
    Platform.OS = originalOS;
  });

  it("turns JavaScript off and blocks navigation after the first load", () => {
    Platform.OS = "ios";
    const result = renderWithTheme(<HtmlFrame html="<p>Invoice</p>" />);
    expect(result.getByLabelText("js:false;csp:true;first:true;second:false")).toBeTruthy();
    Platform.OS = originalOS;
  });
});
