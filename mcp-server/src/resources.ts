import {existsSync, readFileSync} from "node:fs";
import {join} from "node:path";

import {getDocsRoot} from "./docsRoot.js";

const loadMarkdown = (filename: string): string => {
  const filePath = join(getDocsRoot(), "resources", filename);
  return readFileSync(filePath, "utf-8");
};

interface TypeDocType {
  type: string;
  name?: string;
  value?: unknown;
  types?: TypeDocType[];
  elementType?: TypeDocType;
  typeArguments?: TypeDocType[];
  declaration?: {signatures?: unknown[]};
}

interface TypeDocProp {
  id: number;
  name: string;
  variant: string;
  kind: number;
  flags: {isOptional?: boolean};
  comment?: {
    summary?: {kind: string; text: string}[];
    blockTags?: {tag: string; content: {kind: string; text: string}[]}[];
  };
  type?: TypeDocType;
}

interface TypeDocInterface {
  id: number;
  name: string;
  variant: string;
  kind: number;
  children?: TypeDocProp[];
}

interface TypeDocModule {
  id: number;
  name: string;
  children?: TypeDocInterface[];
}

export interface TypeDocRoot {
  children?: TypeDocModule[];
}

interface ComponentDoc {
  name: string;
  interfaceName: string;
  props: {
    name: string;
    type: string;
    description: string;
    required: boolean;
    defaultValue?: string;
  }[];
}

export const loadTypeDocJson = (): TypeDocRoot | null => {
  const filePath = join(getDocsRoot(), "ui-types-documentation.json");
  if (!existsSync(filePath)) {
    return null;
  }
  return JSON.parse(readFileSync(filePath, "utf-8"));
};

/** @internal */
export const extractTypeString = (typeObj: TypeDocType | null | undefined): string => {
  if (!typeObj) {
    return "unknown";
  }

  if (typeObj.type === "intrinsic") {
    return typeObj.name ?? "unknown";
  }

  if (typeObj.type === "literal") {
    return JSON.stringify(typeObj.value) ?? "unknown";
  }

  if (typeObj.type === "union") {
    return typeObj.types?.map((t: TypeDocType) => extractTypeString(t)).join(" | ") ?? "unknown";
  }

  if (typeObj.type === "array") {
    return `${extractTypeString(typeObj.elementType)}[]`;
  }

  if (typeObj.type === "reference") {
    if (typeObj.typeArguments) {
      const args = typeObj.typeArguments.map((t: TypeDocType) => extractTypeString(t)).join(", ");
      return `${typeObj.name ?? "unknown"}<${args}>`;
    }
    return typeObj.name ?? "unknown";
  }

  if (typeObj.type === "reflection" && typeObj.declaration) {
    if (typeObj.declaration.signatures) {
      return "function";
    }
    return "object";
  }

  return typeObj.name ?? "unknown";
};

export const parseComponentsFromTypeDoc = (typeDoc: TypeDocRoot): ComponentDoc[] => {
  const commonModule = typeDoc.children?.find((m) => m.name === "Common");
  if (!commonModule?.children) {
    return [];
  }

  // Filter to only Props interfaces (convention: ends with "Props")
  const propsInterfaces = commonModule.children.filter(
    (child) => child.name.endsWith("Props") && child.kind === 256 // Interface kind
  );

  return propsInterfaces.map((iface) => {
    const props =
      iface.children?.map((prop) => {
        const description = prop.comment?.summary?.map((s) => s.text).join("") ?? "";
        const defaultTag = prop.comment?.blockTags?.find((tag) => tag.tag === "@default");
        const defaultValue = defaultTag?.content
          ?.map((c) => c.text)
          .join("")
          .replace(/```ts?\n?/g, "")
          .replace(/```/g, "")
          .trim();

        return {
          description,
          name: prop.name,
          required: !prop.flags?.isOptional,
          type: extractTypeString(prop.type),
          ...(defaultValue && {defaultValue}),
        };
      }) ?? [];

    // Derive component name from interface name (e.g., "ButtonProps" -> "Button")
    const componentName = iface.name.replace(/Props$/, "");

    return {
      interfaceName: iface.name,
      name: componentName,
      props,
    };
  });
};

/** @internal */
export const componentToSlug = (name: string): string => {
  return name.toLowerCase().replace(/\s+/g, "-");
};

export const formatComponentMarkdown = (component: ComponentDoc): string => {
  const lines: string[] = [
    `# ${component.name}`,
    "",
    `**Interface:** \`${component.interfaceName}\``,
    "",
  ];

  // Props
  if (component.props.length > 0) {
    lines.push("## Props");
    lines.push("");
    lines.push("| Name | Type | Required | Description |");
    lines.push("|------|------|----------|-------------|");
    for (const prop of component.props) {
      const required = prop.required ? "Yes" : "No";
      const desc = prop.description || "-";
      const defaultStr = prop.defaultValue ? ` (default: \`${prop.defaultValue}\`)` : "";
      lines.push(`| \`${prop.name}\` | \`${prop.type}\` | ${required} | ${desc}${defaultStr} |`);
    }
    lines.push("");
  }

  return lines.join("\n");
};

/** @internal */
export const generateComponentListMarkdown = (components: ComponentDoc[]): string => {
  const lines: string[] = [
    "# @terreno/ui Component Reference",
    "",
    "Complete props documentation for all UI components extracted from TypeScript interfaces.",
    "",
    `**Total Components:** ${components.length}`,
    "",
    "## All Components (Alphabetical)",
    "",
    "| Component | Interface | Props Count |",
    "|-----------|-----------|-------------|",
  ];

  for (const comp of components.sort((a, b) => a.name.localeCompare(b.name))) {
    lines.push(`| ${comp.name} | \`${comp.interfaceName}\` | ${comp.props.length} |`);
  }
  lines.push("");

  lines.push("## Quick Reference");
  lines.push("");
  for (const comp of components.sort((a, b) => a.name.localeCompare(b.name))) {
    lines.push(`### ${comp.name}`);
    lines.push("");
    if (comp.props.length > 0) {
      const requiredProps = comp.props.filter((p) => p.required);
      const optionalProps = comp.props.filter((p) => !p.required);
      if (requiredProps.length > 0) {
        lines.push(`**Required:** ${requiredProps.map((p) => `\`${p.name}\``).join(", ")}`);
      }
      if (optionalProps.length > 0) {
        lines.push(`**Optional:** ${optionalProps.map((p) => `\`${p.name}\``).join(", ")}`);
      }
    } else {
      lines.push("*No props*");
    }
    lines.push("");
  }

  return lines.join("\n");
};

interface Resource {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
  content: string;
}

const buildResources = (): Resource[] => {
  const staticResources: Resource[] = [
    {
      content: loadMarkdown("overview.md"),
      description: "Overview of the Terreno monorepo and its packages",
      mimeType: "text/markdown",
      name: "Terreno Overview",
      uri: "terreno://docs/overview",
    },
    {
      content: loadMarkdown("api.md"),
      description: "Complete documentation for the @terreno/api package",
      mimeType: "text/markdown",
      name: "@terreno/api Documentation",
      uri: "terreno://docs/api",
    },
    {
      content: loadMarkdown("ui.md"),
      description: "Complete documentation for the @terreno/ui package",
      mimeType: "text/markdown",
      name: "@terreno/ui Documentation",
      uri: "terreno://docs/ui",
    },
    {
      content: loadMarkdown("syncdb.md"),
      description:
        "@terreno/syncdb — synced collections, request client + generated API hooks, auth session, config, flags",
      mimeType: "text/markdown",
      name: "@terreno/syncdb Documentation",
      uri: "terreno://docs/syncdb",
    },
    {
      content: loadMarkdown("patterns.md"),
      description: "Common patterns and best practices for Terreno development",
      mimeType: "text/markdown",
      name: "Terreno Patterns & Best Practices",
      uri: "terreno://docs/patterns",
    },
  ];

  // Load component documentation from TypeDoc JSON
  const typeDoc = loadTypeDocJson();
  const componentResources: Resource[] = [];

  if (typeDoc) {
    const componentDocs = parseComponentsFromTypeDoc(typeDoc);

    if (componentDocs.length > 0) {
      // Add component list resource
      componentResources.push({
        content: generateComponentListMarkdown(componentDocs),
        description: "List of all @terreno/ui components with their props",
        mimeType: "text/markdown",
        name: "@terreno/ui Component Reference",
        uri: "terreno://docs/ui/components",
      });

      // Add individual component resources
      for (const component of componentDocs) {
        const slug = componentToSlug(component.name);
        componentResources.push({
          content: formatComponentMarkdown(component),
          description: `Props documentation for the ${component.name} component`,
          mimeType: "text/markdown",
          name: `${component.name} Component`,
          uri: `terreno://docs/ui/components/${slug}`,
        });
      }
    }
  }

  return [...staticResources, ...componentResources];
};

export const resources: Resource[] = buildResources();
