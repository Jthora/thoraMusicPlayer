import {useCallback, useInsertionEffect, useRef} from 'react';

type AnyFunction = (...args: unknown[]) => unknown;

/**
 * Returns a function with a permanent identity that always runs the latest `fn`.
 *
 * Hook APIs return these so that effects and memoized children depending on them
 * don't re-run on every render (the cause of the shell's runaway render/sync loop).
 * Call the result from effects and event handlers, not during render.
 *
 * `T extends Function` (rather than a parameterized signature) keeps TypeScript inferring
 * parameter types from the wrapped function itself, including defaulted parameters.
 */
export function useStableCallback<T extends Function>(fn: T): T {
  const latest = useRef(fn);

  useInsertionEffect(() => {
    latest.current = fn;
  });

  return useCallback(
    ((...args: unknown[]) => (latest.current as unknown as AnyFunction)(...args)) as unknown as T,
    [],
  );
}
