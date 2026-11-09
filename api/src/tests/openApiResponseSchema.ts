import Ajv from "ajv";
import addFormats from "ajv-formats";

/** Raised when a route or response is undocumented, or a body breaks its documented schema. */
class DocumentedResponseError extends Error {
  name = "DocumentedResponseError";
}

/** The subset of an OpenAPI document needed to look up and validate a response schema. */
export interface OpenApiResponseSpec {
  components?: Record<string, unknown>;
  paths?: Record<string, Record<string, OpenApiResponseOperation | undefined> | undefined>;
}

interface OpenApiResponseOperation {
  responses?: Record<string, {content?: Record<string, {schema?: unknown}>} | undefined>;
}

export interface DocumentedResponseOptions {
  /** The `/openapi.json` document the app serves. */
  spec: OpenApiResponseSpec;
  /** The OpenAPI path template, e.g. `/announcements/{id}/click`. */
  path: string;
  /** HTTP method, any case. */
  method: string;
  /** The real response: its status picks the documented response, its body is validated. */
  response: {status: number; body: unknown};
  /** Response media type to validate against. Defaults to `application/json`. */
  contentType?: string;
}

export interface DocumentedResponseResult {
  valid: boolean;
  errors: string[];
}

const findResponseSchema = ({
  contentType,
  method,
  path,
  spec,
  status,
}: {
  contentType: string;
  method: string;
  path: string;
  spec: OpenApiResponseSpec;
  status: number;
}): unknown => {
  const label = `${method.toUpperCase()} ${path}`;
  const operation = spec.paths?.[path]?.[method.toLowerCase()];
  if (!operation) {
    throw new DocumentedResponseError(`${label} is not documented in the OpenAPI spec`);
  }
  const documented = operation.responses?.[String(status)];
  if (!documented) {
    const statuses = Object.keys(operation.responses ?? {}).join(", ") || "none";
    throw new DocumentedResponseError(
      `${label} has no documented ${status} response (documented: ${statuses})`
    );
  }
  const schema = documented.content?.[contentType]?.schema;
  if (!schema) {
    throw new DocumentedResponseError(`${label} ${status} response has no ${contentType} schema`);
  }
  return schema;
};

/**
 * Validates a real response body against the response schema `/openapi.json` documents for it,
 * resolving `#/components/...` references against the same spec.
 */
export const validateDocumentedResponse = ({
  contentType = "application/json",
  method,
  path,
  response,
  spec,
}: DocumentedResponseOptions): DocumentedResponseResult => {
  const schema = findResponseSchema({contentType, method, path, spec, status: response.status});
  const ajv = new Ajv({allErrors: true, strict: false});
  addFormats(ajv as unknown as Parameters<typeof addFormats>[0]);
  // Wrapping keeps `#/components/...` refs resolvable from the root of the compiled schema.
  const validate = ajv.compile({allOf: [schema], components: spec.components ?? {}});
  if (validate(response.body)) {
    return {errors: [], valid: true};
  }
  const errors = (validate.errors ?? []).map(
    (error) => `${error.instancePath || "(root)"} ${error.message ?? "is invalid"}`
  );
  return {errors, valid: false};
};

/** Throws with every schema violation when a response body does not match its documentation. */
export const expectDocumentedResponse = (options: DocumentedResponseOptions): void => {
  const {errors, valid} = validateDocumentedResponse(options);
  if (valid) {
    return;
  }
  const label = `${options.method.toUpperCase()} ${options.path} ${options.response.status}`;
  throw new DocumentedResponseError(
    `${label} response does not match its OpenAPI schema:\n- ${errors.join("\n- ")}\nBody: ${JSON.stringify(options.response.body)}`
  );
};
