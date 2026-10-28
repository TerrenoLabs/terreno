import {useEffect, useRef} from "react";

export type ReviewShortcutAction = "next" | "no" | "previous" | "skip" | "submit" | "yes";

interface ShortcutKeyEvent {
  altKey?: boolean;
  ctrlKey?: boolean;
  key: string;
  metaKey?: boolean;
  target?: unknown;
}

const isTypingTarget = (target: unknown): boolean => {
  if (!target || typeof target !== "object") {
    return false;
  }
  const element = target as {isContentEditable?: boolean; tagName?: string};
  const tag = element.tagName?.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || !!element.isContentEditable;
};

/** Map a keydown to a review action; typing in a field or using modifiers never triggers one. */
const reviewShortcutAction = (event: ShortcutKeyEvent): ReviewShortcutAction | undefined => {
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

const shortcutRoot = ():
  | {
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
  | undefined => {
  const root = globalThis as {
    document?: {
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
    };
    window?: {
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
    };
  };
  return root.window ?? root.document;
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
  useEffect(() => {
    const root = shortcutRoot();
    if (!root) {
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
      event.preventDefault();
      handlerRef.current(action);
    };
    root.addEventListener("keydown", listener, true);
    return () => {
      root.removeEventListener("keydown", listener, true);
    };
  }, []);
};
