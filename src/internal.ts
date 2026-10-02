// Internal helpers shared by the experiment machinery. Not part of the public API.
//
// The experiment algorithm is written once, as generators ("steps"). In async
// mode every user-supplied callback result is `yield`ed so the driver can await
// it; in sync mode the generators never yield and the driver simply runs them to
// completion. This keeps the sync and async code paths semantically identical.

export type Steps<R> = Generator<unknown, R, unknown>;

export function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    value !== null &&
    (typeof value === "object" || typeof value === "function") &&
    typeof (value as { then?: unknown }).then === "function"
  );
}

/** Run steps synchronously. Sync-mode steps never yield. */
export function runSync<R>(steps: Steps<R>): R {
  const next = steps.next();
  if (!next.done) {
    throw new Error("scientist: internal error, synchronous steps yielded");
  }
  return next.value;
}

/** Run steps asynchronously, awaiting each yielded value and resuming with its result. */
export async function runAsync<R>(steps: Steps<R>): Promise<R> {
  let next = steps.next();
  while (!next.done) {
    let resolved: unknown;
    try {
      resolved = await next.value;
    } catch (error) {
      next = steps.throw(error);
      continue;
    }
    next = steps.next(resolved);
  }
  return next.value;
}

/**
 * Resolve the result of a behavior (the code under test). Async mode awaits it;
 * sync mode passes it through untouched, exactly like Ruby would.
 */
export function* behaviorValue(value: unknown, isAsync: boolean): Steps<unknown> {
  return isAsync ? yield value : value;
}

/**
 * Resolve the result of a configuration callback (compare, ignore, run_if, ...).
 * Async mode awaits it. Sync mode rejects promises, since a Promise would
 * otherwise silently be treated as a truthy value.
 */
export function* hookValue(value: unknown, isAsync: boolean, hook: string): Steps<unknown> {
  if (isAsync) return yield value;
  if (isThenable(value)) {
    throw new TypeError(
      `scientist: the ${hook} callback returned a Promise during a synchronous run; use runAsync() instead`,
    );
  }
  return value;
}
