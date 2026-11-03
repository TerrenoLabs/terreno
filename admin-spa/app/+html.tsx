import {ScrollViewStyleReset, useServerDocumentContext} from "expo-router/html";
import type React from "react";
import {getAdminSpaRequest, getAdminSpaServerContext, serializeForHtml} from "../src/serverContext";

/**
 * Document shell for the server-rendered admin SPA. Renders only on the server, where the
 * serve plugin has published the mount path and runtime config; it writes both into the page
 * so `AppConfigGate` hydrates from them without fetching `app-config.json`.
 */
const Root: React.FC<{children: React.ReactNode}> = ({children}) => {
  const {htmlAttributes, bodyAttributes, headNodes, bodyNodes} = useServerDocumentContext();
  // The request scope, set by the serve plugin for each render, wins over the process context.
  const context = getAdminSpaRequest() ?? getAdminSpaServerContext();
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
