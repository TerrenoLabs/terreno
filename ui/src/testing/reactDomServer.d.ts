// ResponsiveBreakpoint.test.tsx renders through react-dom/server to cover the SSR path, and the
// workspace does not install @types/react-dom. Declare only the entry point the tests use.
declare module "react-dom/server" {
  import type {ReactNode} from "react";

  export const renderToString: (element: ReactNode) => string;
}
