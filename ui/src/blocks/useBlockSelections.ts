import {useCallback, useState} from "react";

/** Local dataset choice for a chart or table, keyed by that block's id. */
export const useBlockSelections = (): {
  selections: Record<string, string>;
  setSelection: (target: string, data: string) => void;
} => {
  const [selections, setSelections] = useState<Record<string, string>>({});
  const setSelection = useCallback((target: string, data: string): void => {
    setSelections((current) => ({...current, [target]: data}));
  }, []);
  return {selections, setSelection};
};
