import {type Block, type BlocksDocument, parseBlocks, validateBlocks} from "@terreno/blocks";
import sanitizeHtml from "sanitize-html";

const DROPPED_TAGS = new Set([
  "base",
  "button",
  "embed",
  "form",
  "frame",
  "iframe",
  "input",
  "link",
  "meta",
  "object",
  "script",
  "select",
  "textarea",
]);

const allowedTags = [
  ...sanitizeHtml.defaults.allowedTags.filter((tag) => !DROPPED_TAGS.has(tag)),
  "img",
];

const allowedAttributes: Record<string, string[]> = {};
for (const [tag, attributes] of Object.entries(sanitizeHtml.defaults.allowedAttributes)) {
  allowedAttributes[tag] = attributes.filter(
    (attribute) => attribute !== "href" && !attribute.startsWith("on")
  );
}
allowedAttributes.a = (allowedAttributes.a ?? []).filter((attribute) => attribute !== "href");
allowedAttributes.img = ["alt", "height", "src", "width"];

/**
 * Display-only HTML. Scripts, frames, forms, event handlers, and links are removed.
 * The only URL that remains is an image `data:` URL.
 */
export const sanitizeHtmlFragment = (html: string): string =>
  sanitizeHtml(html, {
    allowedAttributes,
    allowedSchemes: ["data"],
    allowedSchemesByTag: {img: ["data"]},
    allowedTags,
    allowProtocolRelative: false,
    disallowedTagsMode: "discard",
    transformTags: {
      img: (_tagName, attribs) => {
        const src = attribs.src ?? "";
        const next: Record<string, string> = {};
        if (attribs.alt !== undefined) {
          next.alt = attribs.alt;
        }
        if (/^data:image\//i.test(src)) {
          next.src = src;
        }
        return {attribs: next, tagName: "img"};
      },
    },
  });

const sanitizeBlock = (block: Block): {block: Block; changed: boolean} => {
  if (block.type === "html") {
    const html = sanitizeHtmlFragment(block.html);
    return {block: html === block.html ? block : {...block, html}, changed: html !== block.html};
  }
  if (block.type === "columns" || block.type === "card") {
    let changed = false;
    const children = block.children.map((child) => {
      const next = sanitizeBlock(child);
      changed = changed || next.changed;
      return next.block;
    });
    return {block: changed ? {...block, children} : block, changed};
  }
  return {block, changed: false};
};

/** Rewrites `html` fields in a block document. A non-document is returned unchanged. */
export const sanitizeBlocksText = (text: string): {changed: boolean; text: string} => {
  const parsed = parseBlocks(text);
  if (!parsed.ok) {
    return {changed: false, text};
  }
  const validated = validateBlocks(parsed.value, {allowHtml: true});
  if (!validated.ok) {
    return {changed: false, text};
  }
  let changed = false;
  const blocks = validated.doc.blocks.map((block) => {
    const next = sanitizeBlock(block);
    changed = changed || next.changed;
    return next.block;
  });
  if (!changed) {
    return {changed: false, text};
  }
  const doc: BlocksDocument = {blocks, v: 1};
  if (validated.doc.datasets !== undefined) {
    doc.datasets = validated.doc.datasets;
  }
  const ordered: Record<string, unknown> = {};
  ordered.v = doc.v;
  if (doc.datasets !== undefined) {
    ordered.datasets = doc.datasets;
  }
  ordered.blocks = doc.blocks;
  return {changed: true, text: JSON.stringify(ordered)};
};
