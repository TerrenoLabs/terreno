import type {SegmentFunction} from "@terreno/feature-flags";

/** Segments registered on the example app's FeatureFlagsApp. */
export const exampleFeatureFlagSegments: Record<string, SegmentFunction> = {
  "admin-users": (user: unknown) => (user as {admin?: boolean}).admin === true,
  "has-name": (user: unknown) => Boolean((user as {name?: string}).name),
  "oauth-users": (user: unknown) => Boolean((user as {oauthProvider?: string}).oauthProvider),
};
