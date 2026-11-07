import * as Sentry from "@sentry/bun";
import {SENTRY_V10_DATA_COLLECTION} from "@terreno/api";

if (process.env.NODE_ENV === "production" && !process.env.SENTRY_DSN) {
  console.warn("WARNING: SENTRY_DSN is not set in production. Error tracking will be disabled.");
}

Sentry.init({
  dataCollection: SENTRY_V10_DATA_COLLECTION,
  dsn: process.env.SENTRY_DSN,
  environment: process.env.APP_ENV ?? "development",
  tracesSampleRate: process.env.SENTRY_TRACES_SAMPLE_RATE
    ? Number.parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE)
    : 0.1,
});
