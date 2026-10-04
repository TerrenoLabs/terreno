/**
 * DOM node web overlays attach to so they escape ancestor stacking contexts.
 * Returns null when there is no document, or when `document.body` is not an element,
 * so callers render inline instead of calling `createPortal`.
 */
export const resolveDocumentBodyPortalTarget = (): HTMLElement | null => {
  if (typeof document === "undefined" || typeof HTMLElement === "undefined") {
    return null;
  }
  return document.body instanceof HTMLElement ? document.body : null;
};
