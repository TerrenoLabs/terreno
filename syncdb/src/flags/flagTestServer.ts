import {type ApiClient, createApiClient, type FetchLike} from "../api/client";
import type {TerrenoFlagConfiguration, TerrenoFlagDefinition} from "./useTerrenoFeatureFlags";

export const boolDef = (variant: "on" | "off"): TerrenoFlagDefinition => ({
  defaultVariant: variant,
  disabled: false,
  variants: {off: false, on: true},
});

/** Test double for `FeatureFlagsApp`; used by the flags hook tests. */
export interface FlagTestServer {
  client: ApiClient;
  /** `METHOD /path` of every request, in order. */
  requests: string[];
  /** Replace the configuration later requests return. */
  setConfig: (config: TerrenoFlagConfiguration) => void;
  /** Fail the next request with this status. */
  failNext: (status: number) => void;
  /** Hold every request until `release()` is called. */
  hold: () => void;
  release: () => void;
}

/** In-memory `/feature-flags/flagConfiguration` backend reached through the fetch boundary. */
export const createFlagTestServer = (initial: TerrenoFlagConfiguration = {}): FlagTestServer => {
  let config = initial;
  let failStatus: number | undefined;
  let held: (() => void)[] | undefined;
  const requests: string[] = [];

  const respond = (): Response => {
    if (failStatus !== undefined) {
      const status = failStatus;
      failStatus = undefined;
      return new Response(JSON.stringify({title: "Flags unavailable"}), {
        headers: {"Content-Type": "application/json"},
        status,
      });
    }
    return new Response(JSON.stringify({data: config}), {
      headers: {"Content-Type": "application/json"},
      status: 200,
    });
  };

  const fetchImpl: FetchLike = async (input, init) => {
    requests.push(`${init?.method ?? "GET"} ${new URL(input).pathname}`);
    if (held) {
      const queue = held;
      await new Promise<void>((resolve) => {
        queue.push(resolve);
      });
    }
    return respond();
  };

  return {
    client: createApiClient({baseUrl: "http://flags.test", fetchImpl}),
    failNext: (status: number): void => {
      failStatus = status;
    },
    hold: (): void => {
      held = [];
    },
    release: (): void => {
      const queue = held ?? [];
      held = undefined;
      for (const resolve of queue) {
        resolve();
      }
    },
    requests,
    setConfig: (next: TerrenoFlagConfiguration): void => {
      config = next;
    },
  };
};
