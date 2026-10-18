import {createContext} from "react";

import {defaultPreviewState, type DemoPreviewState} from "./previewState";

export const DemoPreviewContext = createContext<DemoPreviewState>(defaultPreviewState());
