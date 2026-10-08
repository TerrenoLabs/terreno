import {generateKeyPairSync} from "node:crypto";
import {readFileSync} from "node:fs";
import path from "node:path";
import {type APIRequestContext, request} from "@playwright/test";
import {DateTime} from "luxon";
import {MongoClient, ObjectId} from "mongodb";

import type {E2EUser} from "../fixtures/testUsers";
import {getAdminToken} from "./adminAuth";
import {signUpOrSignInBetterAuth} from "./betterAuthSession";

const API_URL = process.env.BACKEND_URL ?? "http://localhost:4000";
const MONGO_URI = process.env.MONGO_URI ?? "mongodb://127.0.0.1/terreno-e2e";
const FRONTEND_ORIGIN = process.env.FRONTEND_URL ?? "http://localhost:8082";

/** The bucket the e2e storage signs URLs for. Nothing ever reads or writes it. */
export const E2E_PHOTO_BUCKET = "terreno-e2e-photos";

/** The host a signed photo URL points at; the spec stubs downloads from it. */
export const SIGNED_URL_PREFIX = `https://storage.googleapis.com/${E2E_PHOTO_BUCKET}/`;

const GOLDEN_ROAST_PATH = path.resolve(
  __dirname,
  "../../../blocks/src/fixtures/golden/sunday-roast.yaml"
);

/** Every `src` in the golden roast reply. Each one becomes a seeded photo library entry. */
const GOLDEN_IMAGE_PATTERN = /https:\/\/images\.example\.com\/sunday-roast\/([a-z-]+)\.jpg/g;

/** The seeded `PhotoLibraryEntry` id for each golden image name, e.g. `roast-lamb`. */
export type RoastPhotoIds = Record<string, string>;

const goldenRoast = (): string => readFileSync(GOLDEN_ROAST_PATH, "utf8");

const goldenImageNames = (): string[] => [
  ...new Set([...goldenRoast().matchAll(GOLDEN_IMAGE_PATTERN)].map((match) => match[1] ?? "")),
];

/**
 * Upserts one `PhotoLibraryEntry` per golden roast image. The API never creates entries (create
 * is 405) and `photos:generate` needs Vertex and GCS, so rows go straight into Mongo, as
 * `setUserAdmin` does for users. Re-runs keep the same ids.
 */
export const seedRoastPhotos = async (): Promise<RoastPhotoIds> => {
  const client = new MongoClient(MONGO_URI);
  try {
    await client.connect();
    const entries = client.db().collection("photolibraryentries");
    const ids: RoastPhotoIds = {};
    for (const name of goldenImageNames()) {
      const now = DateTime.now().toJSDate();
      const prompt = `e2e sunday roast photo: ${name}`;
      const entry = await entries.findOneAndUpdate(
        {prompt},
        {
          $set: {
            alt: name.replace(/-/g, " "),
            deleted: false,
            gcsKey: `photos/e2e/${name}.png`,
            tags: ["e2e", "sunday-roast"],
            updated: now,
          },
          $setOnInsert: {created: now, fileAttachmentId: new ObjectId(), prompt},
        },
        {returnDocument: "after", upsert: true}
      );
      if (!entry) {
        throw new Error(`Could not seed the photo library entry for ${name}`);
      }
      ids[name] = entry._id.toString();
    }
    return ids;
  } finally {
    await client.close();
  }
};

/** The golden roast reply with every image `src` swapped for its library entry's `file:` id. */
export const roastDocument = (photoIds: RoastPhotoIds): string =>
  goldenRoast().replace(GOLDEN_IMAGE_PATTERN, (_src, name: string) => {
    const id = photoIds[name];
    if (!id) {
      throw new Error(`No seeded photo for ${name}`);
    }
    return `file:${id}`;
  });

/** A throwaway service account. Signing a V4 URL with it is local; Google never sees it. */
const fakeServiceAccountKey = (): string => {
  const {privateKey} = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: {format: "pem", type: "pkcs8"},
    publicKeyEncoding: {format: "pem", type: "spki"},
  });
  return JSON.stringify({
    client_email: "terreno-e2e@terreno-e2e.iam.gserviceaccount.com",
    private_key: privateKey,
    project_id: "terreno-e2e",
    type: "service_account",
  });
};

const adminHeaders = (token: string): Record<string, string> => ({
  authorization: `Bearer ${token}`,
  origin: FRONTEND_ORIGIN,
});

/**
 * Points the running backend's photo storage at a bucket that only exists in the browser stub,
 * through the admin `POST /settings/configureGcs`. `GET /photoLibrary/:id/url` then signs real
 * V4 URLs on the server. The chat and file routes keep the storage they started with.
 * Returns a restore function that clears the storage again, unless it was already configured.
 */
export const configureE2ePhotoStorage = async (): Promise<() => Promise<void>> => {
  const api = await request.newContext({baseURL: API_URL});
  const token = await getAdminToken(api);
  const status = await api.get("/settings/gcs", {headers: adminHeaders(token)});
  const wasConfigured = ((await status.json()) as {data?: {configured?: boolean}}).data?.configured;
  if (!wasConfigured) {
    const configured = await api.post("/settings/configureGcs", {
      data: {
        bucketName: E2E_PHOTO_BUCKET,
        projectId: "terreno-e2e",
        serviceAccountKey: fakeServiceAccountKey(),
      },
      headers: adminHeaders(token),
    });
    if (!configured.ok()) {
      throw new Error(`configureGcs failed with ${configured.status()}`);
    }
  }
  return async (): Promise<void> => {
    if (!wasConfigured) {
      await api.post("/settings/clearGcs", {headers: adminHeaders(token)});
    }
    await api.dispose();
  };
};

export interface SeededHistory {
  historyId: string;
  /** Deletes the history, so the user's chat list does not grow run after run. */
  remove: () => Promise<void>;
}

const userToken = async (api: APIRequestContext, user: E2EUser): Promise<string> =>
  signUpOrSignInBetterAuth(api, user);

/**
 * Stores a conversation through `POST /gpt/histories` as `user`: the user's prompt, then the
 * assistant's `reply`. Callbacks find the reply's blocks at `prompts[1]` (`msg-1`).
 */
export const seedGptHistory = async ({
  prompt,
  reply,
  title,
  user,
}: {
  prompt: string;
  reply: string;
  title: string;
  user: E2EUser;
}): Promise<SeededHistory> => {
  const api = await request.newContext({baseURL: API_URL});
  const headers = {authorization: `Bearer ${await userToken(api, user)}`, origin: FRONTEND_ORIGIN};
  const created = await api.post("/gpt/histories", {
    data: {
      prompts: [
        {text: prompt, type: "user"},
        {text: reply, type: "assistant"},
      ],
      title,
    },
    headers,
  });
  if (!created.ok()) {
    throw new Error(`POST /gpt/histories failed with ${created.status()}`);
  }
  const historyId = ((await created.json()) as {data: {id: string}}).data.id;
  return {
    historyId,
    remove: async (): Promise<void> => {
      await api.delete(`/gpt/histories/${historyId}`, {headers});
      await api.dispose();
    },
  };
};
