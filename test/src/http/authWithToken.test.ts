import {describe, expect, it} from "bun:test";
import express from "express";
import {authWithToken} from "./authWithToken";

const buildApp = (): express.Application => {
  const app = express();
  app.get("/echo", (req, res) => {
    res.json({appVersion: req.headers["app-version"], authorization: req.headers.authorization});
  });
  return app;
};

describe("authWithToken", () => {
  it("sends the bearer token and extra headers on every request", async () => {
    const agent = await authWithToken(buildApp(), {
      headers: {"app-version": "1.10.0"},
      token: "minted-token",
    });
    const first = await agent.get("/echo").expect(200);
    const second = await agent.get("/echo").expect(200);
    expect(first.body).toEqual({appVersion: "1.10.0", authorization: "Bearer minted-token"});
    expect(second.body.authorization).toBe("Bearer minted-token");
  });

  it("throws when the token is empty", async () => {
    await expect(authWithToken(buildApp(), {token: null})).rejects.toThrow(/token is empty/);
  });
});
