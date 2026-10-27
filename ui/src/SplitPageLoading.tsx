import type {FC, ReactNode} from "react";

import {Box} from "./Box";
import type {LoadingProps} from "./Common";

interface SplitPageLoadingProps extends LoadingProps {
  children: ReactNode;
  spinner: ReactNode;
}

// Every SplitPage test id is a fixed `split-page-*` value because SplitPage takes no testID prop.
const SPLIT_PAGE_LOADING_TEST_ID = "split-page-loading";

/**
 * SplitPage's loading region, shared by the web and native SplitPage. Without a
 * `loadingComponent`, a busy spinner sits beside the content; with one, the placeholder replaces
 * the list and detail. Both paths announce `loadingLabel` and set the busy state.
 */
export const SplitPageLoading: FC<SplitPageLoadingProps> = ({
  children,
  loading,
  loadingAnimation,
  loadingComponent,
  loadingLabel,
  spinner,
}) => {
  if (!loading) {
    return <>{children}</>;
  }
  if (!loadingComponent) {
    return (
      <>
        <Box
          loading
          loadingComponent={spinner}
          loadingLabel={loadingLabel}
          testID={SPLIT_PAGE_LOADING_TEST_ID}
        />
        {children}
      </>
    );
  }
  return (
    <Box
      flex="grow"
      loading
      loadingAnimation={loadingAnimation}
      loadingComponent={loadingComponent}
      loadingLabel={loadingLabel}
      testID={SPLIT_PAGE_LOADING_TEST_ID}
    />
  );
};
