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

  // Listen on the document so shortcuts work wherever focus sits on the page.
  useEffect(() => {
    // Only web has a document; native renders without shortcuts.
    if (!enabled || typeof document === "undefined") {
      return undefined;
    }
    const listener = (event: KeyboardEvent): void => {
      const action = reviewShortcutAction(event);
      if (!action) {
        return;
      }
      event.preventDefault();
      handlerRef.current(action);
    };
    document.addEventListener("keydown", listener);
    return () => {
      document.removeEventListener("keydown", listener);
    };
  }, [enabled]);
};
