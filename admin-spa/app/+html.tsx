import {ScrollViewStyleReset, useServerDocumentContext} from "expo-router/html";
import type React from "react";
import {getAdminSpaServerContext} from "../src/serverContext";

/**
 * Serialize a value for an inline `<script>`: JSON with every character that could close
 * the script or break a JS string literal escaped.
 */
const serializeForInlineScript = (value: unknown): string => {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026")
    .replaceAll(" ", "\\u2028")
    .replaceAll(" ", "\\u2029");
};

/**
 * Document shell for the server-rendered admin SPA. Renders only on the server, where the
 * serve plugin has published the mount path and runtime config; it writes both into the page
 * so `AppConfigGate` hydrates from them without fetching `app-config.json`.
 */
const Root: React.FC<{children: React.ReactNode}> = ({children}) => {
  const {htmlAttributes, bodyAttributes, headNodes, bodyNodes} = useServerDocumentContext();
  const context = getAdminSpaServerContext();
  const bootstrap = context
    ? `window.__ADMIN_SPA_BASE__=${serializeForInlineScript(context.basePath)};` +
      `window.__ADMIN_SPA_CONFIG__=${serializeForInlineScript(context.appConfig)};`
    : "";

  return (
    <html lang="en" {...htmlAttributes}>
      <head>
        <meta charSet="utf-8" />
        <meta content="IE=edge" httpEquiv="X-UA-Compatible" />
        <meta content="width=device-width, initial-scale=1, shrink-to-fit=no" name="viewport" />
        <ScrollViewStyleReset />
        {bootstrap ? <script dangerouslySetInnerHTML={{__html: bootstrap}} /> : null}
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
