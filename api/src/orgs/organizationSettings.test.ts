import {afterEach, describe, it} from "bun:test";
import {assert} from "chai";
import mongoose from "mongoose";

import {ValidationError} from "../errors";
import {Organization} from "./organizationModel";
import {
  applyOrganizationSettings,
  createOrganizationSettingsSchema,
  getOrganizationSettingsSchema,
  organizationSettingsOf,
  registerOrganizationSettings,
} from "./organizationSettings";

const userId = (): mongoose.Types.ObjectId => new mongoose.Types.ObjectId();

interface ExampleSettings {
  timezone?: string;
}

describe("organization settings schema", () => {
  afterEach(() => {
    registerOrganizationSettings();
  });

  it("passes Mixed settings through when no schema is registered", () => {
    const settings = applyOrganizationSettings({nested: {ok: true}, plan: "pro"});
    assert.deepEqual(settings, {nested: {ok: true}, plan: "pro"});
  });

  it("returns an empty object from organizationSettingsOf when settings are missing", () => {
    assert.deepEqual(organizationSettingsOf({}), {});
    assert.deepEqual(organizationSettingsOf({settings: {timezone: "UTC"}}), {timezone: "UTC"});
  });

  it("rejects unknown keys and wrong types when a schema is registered", () => {
    registerOrganizationSettings(
      createOrganizationSettingsSchema({
        timezone: {
          description: "IANA timezone for the organization",
          type: String,
        },
      })
    );
    assert.isDefined(getOrganizationSettingsSchema());

    const valid = applyOrganizationSettings({timezone: "America/New_York"});
    assert.equal((valid as ExampleSettings).timezone, "America/New_York");

    let extraKeyError: unknown;
    try {
      applyOrganizationSettings({plan: "pro"});
    } catch (caughtError) {
      extraKeyError = caughtError;
    }
    assert.instanceOf(extraKeyError, ValidationError);
    assert.equal((extraKeyError as ValidationError).title, "Organization settings are invalid");
    assert.match(
      String(((extraKeyError as ValidationError).meta?.fields as {settings?: unknown})?.settings),
      /Unknown settings field: plan/
    );

    let typeError: unknown;
    try {
      applyOrganizationSettings({timezone: {notAString: true}});
    } catch (caughtError) {
      typeError = caughtError;
    }
    assert.instanceOf(typeError, ValidationError);

    let notObjectError: unknown;
    try {
      applyOrganizationSettings(["timezone"]);
    } catch (caughtError) {
      notObjectError = caughtError;
    }
    assert.instanceOf(notObjectError, ValidationError);
    assert.equal(
      (notObjectError as ValidationError).title,
      "Organization settings must be an object"
    );
  });

  it("validates settings on Organization.create", async () => {
    registerOrganizationSettings(
      createOrganizationSettingsSchema({
        timezone: {
          description: "IANA timezone for the organization",
          type: String,
        },
      })
    );

    const org = await Organization.create({
      name: "Settings Org",
      ownerId: userId(),
      settings: {timezone: "UTC"},
    });
    assert.equal(organizationSettingsOf<ExampleSettings>(org).timezone, "UTC");

    let error: unknown;
    try {
      await Organization.create({
        name: "Bad Settings Org",
        ownerId: userId(),
        settings: {unknown: true},
      });
    } catch (caughtError) {
      error = caughtError;
    }
    assert.instanceOf(error, ValidationError);
  });
});
