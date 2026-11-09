import {describe, expect, it} from "bun:test";
import express from "express";
import supertest from "supertest";

import {sendProtocolJson} from "./oauthMetadata";

describe("sendProtocolJson", () => {
  it("serializes reflected input as JSON with a JSON content type", async () => {
    const app = express();
    app.get("/echo", (req, res) => {
      sendProtocolJson(res, 400, {error: "invalid_request", error_description: req.query.value});
    });

    const payload = "<script>alert(1)</script>";
    const res = await supertest(app).get("/echo").query({value: payload}).expect(400);
    expect(res.headers["content-type"]).toBe("application/json; charset=utf-8");
    expect(res.text).toBe(JSON.stringify({error: "invalid_request", error_description: payload}));
  });
});
