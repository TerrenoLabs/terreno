export interface ParsedModelField {
  default?: string;
  name: string;
  ref?: string;
  required?: boolean;
  type: string;
  unique?: boolean;
}

export interface ParsedFormField {
  label?: string;
  name: string;
  required?: boolean;
  type: string;
}

const splitField = (raw: string): string[] => {
  return raw
    .split(":")
    .map((part) => part.trim())
    .filter(Boolean);
};

export const parseModelField = (raw: string): ParsedModelField => {
  const parts = splitField(raw);
  const name = parts[0];
  if (!name) {
    throw new Error(`Invalid --field value "${raw}". Expected name:Type[:flags]`);
  }
  const type = parts[1] ?? "String";
  const field: ParsedModelField = {name, type};
  for (const flag of parts.slice(2)) {
    if (flag === "required") {
      field.required = true;
      continue;
    }
    if (flag === "unique") {
      field.unique = true;
      continue;
    }
    if (flag.startsWith("ref=")) {
      field.ref = flag.slice(4);
      continue;
    }
    if (flag.startsWith("default=")) {
      field.default = flag.slice(8);
    }
  }
  return field;
};

export const parseFormField = (raw: string): ParsedFormField => {
  const parts = splitField(raw);
  const name = parts[0];
  if (!name) {
    throw new Error(`Invalid --field value "${raw}". Expected name:type[:required]`);
  }
  const type = parts[1] ?? "text";
  const required = parts.includes("required");
  const labelPart = parts.find((part) => part.startsWith("label="));
  return {
    label: labelPart ? labelPart.slice(6) : undefined,
    name,
    required,
    type,
  };
};
