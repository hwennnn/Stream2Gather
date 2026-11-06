import { useCallback, useLayoutEffect, useRef } from 'react';

/** Never changes, and always runs the newest `run`, so a row needn't redraw with its list. */
export const useLatest = <Args extends unknown[], Result>(run: (...args: Args) => Result) => {
  const latest = useRef(run);
  useLayoutEffect(() => {
    latest.current = run;
  });
  return useCallback((...args: Args) => latest.current(...args), []);
};
