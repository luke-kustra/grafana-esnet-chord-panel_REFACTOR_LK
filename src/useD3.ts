// REFACTOR (2026-07): Converted from plain JavaScript (useD3.js + a separate
// useD3.d.ts stub) into a single typed TypeScript module. Changes:
//  - The ref and render callback are now generically typed instead of `any`.
//  - Added an optional dependency list. The old hook re-ran the d3 render on
//    EVERY React render. That was tolerable before, but the new Grafana
//    tooltip stores hover state in React state, so an unconditional re-render
//    would rebuild the entire SVG on every mouse move. Callers now pass the
//    values the visualization actually depends on.
import { useEffect, useRef, type DependencyList, type RefObject } from 'react';

/**
 * Small bridge hook between React and d3: hands a mounted DOM element to a
 * d3 render function.
 *
 * @param renderFn callback that receives the mounted element and draws into it
 * @param dependencies values that should trigger a re-draw when they change;
 *   omit to re-draw on every render (the legacy behavior)
 * @returns a ref to attach to the target element
 */
export function useD3<T extends Element>(
  renderFn: (element: T) => void,
  dependencies?: DependencyList
): RefObject<T> {
  const ref = useRef<T>(null);

  useEffect(() => {
    if (ref.current !== null) {
      renderFn(ref.current);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, dependencies);

  return ref;
}
