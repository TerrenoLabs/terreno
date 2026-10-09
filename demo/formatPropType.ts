interface TypedocTypeNode {
  declaration?: {
    signatures?: unknown[];
  };
  elementType?: TypedocTypeNode;
  name?: string;
  type?: string;
  typeArguments?: TypedocTypeNode[];
  types?: TypedocTypeNode[];
  value?: unknown;
}

/** Render a TypeDoc prop type for the demo props table. */
export const formatPropType = (type: TypedocTypeNode | undefined): string => {
  if (!type) {
    return "";
  }

  if (type.type === "intrinsic" || type.type === "reference") {
    return type.name ?? "";
  }

  if (type.type === "literal") {
    return JSON.stringify(type.value) ?? "unknown";
  }

  if (type.type === "union") {
    return type.types?.map((entry) => formatPropType(entry)).join(" | ") ?? "unknown";
  }

  if (type.type === "array") {
    return `${formatPropType(type.elementType)}[]`;
  }

  if (type.type === "reflection" && type.declaration) {
    if (type.declaration.signatures) {
      return "function";
    }
    return "object";
  }

  return type.name ?? type.type ?? "";
};

interface TypedocCommentPart {
  text?: string;
}

const TYPE_TABLE =
  /\n*\| Type \| Required \|\n\|[^\n]+\|\n\|[^\n]+\|\n*/g;

/** Drop TypeDoc's embedded type tables so the props table shows the prose. */
export const formatPropComment = (summary: TypedocCommentPart[] | undefined): string => {
  if (!summary?.length) {
    return "";
  }
  const raw = summary.map((part) => part.text ?? "").join("");
  return raw.replace(TYPE_TABLE, " ").replace(/\s+/g, " ").trim();
};
