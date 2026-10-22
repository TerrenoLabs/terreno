import {describe, expect, it} from "bun:test";

import {logoutAndWipe} from "./logout";

describe("logoutAndWipe", () => {
  it("signs every sync client out before ending the session", async () => {
    const calls: string[] = [];
    await logoutAndWipe({
      logout: async () => {
        calls.push("logout");
      },
      syncDbs: [
        {
          signOut: async () => {
            calls.push("syncDb");
          },
        },
        {
          signOut: async () => {
            calls.push("adminSyncDb");
          },
        },
      ],
    });
    expect(calls).toEqual(["syncDb", "adminSyncDb", "logout"]);
  });

  it("still ends the session when a sync client fails to sign out", async () => {
    const originalError = console.error;
    console.error = (): void => {};
    const calls: string[] = [];
    try {
      await logoutAndWipe({
        logout: async () => {
          calls.push("logout");
        },
        syncDbs: [
          {
            signOut: async () => {
              throw new Error("persister closed");
            },
          },
        ],
      });
    } finally {
      console.error = originalError;
    }
    expect(calls).toEqual(["logout"]);
  });
});
