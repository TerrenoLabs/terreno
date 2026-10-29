import {useEffect, useRef} from "react";

export type ReviewShortcutAction = "next" | "no" | "previous" | "skip" | "submit" | "yes";

interface ShortcutKeyEvent {
  altKey?: boolean;
  ctrlKey?: boolean;
  key: string;
  metaKey?: boolean;
  target?: unknown;
}

interface ReviewAnswerElement {
  dataset?: {reviewAnswer?: string};
  isContentEditable?: boolean;
  parentElement?: ReviewAnswerElement | null;
  tagName?: string;
}

const HANDLED = Symbol.for("terreno.reviewShortcutHandled");

const eventObject = (event: ShortcutKeyEvent): object | undefined => {
  if (!event || typeof event !== "object") {
    return undefined;
  }
  const native = (event as {nativeEvent?: unknown}).nativeEvent;
  if (native && typeof native === "object") {
    return native;
  }
  return event;
};

const isHandled = (event: ShortcutKeyEvent): boolean => {
  const target = eventObject(event);
  return Boolean(target && (target as {[HANDLED]?: boolean})[HANDLED]);
};

const markHandled = (event: ShortcutKeyEvent): void => {
  const target = eventObject(event);
  if (target) {
    (target as {[HANDLED]?: boolean})[HANDLED] = true;
  }
};

/** Yes/No segments are focusable buttons. Keys on them still answer the question. */
const isReviewAnswerTarget = (target: unknown): boolean => {
  let node = target as ReviewAnswerElement | null;
  while (node && typeof node === "object") {
    if (node.dataset?.reviewAnswer === "true") {
      return true;
    }
    node = node.parentElement ?? null;
  }
  return false;
};

const isTypingTarget = (target: unknown): boolean => {
  if (isReviewAnswerTarget(target)) {
    return false;
  }
  if (!target || typeof target !== "object") {
    return false;
  }
  const element = target as ReviewAnswerElement;
  const tag = element.tagName?.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || !!element.isContentEditable;
};

/** Map a keydown to a review action; typing in a field or using modifiers never triggers one. */
const reviewShortcutAction = (event: ShortcutKeyEvent): ReviewShortcutAction | undefined => {
  if (isHandled(event)) {
    return undefined;
  }
  if (event.altKey || event.ctrlKey || event.metaKey || isTypingTarget(event.target)) {
    return undefined;
  }
  const key = event.key.toLowerCase();
  if (key === "y" || key === "1") {
    return "yes";
  }
  if (key === "n" || key === "2") {
    return "no";
  }
  if (key === "arrowdown" || key === "j") {
    return "next";
  }
  if (key === "arrowup" || key === "k") {
    return "previous";
  }
  if (key === "enter") {
    return "submit";
  }
  if (key === "s") {
    return "skip";
  }
  return undefined;
};

interface ShortcutRoot {
  addEventListener: (
    type: string,
    listener: (event: KeyboardEvent) => void,
    capture?: boolean
  ) => void;
  removeEventListener: (
    type: string,
    listener: (event: KeyboardEvent) => void,
    capture?: boolean
  ) => void;
}

/** Window capture misses keys in some web hosts; document capture is the fallback. */
const shortcutRoots = (): ShortcutRoot[] => {
  const root = globalThis as {document?: ShortcutRoot; window?: ShortcutRoot};
  const roots = [root.window, root.document].filter((entry): entry is ShortcutRoot =>
    Boolean(entry)
  );
  return [...new Set(roots)];
};

/** Move focus to the page so Y/N are not typed into a note field on the first item. */
export const focusReviewPage = (): void => {
  const root = globalThis as {
    document?: {activeElement?: unknown};
    window?: {focus?: () => void};
  };
  root.window?.focus?.();
  const active = root.document?.activeElement;
  if (!active || typeof active !== "object" || !("blur" in active)) {
    return;
  }
  if (!isTypingTarget(active)) {
    return;
  }
  const blur = (active as {blur?: () => void}).blur;
  if (blur) {
    blur.call(active);
  }
};

/** Web-only keyboard shortcuts for answering review questions without the mouse. */
export const useReviewShortcuts = ({
  enabled,
  onAction,
}: {
  enabled: boolean;
  onAction: (action: ReviewShortcutAction) => void;
}): void => {
  const handlerRef = useRef(onAction);
  handlerRef.current = onAction;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  // Attach once, in the capture phase, so the first item hears keys before any click.
  // Window and document both listen: a focused Yes/No segment can swallow the key before it
  // reaches window, and the same event must only answer once.
  useEffect(() => {
    const roots = shortcutRoots();
    if (roots.length === 0) {
      return undefined;
    }
    const listener = (event: KeyboardEvent): void => {
      if (!enabledRef.current) {
        return;
      }
      const action = reviewShortcutAction(event);
      if (!action) {
        return;
      }
      markHandled(event);
      event.preventDefault();
      handlerRef.current(action);
    };
    for (const root of roots) {
      root.addEventListener("keydown", listener, true);
    }
    return () => {
      for (const root of roots) {
        root.removeEventListener("keydown", listener, true);
      }
    };
  }, []);
};

/** Y/N pressed on a focused Yes/No segment. Returns undefined when the page shortcut already ran. */
export const reviewAnswerKey = (
  event: ShortcutKeyEvent
): Extract<ReviewShortcutAction, "no" | "yes"> | undefined => {
  const action = reviewShortcutAction(event);
  if (action !== "yes" && action !== "no") {
    return undefined;
  }
  markHandled(event);
  return action;
};
