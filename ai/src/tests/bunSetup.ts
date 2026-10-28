import {registerBackendPreload} from "@terreno/test";

// A single-node replica set: the durable harness commits checkpoints and audit spans
// in Mongo transactions, which standalone servers reject. `TERRENO_TEST_MONGODB_URI`
// still overrides the in-memory server (it must point at a replica set).
registerBackendPreload({
  connectMongoInBeforeAll: true,
  mongo: {baseDatabaseName: "terreno-ai-test", useReplSet: true},
  testEnv: {
    tokenIssuer: "terreno-ai.test",
  },
});
