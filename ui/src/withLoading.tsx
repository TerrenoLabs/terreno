import type {ComponentType, FC, ReactNode} from "react";

import {Box} from "./Box";
import type {LoadingProps, SkeletonAnimation} from "./Common";

export interface WithLoadingOptions {
  /** Animation used when the caller does not pass `loadingAnimation`. */
  loadingAnimation?: SkeletonAnimation;
  /** Placeholder used when the caller does not pass `loadingComponent`. */
  loadingComponent?: ReactNode;
}

/**
 * Gives a custom component the shared `LoadingProps` contract. While `loading` is true it renders
 * `loadingComponent` in a busy `Box` instead of the component. Use it for components that do not
 * already take a `loading` prop of their own, since the wrapper consumes it.
 *
 * ```tsx
 * const UserRowWithLoading = withLoading(UserRow, {loadingComponent: <SkeletonList rows={1} />});
 * <UserRowWithLoading loading={isLoading} user={user} />
 * ```
 */
export const withLoading = <P extends object>(
  Component: ComponentType<P>,
  options: WithLoadingOptions = {}
): FC<P & LoadingProps> => {
  const WithLoading: FC<P & LoadingProps> = ({
    loading,
    loadingAnimation,
    loadingComponent,
    loadingLabel,
    ...props
  }) => {
    if (!loading) {
      return <Component {...(props as P)} />;
    }
    const testID = (props as {testID?: string}).testID;
    return (
      <Box
        loading
        loadingAnimation={loadingAnimation ?? options.loadingAnimation}
        loadingComponent={loadingComponent ?? options.loadingComponent}
        loadingLabel={loadingLabel}
        testID={testID ? `${testID}-loading` : undefined}
      />
    );
  };
  WithLoading.displayName = `withLoading(${Component.displayName ?? Component.name ?? "Component"})`;
  return WithLoading;
};
