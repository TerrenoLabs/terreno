import {readFile, rm} from "node:fs/promises";
import {join} from "node:path";

import type {CliIo} from "../io";
import {printJson} from "../io";
import {flagBoolean, flagString, type ParsedArgs} from "../parseArgs";
import {cliStateDir, ensureCliStateDir, writePrivateJson} from "../session";

interface StoredAuth {
  baseUrl: string;
  kind: "better-auth" | "jwt";
  token: string;
}

const DEFAULT_BASE_URL = "http://localhost:4000";
const DEFAULT_BETTER_AUTH_PATH = "/api/auth";

const authFile = (io: CliIo): string => join(cliStateDir(io), "auth.json");

const normalizeOrigin = (value: string): string => value.replace(/\/+$/, "");

/** The token saved by `terreno login`, only when it was issued by the API being called. */
export const readStoredToken = async (io: CliIo, baseUrl: string): Promise<string | undefined> => {
  try {
    const stored = JSON.parse(await readFile(authFile(io), "utf8")) as Partial<StoredAuth>;
    if (typeof stored.token !== "string" || typeof stored.baseUrl !== "string") {
      return undefined;
    }
    return normalizeOrigin(stored.baseUrl) === normalizeOrigin(baseUrl) ? stored.token : undefined;
  } catch {
    return undefined;
  }
};

const postJson = async (
  io: CliIo,
  url: string,
  body: unknown,
  origin: string
): Promise<Response> => {
  return io.fetch(url, {
    body: JSON.stringify(body),
    // Better Auth rejects sign-in requests that carry no trusted Origin.
    headers: {accept: "application/json", "content-type": "application/json", origin},
    method: "POST",
  });
};

const readJsonBody = async (response: Response): Promise<Record<string, unknown>> => {
  try {
    const parsed = (await response.json()) as unknown;
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};

const signIn = async ({
  authPath,
  baseUrl,
  email,
  io,
  password,
}: {
  authPath: string;
  baseUrl: string;
  email: string;
  io: CliIo;
  password: string;
}): Promise<Omit<StoredAuth, "baseUrl">> => {
  const failures: string[] = [];

  const betterAuth = await postJson(
    io,
    `${baseUrl}${authPath}/sign-in/email`,
    {email, password},
    baseUrl
  );
  const betterAuthBody = await readJsonBody(betterAuth);
  const betterAuthToken = betterAuth.headers.get("set-auth-token") ?? betterAuthBody.token;
  if (betterAuth.ok && typeof betterAuthToken === "string" && betterAuthToken) {
    return {kind: "better-auth", token: betterAuthToken};
  }
  failures.push(`${authPath}/sign-in/email -> HTTP ${String(betterAuth.status)}`);

  const jwt = await postJson(io, `${baseUrl}/auth/login`, {email, password}, baseUrl);
  const jwtData = (await readJsonBody(jwt)).data;
  const jwtToken =
    typeof jwtData === "object" && jwtData !== null
      ? (jwtData as Record<string, unknown>).token
      : undefined;
  if (jwt.ok && typeof jwtToken === "string" && jwtToken) {
    return {kind: "jwt", token: jwtToken};
  }
  failures.push(`/auth/login -> HTTP ${String(jwt.status)}`);

  throw new Error(`Login failed (${failures.join("; ")}).`);
};

export const runLoginCommand = async (
  parsed: ParsedArgs,
  io: CliIo,
  json: boolean
): Promise<number> => {
  const email = flagString(parsed.flags, "email") ?? io.env.TERRENO_EMAIL;
  const password = flagString(parsed.flags, "password") ?? io.env.TERRENO_PASSWORD;
  if (!email || !password) {
    io.stderr(
      "Usage: terreno login --email <email> --password <password> [--base-url <url>]\n" +
        "TERRENO_EMAIL and TERRENO_PASSWORD work too and keep the password out of shell history."
    );
    return 1;
  }
  const baseUrl = normalizeOrigin(
    flagString(parsed.flags, "base-url") ?? io.env.TERRENO_API_URL ?? DEFAULT_BASE_URL
  );
  const authPath = flagString(parsed.flags, "auth-path") ?? DEFAULT_BETTER_AUTH_PATH;
  const {kind, token} = await signIn({authPath, baseUrl, email, io, password});

  const shouldPrint = flagBoolean(parsed.flags, "print-token");
  if (!flagBoolean(parsed.flags, "no-save")) {
    const dir = await ensureCliStateDir(io);
    const stored: StoredAuth = {baseUrl, kind, token};
    await writePrivateJson(join(dir, "auth.json"), stored);
  }
  if (json) {
    printJson(io, {baseUrl, kind, ok: true, ...(shouldPrint ? {token} : {})});
  } else if (shouldPrint) {
    io.stdout(token);
  } else {
    io.stdout(`Logged in to ${baseUrl} (${kind}). terreno api now sends this token.`);
  }
  return 0;
};

export const runLogoutCommand = async (io: CliIo, json: boolean): Promise<number> => {
  await rm(authFile(io), {force: true});
  if (json) {
    printJson(io, {ok: true});
  } else {
    io.stdout("Removed the saved token.");
  }
  return 0;
};
