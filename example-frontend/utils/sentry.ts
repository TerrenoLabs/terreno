import type {StoreEnhancer} from "@reduxjs/toolkit";
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

export const createSentryReduxEnhancer = (): StoreEnhancer => {
  if (IsWeb && typeof Sentry.createReduxEnhancer === "function") {
    return Sentry.createReduxEnhancer();
  }

  const passThrough: StoreEnhancer = (next) => next;
  return passThrough;
};
