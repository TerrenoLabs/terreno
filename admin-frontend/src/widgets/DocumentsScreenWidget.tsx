import React from "react";
import {DocumentStorageBrowser} from "../DocumentStorageBrowser";
import type {AdminScreenWidgetProps, ScreenWidgetComponent} from "../types";

export const DocumentsScreenWidget: React.FC<AdminScreenWidgetProps> = ({routeBase}) => {
  return <DocumentStorageBrowser backHref={routeBase} basePath="/documents" title="Documents" />;
};

export const DOCUMENT_STORAGE_ADMIN_WIDGETS: Record<string, ScreenWidgetComponent> = {
  documents: DocumentsScreenWidget,
};
