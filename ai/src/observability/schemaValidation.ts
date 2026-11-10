import Ajv, {type ErrorObject} from "ajv";

// Stop at the first error: allErrors walks every node of untrusted input (CodeQL js/resource-exhaustion).
const ajv = new Ajv({strict: false});

export interface SchemaValidationError {
  message: string;
  path: string;
}

export const validateAgainstSchema = (
  schema: Record<string, unknown> | undefined,
  value: unknown
): SchemaValidationError[] => {
  if (!schema) {
    return [];
  }
  const validate = ajv.compile(schema);
  const valid = validate(value);
  if (valid) {
    return [];
  }
  return (validate.errors ?? []).map((error: ErrorObject) => {
    const path = error.instancePath.length > 0 ? error.instancePath : "/";
    return {
      message: error.message ?? "schema validation failed",
      path,
    };
  });
};
