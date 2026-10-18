import {beforeAll, beforeEach, describe, expect, it, spyOn} from "bun:test";
import mongoose, {model, Schema} from "mongoose";
import type {ConfigurationModel, Paths, SecretProvider} from "./configurationPlugin";
import {configurationPlugin, flattenToDotPaths} from "./configurationPlugin";
import type {APIError} from "./errors";
import {type FindOneOrNonePlugin, type IsDeleted, isDeletedPlugin} from "./plugins";

/** A configuration model as created by the plugin, including the findOneOrNone static it adds. */
type ConfigModel<T extends object> = ConfigurationModel<T> & FindOneOrNonePlugin<T>;

// --- Test schema with secret fields ---

interface TestConfig {
  appName: string;
  maintenanceMode: boolean;
  apiKey: string;
  nested: {
    webhookUrl: string;
    secretToken: string;
  };
}

const testConfigSchema = new Schema<TestConfig>({
  apiKey: {
    default: "",
    description: "External API key",
    secret: true,
    secretName: "ext-api-key",
    type: String,
  },
  appName: {
    default: "Test App",
    description: "Application name",
    type: String,
  },
  maintenanceMode: {
    default: false,
    description: "Whether maintenance mode is on",
    type: Boolean,
  },
  nested: {
    type: new Schema({
      secretToken: {
        default: "",
        description: "A nested secret token",
        secret: true,
        secretName: "nested-token",
        secretProvider: "vault",
        type: String,
      },
      webhookUrl: {
        default: "https://example.com/hook",
        description: "Webhook URL",
        type: String,
      },
    }),
  },
});

testConfigSchema.plugin(configurationPlugin);

const TestConfigModel = model<TestConfig, ConfigModel<TestConfig>>(
  "TestConfiguration",
  testConfigSchema
);

// --- Simple schema for singleton tests ---

interface SimpleConfig {
  value: string;
}

const simpleSchema = new Schema<SimpleConfig>({
  value: {default: "default", description: "A value", type: String},
});
simpleSchema.plugin(configurationPlugin);
const SimpleConfigModel = model<SimpleConfig, ConfigModel<SimpleConfig>>(
  "SimpleConfiguration",
  simpleSchema
);

// --- Schema opting into the _singleton unique index ---

const indexedSchema = new Schema<SimpleConfig>({
  value: {default: "default", description: "A value", type: String},
});
indexedSchema.plugin(configurationPlugin, {enforceSingletonIndex: true});
const IndexedConfigModel = model<SimpleConfig, ConfigModel<SimpleConfig>>(
  "IndexedConfiguration",
  indexedSchema
);

// --- Soft-delete-aware schema ---

interface SoftDeleteConfig extends SimpleConfig, IsDeleted {}

const softDeleteSchema = new Schema<SoftDeleteConfig>({
  value: {default: "default", description: "A value", type: String},
});
softDeleteSchema.plugin(configurationPlugin);
softDeleteSchema.plugin(isDeletedPlugin);
const SoftDeleteConfigModel = model<SoftDeleteConfig, ConfigModel<SoftDeleteConfig>>(
  "SoftDeleteConfiguration",
  softDeleteSchema
);

// --- Schema with a validated field (enum) for runValidators coverage ---

interface ValidatedConfig {
  level: string;
}

const validatedSchema = new Schema<ValidatedConfig>({
  level: {
    default: "low",
    description: "Severity level",
    enum: ["low", "medium", "high"],
    type: String,
  },
});
validatedSchema.plugin(configurationPlugin);
const ValidatedConfigModel = model<ValidatedConfig, ConfigModel<ValidatedConfig>>(
  "ValidatedConfiguration",
  validatedSchema
);

describe("configurationPlugin", () => {
  describe("schema setup", () => {
    it("does not add a _singleton index by default", () => {
      const indexes = SimpleConfigModel.schema.indexes();
      const singletonIndex = indexes.find(([fields]) => fields._singleton !== undefined);
      expect(singletonIndex).toBeUndefined();
      expect(SimpleConfigModel.schema.path("_singleton")).toBeUndefined();
    });

    it("adds a _singleton field with unique index when enforceSingletonIndex is true", () => {
      const indexes = IndexedConfigModel.schema.indexes();
      const singletonIndex = indexes.find(([fields]) => fields._singleton !== undefined);
      expect(singletonIndex).toBeDefined();
      expect(singletonIndex?.[1]?.unique).toBe(true);
    });

    it("adds getConfig static", () => {
      expect(typeof SimpleConfigModel.getConfig).toBe("function");
    });

    it("adds updateConfig static", () => {
      expect(typeof SimpleConfigModel.updateConfig).toBe("function");
    });

    it("adds getSecretFields static", () => {
      expect(typeof TestConfigModel.getSecretFields).toBe("function");
    });

    it("adds resolveSecrets static", () => {
      expect(typeof TestConfigModel.resolveSecrets).toBe("function");
    });
  });

  describe("getSecretFields", () => {
    it("discovers top-level secret fields", () => {
      const secrets = TestConfigModel.getSecretFields();
      const apiKeySecret = secrets.find((s) => s.path === "apiKey");
      expect(apiKeySecret).toBeDefined();
      expect(apiKeySecret?.secretName).toBe("ext-api-key");
    });

    it("discovers nested secret fields", () => {
      const secrets = TestConfigModel.getSecretFields();
      const nestedSecret = secrets.find((s) => s.path === "nested.secretToken");
      expect(nestedSecret).toBeDefined();
      expect(nestedSecret?.secretName).toBe("nested-token");
      expect(nestedSecret?.secretProvider).toBe("vault");
    });

    it("does not include non-secret fields", () => {
      const secrets = TestConfigModel.getSecretFields();
      const nonSecret = secrets.find((s) => s.path === "appName");
      expect(nonSecret).toBeUndefined();
    });

    it("returns the correct total count of secret fields", () => {
      const secrets = TestConfigModel.getSecretFields();
      expect(secrets.length).toBe(2);
    });
  });

  describe("resolveSecrets", () => {
    it("resolves secrets from a provider", async () => {
      const provider: SecretProvider = {
        getSecret: async (name: string) => {
          if (name === "ext-api-key") {
            return "resolved-api-key";
          }
          if (name === "nested-token") {
            return "resolved-token";
          }
          return null;
        },
        name: "test-provider",
      };

      const resolved = await TestConfigModel.resolveSecrets(provider);
      expect(resolved.get("apiKey")).toBe("resolved-api-key");
      expect(resolved.get("nested.secretToken")).toBe("resolved-token");
    });

    it("handles provider failures gracefully", async () => {
      const provider: SecretProvider = {
        getSecret: async () => {
          throw new Error("provider down");
        },
        name: "failing-provider",
      };

      const resolved = await TestConfigModel.resolveSecrets(provider);
      expect(resolved.size).toBe(0);
    });

    it("handles partial resolution", async () => {
      const provider: SecretProvider = {
        getSecret: async (name: string) => {
          if (name === "ext-api-key") {
            return "resolved-key";
          }
          return null;
        },
        name: "partial-provider",
      };

      const resolved = await TestConfigModel.resolveSecrets(provider);
      expect(resolved.size).toBe(1);
      expect(resolved.get("apiKey")).toBe("resolved-key");
    });

    it("passes the discovered secret version to the provider", async () => {
      const versionedSchema = new Schema<{token: string}>({
        token: {
          default: "",
          description: "Pinned secret",
          secret: true,
          secretName: "pinned-token",
          secretVersion: "5",
          type: String,
        },
      });
      versionedSchema.plugin(configurationPlugin);
      const VersionedModel = model<{token: string}, ConfigModel<{token: string}>>(
        "VersionedConfiguration",
        versionedSchema
      );

      const received: Array<{name: string; version?: string}> = [];
      const provider: SecretProvider = {
        getSecret: async (name: string, version?: string) => {
          received.push({name, version});
          return "value";
        },
        name: "versioned-provider",
      };

      await VersionedModel.resolveSecrets(provider);
      expect(received).toEqual([{name: "pinned-token", version: "5"}]);
    });
  });

  describe("flattenToDotPaths", () => {
    it("flattens nested plain objects into dotted paths", () => {
      expect(flattenToDotPaths({a: {b: 1}})).toEqual([["a.b", 1]]);
    });

    it("treats arrays as leaves", () => {
      expect(flattenToDotPaths({a: [1, 2]})).toEqual([["a", [1, 2]]]);
    });

    it("treats null as a leaf and keeps top-level keys", () => {
      expect(flattenToDotPaths({a: null, b: "x"})).toEqual([
        ["a", null],
        ["b", "x"],
      ]);
    });
  });

  describe("singleton behavior (requires MongoDB)", () => {
    let dbConnected = false;

    beforeAll(async () => {
      try {
        if (mongoose.connection.readyState === 1) {
          dbConnected = true;
        } else {
          await mongoose.connect("mongodb://127.0.0.1/terreno-config-test", {
            connectTimeoutMS: 3000,
            serverSelectionTimeoutMS: 3000,
          });
          dbConnected = true;
        }
      } catch {
        dbConnected = false;
      }
    });

    beforeEach(async () => {
      if (!dbConnected) {
        return;
      }
      try {
        await SimpleConfigModel.collection.drop();
      } catch {
        // Collection may not exist yet
      }
      await SimpleConfigModel.ensureIndexes();
    });

    it("creates a document via getConfig when none exists", async () => {
      if (!dbConnected) {
        return;
      }
      const config = await SimpleConfigModel.getConfig();
      expect(config).toBeDefined();
      expect(config.value).toBe("default");
    });

    it("returns the same document on subsequent getConfig calls", async () => {
      if (!dbConnected) {
        return;
      }
      const first = await SimpleConfigModel.getConfig();
      const second = await SimpleConfigModel.getConfig();
      expect(String(first._id)).toBe(String(second._id));
    });

    it("prevents creating a second document via save", async () => {
      if (!dbConnected) {
        return;
      }
      await SimpleConfigModel.getConfig();
      const duplicate = new SimpleConfigModel({value: "duplicate"});
      await expect(duplicate.save()).rejects.toThrow();
    });

    it("re-fetches the existing singleton when a concurrent create hits a 409", async () => {
      if (!dbConnected) {
        return;
      }
      const existing = await SimpleConfigModel.getConfig();
      // Simulate a race: the initial lookup misses, so getConfig attempts a create
      // that the pre-save singleton guard rejects with a 409. getConfig should then
      // re-fetch and return the document created by the "other process".
      const spy = spyOn(SimpleConfigModel, "findOneOrNone").mockResolvedValueOnce(null);
      try {
        const config = await SimpleConfigModel.getConfig();
        expect(String(config._id)).toBe(String(existing._id));
      } finally {
        spy.mockRestore();
      }
    });

    it("rethrows non-409 errors raised while creating the singleton", async () => {
      if (!dbConnected) {
        return;
      }
      const findSpy = spyOn(SimpleConfigModel, "findOneOrNone").mockResolvedValueOnce(null);
      const saveSpy = spyOn(SimpleConfigModel.prototype, "save").mockRejectedValueOnce(
        new Error("unexpected save failure")
      );
      try {
        await expect(SimpleConfigModel.getConfig()).rejects.toThrow("unexpected save failure");
      } finally {
        findSpy.mockRestore();
        saveSpy.mockRestore();
      }
    });

    it("returns undefined for a dotted key that traverses a non-object value", async () => {
      if (!dbConnected) {
        return;
      }
      await SimpleConfigModel.getConfig();
      // `value` is a string, so descending into `value.missing` bails out.
      expect(
        await SimpleConfigModel.getConfig("value.missing" as Paths<SimpleConfig>)
      ).toBeUndefined();
      // A missing top-level segment also resolves to undefined.
      expect(
        await SimpleConfigModel.getConfig("nope.deeper" as Paths<SimpleConfig>)
      ).toBeUndefined();
    });

    it("updates an existing document via updateConfig", async () => {
      if (!dbConnected) {
        return;
      }
      await SimpleConfigModel.getConfig();
      const updated = await SimpleConfigModel.updateConfig({value: "updated"});
      expect(updated.value).toBe("updated");

      const count = await SimpleConfigModel.countDocuments();
      expect(count).toBe(1);
    });

    it("creates a document with values if none exists via updateConfig", async () => {
      if (!dbConnected) {
        return;
      }
      const config = await SimpleConfigModel.updateConfig({value: "custom"});
      expect(config.value).toBe("custom");
    });

    it("runs schema validators on updateConfig (rejects invalid enum)", async () => {
      if (!dbConnected) {
        return;
      }
      try {
        await ValidatedConfigModel.collection.drop();
      } catch {
        // Collection may not exist yet
      }
      await ValidatedConfigModel.getConfig();
      await expect(ValidatedConfigModel.updateConfig({level: "bogus"})).rejects.toThrow();
      // A valid value still applies.
      const ok = await ValidatedConfigModel.updateConfig({level: "high"});
      expect(ok.level).toBe("high");
    });

    it("prevents deleteOne", async () => {
      if (!dbConnected) {
        return;
      }
      await SimpleConfigModel.getConfig();
      try {
        await SimpleConfigModel.deleteOne({}).exec();
        expect.unreachable("Should have thrown");
      } catch (err) {
        expect((err as APIError).title).toMatch(/Cannot hard-delete the configuration document/);
      }
    });

    it("prevents findOneAndDelete", async () => {
      if (!dbConnected) {
        return;
      }
      await SimpleConfigModel.getConfig();
      try {
        await SimpleConfigModel.findOneAndDelete({}).exec();
        expect.unreachable("Should have thrown");
      } catch (err) {
        expect((err as APIError).title).toMatch(/Cannot hard-delete the configuration document/);
      }
    });

    it("prevents deleteMany", async () => {
      if (!dbConnected) {
        return;
      }
      await SimpleConfigModel.getConfig();
      try {
        await SimpleConfigModel.deleteMany({}).exec();
        expect.unreachable("Should have thrown");
      } catch (err) {
        expect((err as APIError).title).toMatch(/Cannot hard-delete the configuration document/);
      }
    });
  });

  describe("soft-delete-aware singleton (requires MongoDB)", () => {
    let dbConnected = false;

    beforeAll(async () => {
      try {
        if (mongoose.connection.readyState === 1) {
          dbConnected = true;
        } else {
          await mongoose.connect("mongodb://127.0.0.1/terreno-config-test", {
            connectTimeoutMS: 3000,
            serverSelectionTimeoutMS: 3000,
          });
          dbConnected = true;
        }
      } catch {
        dbConnected = false;
      }
    });

    beforeEach(async () => {
      if (!dbConnected) {
        return;
      }
      try {
        await SoftDeleteConfigModel.collection.drop();
      } catch {
        // Collection may not exist yet
      }
    });

    it("operates on the non-deleted singleton", async () => {
      if (!dbConnected) {
        return;
      }
      const config = await SoftDeleteConfigModel.getConfig();
      expect(config.value).toBe("default");
      const updated = await SoftDeleteConfigModel.updateConfig({value: "live"});
      expect(updated.value).toBe("live");
      expect(updated.deleted).toBe(false);
    });

    it("allows a new singleton after the existing one is soft-deleted", async () => {
      if (!dbConnected) {
        return;
      }
      const first = await SoftDeleteConfigModel.getConfig();
      // Soft delete by setting deleted: true (allowed)
      first.deleted = true;
      await first.save();

      // A new non-deleted singleton can now be created
      const second = await SoftDeleteConfigModel.getConfig();
      expect(second.deleted).toBe(false);
      expect(String(second._id)).not.toBe(String(first._id));
    });

    it("does not let updateConfig touch a soft-deleted document", async () => {
      if (!dbConnected) {
        return;
      }
      const first = await SoftDeleteConfigModel.getConfig();
      first.deleted = true;
      await first.save();

      // updateConfig creates and targets a fresh non-deleted singleton
      const updated = await SoftDeleteConfigModel.updateConfig({value: "fresh"});
      expect(updated.deleted).toBe(false);
      expect(updated.value).toBe("fresh");
      expect(String(updated._id)).not.toBe(String(first._id));
    });
  });
});
