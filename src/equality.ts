/**
 * The default comparison used to decide whether a control and a candidate
 * returned the same value. It approximates Ruby's `==`:
 *
 * - primitives are compared with `===` (so, like Ruby, `NaN` is not equal to `NaN`);
 * - objects that have an `equals(other)` method are compared with it;
 * - arrays, typed arrays, plain objects, `Map`, `Set`, `Date` and `RegExp` are
 *   compared structurally (deeply);
 * - any other objects (class instances) are compared by identity.
 *
 * Use `experiment.compare(...)` to supply your own comparison.
 */
export function defaultEquals(a: unknown, b: unknown): boolean {
  return deepEqual(a, b, new Map());
}

type Seen = Map<object, Set<object>>;

function deepEqual(a: unknown, b: unknown, seen: Seen): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;

  const equals = (a as { equals?: unknown }).equals;
  if (typeof equals === "function") return Boolean(equals.call(a, b));

  if (Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return false;

  // Guard against cycles: assume equality for a pair already being compared.
  let pairs = seen.get(a);
  if (pairs?.has(b)) return true;
  if (!pairs) {
    pairs = new Set();
    seen.set(a, pairs);
  }
  pairs.add(b);

  if (Array.isArray(a)) return arrayEqual(a, b as unknown[], seen);
  if (ArrayBuffer.isView(a)) {
    return arrayEqual(
      Array.from(a as unknown as ArrayLike<unknown>),
      Array.from(b as unknown as ArrayLike<unknown>),
      seen,
    );
  }
  if (a instanceof Date) return a.getTime() === (b as Date).getTime();
  if (a instanceof RegExp) {
    return a.source === (b as RegExp).source && a.flags === (b as RegExp).flags;
  }
  if (a instanceof Map) return mapEqual(a, b as Map<unknown, unknown>, seen);
  if (a instanceof Set) return setEqual(a, b as Set<unknown>, seen);

  const proto = Object.getPrototypeOf(a);
  if (proto === Object.prototype || proto === null) {
    return plainObjectEqual(a as Record<string, unknown>, b as Record<string, unknown>, seen);
  }

  return false;
}

function arrayEqual(a: unknown[], b: unknown[], seen: Seen): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (!deepEqual(a[i], b[i], seen)) return false;
  }
  return true;
}

function mapEqual(a: Map<unknown, unknown>, b: Map<unknown, unknown>, seen: Seen): boolean {
  if (a.size !== b.size) return false;
  for (const [key, value] of a) {
    if (!b.has(key) || !deepEqual(value, b.get(key), seen)) return false;
  }
  return true;
}

function setEqual(a: Set<unknown>, b: Set<unknown>, seen: Seen): boolean {
  if (a.size !== b.size) return false;
  // Members of `b` not matched by identity; each may pair with at most one member of `a`.
  const unmatched = [...b].filter((item) => !a.has(item));
  for (const item of a) {
    if (b.has(item)) continue;
    if (typeof item !== "object" || item === null) return false;
    const index = unmatched.findIndex((other) => deepEqual(item, other, seen));
    if (index === -1) return false;
    unmatched.splice(index, 1);
  }
  return true;
}

function plainObjectEqual(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
  seen: Seen,
): boolean {
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  for (const key of keysA) {
    if (!Object.hasOwn(b, key) || !deepEqual(a[key], b[key], seen)) return false;
  }
  return true;
}
