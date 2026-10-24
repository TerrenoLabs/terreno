import {createHash} from "node:crypto";

import type {EvaluatorDimension} from "../types/observability";

/**
 * Stable fingerprint of a question set's questions. Human answers stay reusable while the
 * fingerprint matches; editing a question's key, type, wording, or range makes earlier answers
 * stale. Dimension order and the `required` flag do not change the fingerprint.
 */
export const questionSetFingerprint = (
  dimensions: Pick<EvaluatorDimension, "dataType" | "key" | "question" | "range">[]
): string => {
  const canonical = [...dimensions]
    .map((dimension) => {
      return {
        dataType: dimension.dataType,
        key: dimension.key,
        question: dimension.question?.trim() ?? null,
        range: dimension.range?.trim() ?? null,
      };
    })
    .sort((left, right) => left.key.localeCompare(right.key));
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
};
