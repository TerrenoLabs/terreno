import Ajv, {type ErrorObject} from "ajv";

const ajv = new Ajv({allErrors: true, strict: false});

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
