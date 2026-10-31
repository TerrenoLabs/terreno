import * as Sentry from "@sentry/react";
import {Platform} from "react-native";

const IsWeb = Platform.OS === "web";

export const captureException = (error: unknown | Error): void => {
  if (!IsWeb) {
    return;
  }
  if (Sentry.isInitialized()) {
    Sentry.captureException(error);
  } else {
    console.error("Sentry not initialized, captured exception", error);
  }
};
