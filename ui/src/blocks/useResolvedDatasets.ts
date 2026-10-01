import type {Dataset, InlineDataset, RefDataset} from "@terreno/blocks";
import {useEffect, useMemo, useState} from "react";

export interface DatasetRef {
  grain?: RefDataset["grain"];
  id: string;
  limit?: number;
}

export type ResolveDataset = (ref: DatasetRef) => Promise<InlineDataset | undefined>;

const isInline = (dataset: Dataset): dataset is InlineDataset => dataset.source !== "ref";

/**
 * Inline datasets are ready immediately. Ref datasets wait on `resolveDataset`.
 */
export const useResolvedDatasets = ({
  datasets,
  resolveDataset,
}: {
  datasets?: Record<string, Dataset>;
  resolveDataset?: ResolveDataset;
}): {loadingIds: ReadonlySet<string>; resolved: Record<string, InlineDataset | undefined>} => {
  const datasetKey = JSON.stringify(datasets ?? null);
  const {inline, refs} = useMemo(() => {
    const ready: Record<string, InlineDataset | undefined> = {};
    const pending: (DatasetRef & {name: string})[] = [];
    const parsed = JSON.parse(datasetKey) as Record<string, Dataset> | null;
    for (const [name, dataset] of Object.entries(parsed ?? {})) {
      if (isInline(dataset)) {
        ready[name] = dataset;
        continue;
      }
      pending.push({grain: dataset.grain, id: dataset.id, limit: dataset.limit, name});
    }
    return {inline: ready, refs: pending};
  }, [datasetKey]);
  const refKey = JSON.stringify(refs);
  const [resolvedRefs, setResolvedRefs] = useState<Record<string, InlineDataset | undefined>>({});
  const [loadingIds, setLoadingIds] = useState<ReadonlySet<string>>(() => new Set());

  // A ref dataset is fetched once per id, grain, and limit. Inline rows never go through the host.
  useEffect(() => {
    const currentRefs = JSON.parse(refKey) as (DatasetRef & {name: string})[];
    if (currentRefs.length === 0 || resolveDataset === undefined) {
      setLoadingIds(new Set());
      setResolvedRefs({});
      return;
    }
    let cancelled = false;
    setLoadingIds(new Set(currentRefs.map((ref) => ref.name)));
    void Promise.all(
      currentRefs.map(async (ref) => {
        const rows = await resolveDataset({grain: ref.grain, id: ref.id, limit: ref.limit});
        return [ref.name, rows] as const;
      })
    ).then((pairs) => {
      if (cancelled) {
        return;
      }
      const next: Record<string, InlineDataset | undefined> = {};
      for (const [name, rows] of pairs) {
        next[name] = rows;
      }
      setResolvedRefs(next);
      setLoadingIds(new Set());
    });
    return () => {
      cancelled = true;
    };
  }, [refKey, resolveDataset]);

  return {loadingIds, resolved: {...inline, ...resolvedRefs}};
};
