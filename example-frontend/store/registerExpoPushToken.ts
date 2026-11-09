export interface RegisterExpoPushTokenInput {
  getToken: () => Promise<{data: string}>;
  platform: string;
  postToken: (body: {platform: "android" | "ios"; token: string}) => Promise<unknown>;
}

export interface ReleaseExpoPushTokenInput {
  deleteToken: (id: string) => Promise<unknown>;
}

// The PushToken row this device registered in this session, released on sign-out so the
// signed-out account stops receiving pushes here and the next account can claim the device.
let registeredPushTokenId: string | undefined;

const pushTokenIdFrom = (result: unknown): string | undefined => {
  const record = result as {_id?: unknown; data?: {_id?: unknown}} | null | undefined;
  const id = record?._id ?? record?.data?._id;
  return typeof id === "string" && id.length > 0 ? id : undefined;
};

/** @internal */
export const registerExpoPushToken = async ({
  getToken,
  platform,
  postToken,
}: RegisterExpoPushTokenInput): Promise<"registered" | "skipped"> => {
  if (platform === "web") {
    return "skipped";
  }
  const token = await getToken();
  if (!token.data) {
    return "skipped";
  }
  const mappedPlatform = platform === "android" ? "android" : "ios";
  const posted = await postToken({platform: mappedPlatform, token: token.data});
  registeredPushTokenId = pushTokenIdFrom(posted) ?? registeredPushTokenId;
  return "registered";
};

export const registerExpoPushTokenSafely = async (
  input: RegisterExpoPushTokenInput
): Promise<"registered" | "skipped"> => {
  try {
    return await registerExpoPushToken(input);
  } catch (error: unknown) {
    console.warn("[comms] Failed to register Expo push token", error);
    return "skipped";
  }
};

/** @internal */
export const releaseExpoPushToken = async ({
  deleteToken,
}: ReleaseExpoPushTokenInput): Promise<"released" | "skipped"> => {
  const id = registeredPushTokenId;
  if (!id) {
    return "skipped";
  }
  await deleteToken(id);
  registeredPushTokenId = undefined;
  return "released";
};

/** Release this device's push token before sign-out; a failure must not block signing out. */
export const releaseExpoPushTokenSafely = async (
  input: ReleaseExpoPushTokenInput
): Promise<"released" | "skipped"> => {
  try {
    return await releaseExpoPushToken(input);
  } catch (error: unknown) {
    console.warn("[comms] Failed to release Expo push token", error);
    return "skipped";
  }
};
