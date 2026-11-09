import {fillPathTemplate, type RestOperation} from "./operations";

export interface InvokeRestArgs {
  baseUrl: string;
  body?: unknown;
  fetch: typeof fetch;
  headers?: Record<string, string>;
  operation: RestOperation;
  params?: Record<string, string>;
  token?: string;
}

export interface InvokeRestResult {
  bodyText: string;
  ok: boolean;
  parsed: unknown;
  status: number;
  url: string;
}

const parseResponseBody = (text: string): unknown => {
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

export const invokeRestOperation = async (args: InvokeRestArgs): Promise<InvokeRestResult> => {
  const params = args.params ?? {};
  const origin = args.baseUrl.replace(/\/$/, "");
  if (!origin) {
    throw new Error("Missing API base URL. Pass --base-url or TERRENO_API_URL.");
  }

  const pathNames = new Set(
    [...args.operation.path.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]).filter(Boolean)
  );
  const pathParams: Record<string, string> = {};
  const query = new URLSearchParams();
  const extraHeaders: Record<string, string> = {...args.headers};

  for (const [name, value] of Object.entries(params)) {
    const meta = args.operation.parameters.find((parameter) => parameter.name === name);
    if (pathNames.has(name) || meta?.in === "path") {
      pathParams[name] = value;
      continue;
    }
    if (meta?.in === "header") {
      extraHeaders[name] = value;
      continue;
    }
    query.set(name, value);
  }

  const path = fillPathTemplate(args.operation.path, pathParams);
  const url = new URL(`${origin}${path.startsWith("/") ? path : `/${path}`}`);
  for (const [key, value] of query.entries()) {
    url.searchParams.append(key, value);
  }

  const headers: Record<string, string> = {
    accept: "application/json",
    ...extraHeaders,
  };
  if (args.token) {
    headers.authorization = headers.authorization ?? `Bearer ${args.token}`;
  }

  const init: RequestInit = {
    headers,
    method: args.operation.method.toUpperCase(),
  };
  if (args.body !== undefined) {
    headers["content-type"] = headers["content-type"] ?? "application/json";
    init.body = typeof args.body === "string" ? args.body : JSON.stringify(args.body);
  }

  const response = await args.fetch(url.toString(), init);
  const bodyText = await response.text();
  return {
    bodyText,
    ok: response.ok,
    parsed: parseResponseBody(bodyText),
    status: response.status,
    url: url.toString(),
  };
};
