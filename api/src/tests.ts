import {
  authAsUser as authAsUserWithCredentials,
  getBaseServer as createBaseTestServer,
} from "@terreno/test";
import type express from "express";
import type {Express} from "express";
import type TestAgent from "supertest/lib/agent";

import {patchAppUse} from "./openApiCompat";
import {createTestData} from "./tests/createTestData";
import {
  type Food,
  type FoodCategory,
  FoodModel,
  type RequiredField,
  RequiredModel,
  type StaffUser,
  StaffUserModel,
  type SuperUser,
  SuperUserModel,
  type User,
  UserModel,
} from "./tests/models";
import {loadTestDataFromCache, setupTestCache} from "./tests/mongoTestSetup";
import {setupDb, setupTestData} from "./tests/testHelper";
import type {TestData} from "./tests/types";

export {authUserModel} from "./tests/models";
export type {Food, FoodCategory, RequiredField, StaffUser, SuperUser, TestData, User};
export {
  createTestData,
  FoodModel,
  loadTestDataFromCache,
  RequiredModel,
  StaffUserModel,
  SuperUserModel,
  setupDb,
  setupTestCache,
  setupTestData,
  UserModel,
};

export const getBaseServer = (): Express => {
  return createBaseTestServer({
    patchOpenApiCompat: patchAppUse,
  });
};

export const authAsUser = async (
  app: express.Application,
  type: "admin" | "notAdmin"
): Promise<TestAgent> => {
  const email = type === "admin" ? "admin@example.com" : "notAdmin@example.com";
  const password = type === "admin" ? "securePassword" : "password";
  return authAsUserWithCredentials(app, {email, password});
};

export {loadTestData} from "./tests/mongoTestSetup";
