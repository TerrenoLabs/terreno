// react-dom ships no type declarations and @types/react-dom is not installed; tests render to a
// string with only this export.
declare module "react-dom/server" {
  import type {ReactNode} from "react";

  export const renderToString: (element: ReactNode) => string;
}
