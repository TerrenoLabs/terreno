/**
 * Render audit collector. Counts every component render per scenario step and says why each
 * one happened, so a change can be judged by render counts instead of by reading the code.
 *
 * Runs anywhere React runs: under `bun test` with a test renderer, or bundled into a page
 * (see `pageAudit.ts`). It must load before the React renderer does, because React only
 * reports commits to a devtools hook that already exists when the renderer starts.
 */
import {
  type Fiber,
  type FiberRoot,
  getDisplayName,
  getFiberId,
  instrument,
  isCompositeFiber,
  traverseRenderedFibers,
} from "bippy";

/**
 * Why a component rendered.
 * - `mount`: first render.
 * - `props`: a prop changed value.
 * - `state`: its own state or reducer changed.
 * - `context`: a context it reads changed.
 * - `unstable-props`: props are equal by value, but at least one has a new identity.
 * - `parent`: nothing it reads changed; it rendered only because its parent did.
 */
export type RenderCause = "mount" | "props" | "state" | "context" | "unstable-props" | "parent";

export interface ComponentStat {
  name: string;
  instances: number;
  mounts: number;
  updates: number;
  /** Updates caused by `unstable-props` or `parent`: the output could not have changed. */
  wasted: number;
  /**
   * Wasted updates whose parent component did not waste its own render in the same commit.
   * This is where a wasted subtree starts, so it is the component (or the props its parent
   * passes it) to fix.
   */
  wastedRoots: number;
  causes: Partial<Record<RenderCause, number>>;
  /** Prop name → times it changed value. */
  changedProps: Record<string, number>;
  /** Prop name → times it got a new identity with an equal value. */
  unstableProps: Record<string, number>;
}

export interface StepReport {
  label: string;
  commits: number;
  renders: number;
  updates: number;
  wasted: number;
  wastedRoots: number;
  components: ComponentStat[];
}

export interface AuditReport {
  steps: StepReport[];
  totals: {
    commits: number;
    renders: number;
    updates: number;
    wasted: number;
    wastedRoots: number;
  };
}

export interface RenderAuditOptions {
  /** Count only components whose display name matches. */
  only?: RegExp;
  /** Skip components whose display name matches. */
  ignore?: RegExp;
}

export interface RenderAudit {
  begin: (label: string) => void;
  end: () => StepReport;
  step: <T>(label: string, run: () => T | Promise<T>) => Promise<T>;
  report: () => AuditReport;
  dispose: () => void;
}

interface HookNode {
  memoizedState: unknown;
  queue: unknown;
  next: HookNode | null;
}

interface ContextNode {
  memoizedValue: unknown;
  next: ContextNode | null;
}

interface MutableStep {
  label: string;
  commits: number;
  stats: Map<string, ComponentStat>;
  instances: Map<string, Set<number>>;
}

const MAX_EQUAL_DEPTH = 24;
const MAX_EQUAL_NODES = 20000;
const WASTED_CAUSES: RenderCause[] = ["unstable-props", "parent"];

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

interface EqualBudget {
  nodes: number;
}

const visibleKeys = (value: Record<string, unknown>): string[] => {
  // React elements carry `_owner` and `_store`, which point back into the fiber tree.
  return Object.keys(value).filter((key) => !key.startsWith("_"));
};

/**
 * Value equality for props. Two functions with the same source count as equal: that is what
 * an inline callback recreated on every render looks like. A closure over changed values
 * also matches, so read the callback before calling its render wasted. Values too deep or
 * too large to compare within the budget count as changed.
 */
const isEqualValue = (a: unknown, b: unknown, budget: EqualBudget, depth = 0): boolean => {
  if (Object.is(a, b)) {
    return true;
  }
  if (typeof a === "function" && typeof b === "function") {
    return a.toString() === b.toString();
  }
  budget.nodes -= 1;
  if (depth >= MAX_EQUAL_DEPTH || budget.nodes <= 0 || a === null || b === null) {
    return false;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    return (
      a.length === b.length && a.every((item, i) => isEqualValue(item, b[i], budget, depth + 1))
    );
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const keys = visibleKeys(a);
    if (keys.length !== visibleKeys(b).length) {
      return false;
    }
    return keys.every((key) => isEqualValue(a[key], b[key], budget, depth + 1));
  }
  return false;
};

const didStateChange = (fiber: Fiber, previous: Fiber): boolean => {
  let next = fiber.memoizedState as HookNode | null;
  let prev = previous.memoizedState as HookNode | null;
  // Class components keep a plain state object here instead of a hook list.
  if (next && typeof next === "object" && !("next" in next)) {
    return !Object.is(next, prev);
  }
  while (next && prev && typeof next === "object" && typeof prev === "object") {
    if (next.queue && !Object.is(next.memoizedState, prev.memoizedState)) {
      return true;
    }
    next = next.next;
    prev = prev.next;
  }
  return false;
};

const didContextChange = (fiber: Fiber, previous: Fiber): boolean => {
  let next = (fiber.dependencies?.firstContext ?? null) as ContextNode | null;
  let prev = (previous.dependencies?.firstContext ?? null) as ContextNode | null;
  while (next && prev) {
    if (!Object.is(next.memoizedValue, prev.memoizedValue)) {
      return true;
    }
    next = next.next;
    prev = prev.next;
  }
  return false;
};

interface PropDiff {
  changed: string[];
  unstable: string[];
}

const diffProps = (fiber: Fiber, previous: Fiber): PropDiff => {
  const next = (fiber.memoizedProps ?? {}) as Record<string, unknown>;
  const prev = (previous.memoizedProps ?? {}) as Record<string, unknown>;
  const diff: PropDiff = {changed: [], unstable: []};
  for (const key of new Set([...Object.keys(next), ...Object.keys(prev)])) {
    if (Object.is(next[key], prev[key])) {
      continue;
    }
    if (isEqualValue(next[key], prev[key], {nodes: MAX_EQUAL_NODES})) {
      diff.unstable.push(key);
    } else {
      diff.changed.push(key);
    }
  }
  return diff;
};

const classify = (fiber: Fiber, diff: PropDiff): RenderCause => {
  const previous = fiber.alternate;
  if (!previous) {
    return "mount";
  }
  if (diff.changed.length > 0) {
    return "props";
  }
  if (didStateChange(fiber, previous)) {
    return "state";
  }
  if (didContextChange(fiber, previous)) {
    return "context";
  }
  return diff.unstable.length > 0 ? "unstable-props" : "parent";
};

const bump = (counts: Record<string, number>, key: string): void => {
  counts[key] = (counts[key] ?? 0) + 1;
};

const finishStep = (step: MutableStep): StepReport => {
  const components = [...step.stats.values()]
    .map((stat) => ({...stat, instances: step.instances.get(stat.name)?.size ?? 0}))
    .sort((a, b) => {
      return (
        b.wastedRoots - a.wastedRoots ||
        b.wasted - a.wasted ||
        b.updates - a.updates ||
        a.name.localeCompare(b.name)
      );
    });
  const sum = (pick: (stat: ComponentStat) => number): number => {
    return components.reduce((total, stat) => total + pick(stat), 0);
  };
  return {
    commits: step.commits,
    components,
    label: step.label,
    renders: sum((stat) => stat.mounts + stat.updates),
    updates: sum((stat) => stat.updates),
    wasted: sum((stat) => stat.wasted),
    wastedRoots: sum((stat) => stat.wastedRoots),
  };
};

interface RenderedFiber {
  fiber: Fiber;
  cause: RenderCause;
  diff: PropDiff;
}

const isWasted = (cause: RenderCause): boolean => WASTED_CAUSES.includes(cause);

/** True when the nearest parent component also wasted its render in this commit. */
const hasWastedParent = (fiber: Fiber, wasted: Set<Fiber>): boolean => {
  let parent = fiber.return;
  while (parent && !isCompositeFiber(parent)) {
    parent = parent.return;
  }
  if (!parent) {
    return false;
  }
  return wasted.has(parent) || (parent.alternate !== null && wasted.has(parent.alternate));
};

export const createRenderAudit = ({only, ignore}: RenderAuditOptions = {}): RenderAudit => {
  const finished: StepReport[] = [];
  let current: MutableStep | null = null;

  const record = ({fiber, cause, diff}: RenderedFiber, wasted: Set<Fiber>): void => {
    if (!current) {
      return;
    }
    // Production builds keep a `memo` component's display name on the wrapper only.
    const name = getDisplayName(fiber.type) ?? getDisplayName(fiber.elementType) ?? "Anonymous";
    if ((only && !only.test(name)) || ignore?.test(name)) {
      return;
    }
    let stat = current.stats.get(name);
    if (!stat) {
      stat = {
        causes: {},
        changedProps: {},
        instances: 0,
        mounts: 0,
        name,
        unstableProps: {},
        updates: 0,
        wasted: 0,
        wastedRoots: 0,
      };
      current.stats.set(name, stat);
      current.instances.set(name, new Set());
    }
    current.instances.get(name)?.add(getFiberId(fiber));
    bump(stat.causes as Record<string, number>, cause);
    if (cause === "mount") {
      stat.mounts += 1;
      return;
    }
    stat.updates += 1;
    for (const key of diff.changed) {
      bump(stat.changedProps, key);
    }
    for (const key of diff.unstable) {
      bump(stat.unstableProps, key);
    }
    if (isWasted(cause)) {
      stat.wasted += 1;
      if (!hasWastedParent(fiber, wasted)) {
        stat.wastedRoots += 1;
      }
    }
  };

  const unsubscribe = instrument({
    onCommitFiberRoot: (_rendererID: number, root: FiberRoot): void => {
      if (!current) {
        return;
      }
      current.commits += 1;
      const rendered: RenderedFiber[] = [];
      traverseRenderedFibers(root, (fiber, phase) => {
        if (phase === "unmount" || !isCompositeFiber(fiber)) {
          return;
        }
        const diff = fiber.alternate
          ? diffProps(fiber, fiber.alternate)
          : {changed: [], unstable: []};
        rendered.push({cause: classify(fiber, diff), diff, fiber});
      });
      // Ancestry is judged before `only`/`ignore`, so a filtered-out parent still counts.
      const wasted = new Set(
        rendered.filter((item) => isWasted(item.cause)).map((item) => item.fiber)
      );
      for (const item of rendered) {
        record(item, wasted);
      }
    },
  });

  const begin = (label: string): void => {
    if (current) {
      throw new Error(`renderAudit: step "${current.label}" is still open`);
    }
    current = {commits: 0, instances: new Map(), label, stats: new Map()};
  };

  const end = (): StepReport => {
    if (!current) {
      throw new Error("renderAudit: no open step");
    }
    const step = finishStep(current);
    current = null;
    finished.push(step);
    return step;
  };

  const step = async <T>(label: string, run: () => T | Promise<T>): Promise<T> => {
    begin(label);
    try {
      return await run();
    } finally {
      end();
    }
  };

  const report = (): AuditReport => {
    const total = (pick: (step: StepReport) => number): number => {
      return finished.reduce((sum, item) => sum + pick(item), 0);
    };
    if (finished.length > 0 && total((item) => item.commits) === 0) {
      throw new Error(
        "renderAudit: no commits seen. bippy loaded after the React renderer; load " +
          "scripts/preload.ts first (bun test --preload) or import renderAudit before React."
      );
    }
    return {
      steps: finished,
      totals: {
        commits: total((item) => item.commits),
        renders: total((item) => item.renders),
        updates: total((item) => item.updates),
        wasted: total((item) => item.wasted),
        wastedRoots: total((item) => item.wastedRoots),
      },
    };
  };

  return {begin, dispose: unsubscribe, end, report, step};
};

const describeProps = (counts: Record<string, number>): string => {
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => `${name}×${count}`)
    .join(", ");
};

/** Markdown summary: one table per step, the components to fix first. */
export const formatReport = (report: AuditReport, {limit = 12}: {limit?: number} = {}): string => {
  const lines: string[] = [
    `Total: ${report.totals.renders} renders in ${report.totals.commits} commits; ` +
      `${report.totals.wasted} of ${report.totals.updates} updates wasted, ` +
      `starting at ${report.totals.wastedRoots} components`,
  ];
  for (const step of report.steps) {
    lines.push(
      "",
      `### ${step.label}: ${step.renders} renders, ${step.wasted} wasted, ${step.commits} commits`,
      "",
      "| Component | Inst | Mounts | Updates | Wasted | Fix here | Causes | Unstable props | Changed props |",
      "| --- | ---: | ---: | ---: | ---: | ---: | --- | --- | --- |"
    );
    for (const stat of step.components.slice(0, limit)) {
      lines.push(
        `| ${stat.name} | ${stat.instances} | ${stat.mounts} | ${stat.updates} | ${stat.wasted} | ` +
          `${stat.wastedRoots} | ${describeProps(stat.causes as Record<string, number>)} | ` +
          `${describeProps(stat.unstableProps)} | ${describeProps(stat.changedProps)} |`
      );
    }
    if (step.components.length > limit) {
      lines.push(`| … ${step.components.length - limit} more | | | | | | | | |`);
    }
  }
  return lines.join("\n");
};

export interface PropChangeAuditOptions<Props> {
  audit: RenderAudit;
  baseline: Props;
  /** Step label → the props to switch to. Each step starts from `baseline`. */
  changes: Record<string, Props>;
  mount: (props: Props) => void | Promise<void>;
  update: (props: Props) => void | Promise<void>;
}

/**
 * The standard prop matrix: mount, re-render with the same props, then one measured step per
 * change. Props go back to `baseline` between steps, outside any step, so each step measures
 * exactly one change.
 */
export const auditPropChanges = async <Props>({
  audit,
  baseline,
  changes,
  mount,
  update,
}: PropChangeAuditOptions<Props>): Promise<void> => {
  await audit.step("mount", () => mount(baseline));
  await audit.step("same props", () => update(baseline));
  for (const [label, props] of Object.entries(changes)) {
    await audit.step(label, () => update(props));
    await update(baseline);
  }
};

/** One component's numbers for one step, for asserting a render budget in a test. */
export const componentStat = (
  report: AuditReport,
  stepLabel: string,
  componentName: string
): ComponentStat | undefined => {
  const step = report.steps.find((item) => item.label === stepLabel);
  if (!step) {
    throw new Error(`renderAudit: no step named "${stepLabel}"`);
  }
  return step.components.find((stat) => stat.name === componentName);
};
