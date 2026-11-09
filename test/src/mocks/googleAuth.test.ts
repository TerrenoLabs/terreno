import {beforeEach, describe, expect, it} from "bun:test";
import {createRequire} from "node:module";

import {type GoogleAuthMockClient, registerGoogleAuthMock} from "./googleAuth";

const googleAuth = registerGoogleAuthMock({
  idTokenPayload: {email: "tasks@p.iam", email_verified: true},
});

interface AuthModule {
  default: {GoogleAuth: unknown};
  GoogleAuth: new (
    options?: Record<string, unknown>
  ) => {
    getAccessToken: () => Promise<{token: string}>;
    getClient: () => Promise<GoogleAuthMockClient>;
    getProjectId: () => Promise<string>;
  };
  OAuth2Client: new () => {
    verifyIdToken: (options: {
      audience?: string | string[];
      idToken: string;
    }) => Promise<{getPayload: () => Record<string, unknown>}>;
  };
}

describe("registerGoogleAuthMock", () => {
  beforeEach((): void => {
    googleAuth.reset();
  });

  it("returns an authorized client with tokens and requests", async (): Promise<void> => {
    const {GoogleAuth, default: defaultExport} = (await import(
      "google-auth-library"
    )) as unknown as AuthModule;
    expect(defaultExport.GoogleAuth).toBe(googleAuth.GoogleAuth);
    const auth = new GoogleAuth({scopes: ["https://www.googleapis.com/auth/cloud-platform"]});
    const client = await auth.getClient();

    expect(await client.getAccessToken()).toEqual({token: "mock-access-token"});
    expect(await auth.getAccessToken()).toEqual({token: "mock-access-token"});
    expect(await auth.getProjectId()).toBe("mock-project");
    expect(await client.getRequestHeaders()).toEqual({Authorization: "Bearer mock-access-token"});

    expect(await client.request({url: "https://x/default"})).toEqual({
      data: {},
      headers: {},
      status: 200,
    });
    googleAuth.request.mockResolvedValueOnce({data: {name: "task-1"}, headers: {}, status: 200});
    const response = await client.request({
      data: {task: {}},
      method: "POST",
      url: "https://x/tasks",
    });
    expect(response.data).toEqual({name: "task-1"});
    expect(googleAuth.GoogleAuth).toHaveBeenCalledWith({
      scopes: ["https://www.googleapis.com/auth/cloud-platform"],
    });
    expect(googleAuth.request).toHaveBeenLastCalledWith({
      data: {task: {}},
      method: "POST",
      url: "https://x/tasks",
    });
  });

  it("verifies ID tokens with the configured payload and audience", async (): Promise<void> => {
    const {OAuth2Client} = createRequire(__filename)("google-auth-library") as AuthModule;
    const verifier = new OAuth2Client();

    const ticket = await verifier.verifyIdToken({audience: "https://api/jobs", idToken: "t"});
    const multi = await verifier.verifyIdToken({audience: ["a", "b"], idToken: "t"});

    expect(ticket.getPayload()).toEqual({
      aud: "https://api/jobs",
      email: "tasks@p.iam",
      email_verified: true,
    });
    expect(multi.getPayload().aud).toBe("a");
    expect(googleAuth.verifyIdToken).toHaveBeenCalledTimes(2);
  });

  it("reset restores defaults after an override", async (): Promise<void> => {
    googleAuth.getClient.mockRejectedValue(new Error("No credentials configured"));
    const {GoogleAuth} = (await import("google-auth-library")) as unknown as AuthModule;
    await expect(new GoogleAuth().getClient()).rejects.toThrow("No credentials configured");

    googleAuth.reset();

    expect(await new GoogleAuth().getClient()).toBe(googleAuth.client);
    expect(googleAuth.getClient).toHaveBeenCalledTimes(1);
  });
});

describe("registerGoogleAuthMock defaults", () => {
  it("defaults the ID token payload to a verified service account", async (): Promise<void> => {
    const defaults = registerGoogleAuthMock();
    const {OAuth2Client} = (await import("google-auth-library")) as unknown as AuthModule;
    const ticket = await new OAuth2Client().verifyIdToken({idToken: "t"});
    expect(ticket.getPayload()).toEqual({
      aud: undefined,
      email: "mock-service-account@mock-project.iam.gserviceaccount.com",
      email_verified: true,
    });
    expect(defaults.verifyIdToken).toHaveBeenCalledTimes(1);
  });
});
