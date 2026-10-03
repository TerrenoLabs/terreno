/** Boolean feature flag that turns user file uploads on and off. */
export const FILE_UPLOADS_FLAG_KEY = "file-uploads";

/**
 * Whether the upload UI should be shown.
 * Stay enabled while flags are loading, and when the flag has not been created yet.
 * A resolved `false` (flag disabled, or rollout off) hides uploads.
 */
export const fileUploadsEnabledFromFlags = ({
  flags,
  isLoading,
}: {
  flags: Record<string, boolean | string | null | undefined>;
  isLoading: boolean;
}): boolean => {
  if (isLoading) {
    return true;
  }
  return flags[FILE_UPLOADS_FLAG_KEY] !== false;
};
