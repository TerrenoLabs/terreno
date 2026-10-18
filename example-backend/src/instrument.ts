// Add our custom DateOnly type to mongoose as early as possible
import {DateOnly} from "@terreno/api";
import mongoose from "mongoose";

(mongoose.Schema.Types as typeof mongoose.Schema.Types & {DateOnly: typeof DateOnly}).DateOnly =
  DateOnly;

const isTracingEnabled = process.env.NODE_ENV === "production";
const serviceName = process.env.FLOURISH_SERVICE || "flourish-backend";
const serviceVersion = process.env.npm_package_version || "1.0.0";

// Initialize OpenTelemetry before other application imports. Mongoose instrumentation is
// deliberately omitted: explicitly patching the already-loaded Mongoose 9 module deadlocks
// createIndex in Bun-compiled binaries, preventing Cloud Run from ever opening its port.
import {TraceExporter} from "@google-cloud/opentelemetry-cloud-trace-exporter";
import {start as startTrace} from "@google-cloud/trace-agent";
import {ExpressInstrumentation} from "@opentelemetry/instrumentation-express";
import {HttpInstrumentation} from "@opentelemetry/instrumentation-http";
import {resourceFromAttributes} from "@opentelemetry/resources";
import {NodeSDK} from "@opentelemetry/sdk-node";
import {SemanticResourceAttributes} from "@opentelemetry/semantic-conventions";

if (isTracingEnabled) {
  const sdk = new NodeSDK({
    instrumentations: [
      new HttpInstrumentation({
        ignoreIncomingRequestHook: (req): boolean => {
          return (
            req.url?.includes("/health") ||
            req.url?.includes("/socket.io/") ||
            req.url?.includes("/openapi.json") ||
            false
          );
        },
      }),
      new ExpressInstrumentation(),
    ],
    resource: resourceFromAttributes({
      [SemanticResourceAttributes.SERVICE_NAME]: serviceName,
      [SemanticResourceAttributes.SERVICE_VERSION]: serviceVersion,
      [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: process.env.APP_ENV || "production",
    }),
    traceExporter: new TraceExporter({}),
  });

  sdk.start();
  startTrace({
    bufferSize: 1000,
    enabled: false,
    ignoreUrls: ["/health", "/health/", "/socket.io/", "/openapi.json"],
    samplingRate: process.env.TRACE_SAMPLING_RATE
      ? Number.parseFloat(process.env.TRACE_SAMPLING_RATE)
      : 0.1,
  });
}

// Initialize Sentry after trace agent
import * as Sentry from "@sentry/bun";

const sentryDsn = process.env.SENTRY_DSN;

const IGNORE_TRACES = ["health"];

if (!sentryDsn && process.env.NODE_ENV === "production") {
  process.stderr.write("SENTRY_DSN is not set; Sentry initialization skipped.\n");
}

if (sentryDsn) {
  Sentry.init({
    dsn: sentryDsn,
    environment: process.env.APP_ENV ?? "development",
    ignoreErrors: [/^.*ECONNRESET*$/, /^.*socket hang up*$/],
    integrations: [],
    tracesSampler: (samplingContext) => {
      const transactionName = samplingContext.name.toLowerCase();
      if (IGNORE_TRACES.some((trace) => transactionName.includes(trace.toLowerCase()))) {
        return 0.0;
      }
      return process.env.SENTRY_TRACES_SAMPLE_RATE
        ? Number.parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE)
        : 0.1;
    },
  });
}
