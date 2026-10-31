import {registerBackendPreload, registerSimpleMongoPreload} from "@terreno/test";

import {winstonLogger} from "../logger";

const useFixtureCache = process.env.TERRENO_TEST_USE_FIXTURE_CACHE === "true";

// Hand @terreno/test this package's logger directly; letting it require("@terreno/api")
// would load the built dist next to the sources under test.
const silenceLogs = {additionalWinstonLoggers: [winstonLogger]};

if (useFixtureCache) {
  registerBackendPreload({
    connectMongoInBeforeAll: true,
    loadTestDataFromCache: async () => {
      const {loadTestDataFromCache} = await import("./mongoTestSetup.js");
      await loadTestDataFromCache();
    },
    mongo: {
      baseDatabaseName: "terrenoTest_base",
      useReplSet: true,
    },
    silenceLogs,
    testEnv: {
      extra: {USE_SENTRY_LOGGING: "false"},
      tokenIssuer: "terreno-api.test",
    },
    useTransactions: true,
  });
} else {
  registerSimpleMongoPreload({
    silenceLogs,
    testEnv: {
      extra: {USE_SENTRY_LOGGING: "false"},
      tokenIssuer: "terreno-api.test",
    },
  });
}
