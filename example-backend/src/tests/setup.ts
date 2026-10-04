import {registerSimpleMongoPreload} from "@terreno/test";
import mongoose from "mongoose";

process.env.TERRENO_TEST_USE_MEMORY_MONGO = "true";

const defaultLocalMongoUri =
  process.env.TEST_MONGO_URI ||
  "mongodb://127.0.0.1:27017/terreno-example-test?connectTimeoutMS=360000";

registerSimpleMongoPreload({
  defaultLocalMongoUri,
  onAfterEach: async () => {
    const collections = mongoose.connection.collections;
    for (const key of Object.keys(collections)) {
      await collections[key].deleteMany({});
    }
  },
  onBeforeEach: () => {
    process.env.ADMIN_SPA_ENABLED = "false";
    process.env.AUTH_PROVIDER = "better-auth";
    process.env.BETTER_AUTH_SECRET = "terreno-example-test-better-auth-secret-32";
    process.env.BETTER_AUTH_URL = "http://localhost:4000";
    process.env.COMMS_ENABLED = "true";
    Reflect.deleteProperty(process.env, "TWILIO_ACCOUNT_SID");
    Reflect.deleteProperty(process.env, "TWILIO_AUTH_TOKEN");
    Reflect.deleteProperty(process.env, "TWILIO_FROM_NUMBER");
    Reflect.deleteProperty(process.env, "TWILIO_MESSAGING_SERVICE_SID");
    Reflect.deleteProperty(process.env, "TWILIO_VERIFY_SERVICE_SID");
    Reflect.deleteProperty(process.env, "WEBHOOK_SECRET");
    Reflect.deleteProperty(process.env, "ADMIN_SPA_DEV_PROXY");
    Reflect.deleteProperty(process.env, "CLINIC_DEMO_MODEL");
    Reflect.deleteProperty(process.env, "CLINIC_DEMO_MODEL_DELAY_MS");
    Reflect.deleteProperty(process.env, "HARNESS_LEASE_SECONDS");
    Reflect.deleteProperty(process.env, "GOOGLE_VERTEX_PROJECT");
    Reflect.deleteProperty(process.env, "ADMIN_SPA_DIST_DIR");
    Reflect.deleteProperty(process.env, "MIGRATIONS_DIR");
  },
  testEnv: {
    extra: {
      API_URL: "http://localhost:4000",
      CRON_SECRET_KEY: "cronSecret",
      GCP_LOCATION: "TESTlocation",
      GCP_PROJECT: "TESTproject",
      GCP_SERVICE_ACCOUNT_EMAIL: "TESTserviceAccountEmail@terreno-example.test",
      GCP_TASK_PROCESSOR_QUEUE: "TESTtaskProcessorQueue",
      GCP_TASKS_NOTIFICATIONS_QUEUE: "TESTnotificationsQueue",
      GEMINI_API_KEY: "test-api-key",
      GOOGLE_CHAT_WEBHOOKS: '{"default": "http://localhost:3000/googleChat/TEST"}',
      MONGO_CONNECTION: defaultLocalMongoUri.replace(/\?.*$/, ""),
      MONGO_URI: "mongodb://127.0.0.1:27017",
      REFRESH_TOKEN_EXPIRES_IN: "90d",
      SLACK_WEBHOOKS: '{"default": "http://localhost:3000/slack/TEST"}',
      TASKS_URL: "http://localhost:4000",
      TEST_MONGO_URI: defaultLocalMongoUri,
      TOKEN_EXPIRES_IN: "1h",
    },
    tokenIssuer: "terreno-example.test",
  },
});
