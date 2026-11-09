declare module "sanitize-html" {
  interface IOptions {
    allowProtocolRelative?: boolean;
    allowedAttributes?: Record<string, string[]>;
    allowedSchemes?: string[];
    allowedSchemesByTag?: Record<string, string[]>;
    allowedTags?: string[];
    disallowedTagsMode?: "discard" | "completelyDiscard" | "escape" | "recursiveEscape";
    transformTags?: Record<
      string,
      (
        tagName: string,
        attribs: Record<string, string>
      ) => {attribs: Record<string, string>; tagName: string}
    >;
  }

  interface SanitizeHtml {
    (dirty: string, options?: IOptions): string;
    defaults: {allowedAttributes: Record<string, string[]>; allowedTags: string[]};
  }

  const sanitizeHtml: SanitizeHtml;
  export default sanitizeHtml;
}
