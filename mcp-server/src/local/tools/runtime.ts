import {
  cdpRuntimeEvaluate,
  ensureCdpConnected,
  getCdpConnectionStatus,
} from "../metro/metroDevSession.js";

export interface EvaluateArgs {
  code: string;
}

export const evaluate = (args: EvaluateArgs): Promise<string> => {
  return (async (): Promise<string> => {
    if (process.env.TERRENO_MCP_EVAL !== "1" && process.env.TERRENO_MCP_EVAL !== "true") {
      return "Refused: set `TERRENO_MCP_EVAL=1` to opt in to `Runtime.evaluate` (arbitrary JS in the app runtime).";
    }
    const trimmed = args.code.trim();
    if (!trimmed) {
      return "No code provided.";
    }
    const ev = await cdpRuntimeEvaluate(trimmed, true);
    if (ev.error) {
      return JSON.stringify({error: ev.error, status: getCdpConnectionStatus()}, null, 2);
    }
    return JSON.stringify({result: ev.value, status: getCdpConnectionStatus()}, null, 2);
  })();
};

export interface NavigateArgs {
  path: string;
}

const buildNavigateExpr = (path: string): string => {
  const enc = JSON.stringify(path);
  return `(() => {
  try {
    const expoRouter = require("expo-router");
    const r = expoRouter.router;
    if (r && typeof r.navigate === "function") {
      r.navigate(${enc});
      return { ok: true, method: "navigate" };
    }
    if (r && typeof r.push === "function") {
      r.push(${enc});
      return { ok: true, method: "push" };
    }
    return { ok: false, error: "expo-router router has no navigate/push" };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
})()`;
};

export const navigate = (args: NavigateArgs): Promise<string> => {
  return (async (): Promise<string> => {
    if (process.env.TERRENO_MCP_EVAL !== "1" && process.env.TERRENO_MCP_EVAL !== "true") {
      return "Refused: set `TERRENO_MCP_EVAL=1` to opt in to CDP-driven navigation (runs a fixed expo-router snippet in the app).";
    }
    const path = args.path.trim();
    if (!path) {
      return "No path provided.";
    }
    await ensureCdpConnected();
    const ev = await cdpRuntimeEvaluate(buildNavigateExpr(path), true);
    if (ev.error) {
      return JSON.stringify({error: ev.error, status: getCdpConnectionStatus()}, null, 2);
    }
    return JSON.stringify({result: ev.value, status: getCdpConnectionStatus()}, null, 2);
  })();
};
