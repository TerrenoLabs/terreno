import {ScrollViewStyleReset, useServerDocumentContext} from "expo-router/html";
import type React from "react";
import {Dimensions} from "react-native";
import {SSR_PAYLOAD_SCRIPT_ID} from "../components/ssrPayload";
import {getAdminSpaRequest, getAdminSpaServerContext, serializeForHtml} from "../src/serverContext";

/**
 * The viewport a server render lays out for. The server cannot know the browser's width, and
 * the admin console is used on desktops, so it renders the desktop layout: any browser at or
 * above the desktop breakpoint hydrates into the same tree. A narrower browser re-renders once.
 */
const SERVER_VIEWPORT = {fontScale: 1, height: 800, scale: 1, width: 1280};

// This module renders only on the server; Dimensions cannot be set in a browser.
if (typeof window === "undefined") {
  Dimensions.set({screen: SERVER_VIEWPORT, window: SERVER_VIEWPORT});
}

/**
 * Document shell for the server-rendered admin SPA. Renders only on the server, where the
 * serve plugin has published the mount path and runtime config; it writes both into the page
 * so `AppConfigGate` hydrates from them without fetching `app-config.json`.
 */
const Root: React.FC<{children: React.ReactNode}> = ({children}) => {
  const {htmlAttributes, bodyAttributes, headNodes, bodyNodes} = useServerDocumentContext();
  // The request scope, set by the serve plugin for each render, wins over the process context.
  const scope = getAdminSpaRequest();
  const context = scope ?? getAdminSpaServerContext();
  const bootstrap = context
    ? `window.__ADMIN_SPA_BASE__=${serializeForHtml(context.basePath)};` +
      `window.__ADMIN_SPA_CONFIG__=${serializeForHtml(context.appConfig)};`
    : "";

  return (
    <html lang="en" {...htmlAttributes}>
      <head>
        <meta charSet="utf-8" />
        <meta content="IE=edge" httpEquiv="X-UA-Compatible" />
        <meta content="width=device-width, initial-scale=1, shrink-to-fit=no" name="viewport" />
        <ScrollViewStyleReset />
        {bootstrap ? <script dangerouslySetInnerHTML={{__html: bootstrap}} /> : null}
        {/* The shell payload (session, profile, admin config); read once, then removed. */}
        {scope ? (
          <script
            dangerouslySetInnerHTML={{__html: serializeForHtml(scope)}}
            id={SSR_PAYLOAD_SCRIPT_ID}
            type="application/json"
          />
        ) : null}
        {headNodes}
      </head>
      <body {...bodyAttributes}>
        {children}
        {bodyNodes}
      </body>
    </html>
  );
};

export default Root;
