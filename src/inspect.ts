type NodeInspect = (value: unknown, options?: Record<string, unknown>) => string;

interface InspectGlobals {
  process?: { getBuiltinModule?: (id: string) => { inspect?: NodeInspect } | undefined };
}

const nodeInspect: NodeInspect | undefined = (() => {
  try {
    return (globalThis as InspectGlobals).process?.getBuiltinModule?.("node:util")?.inspect;
  } catch {
    return undefined;
  }
})();

/**
 * Render a value as a single-line, human readable string, similar to Ruby's
 * `#inspect`. Uses `node:util`'s inspect when running on Node, and a
 * JSON-based fallback elsewhere.
 */
export function inspect(value: unknown): string {
  if (value instanceof Error) return inspectError(value);
  if (nodeInspect) return nodeInspect(value, { depth: 4, breakLength: Number.POSITIVE_INFINITY });
  return fallbackInspect(value);
}

/** Render a thrown value. Errors render as `[Name: message]`, without their stack. */
export function inspectError(error: unknown): string {
  if (error instanceof Error) return `[${error.name}: ${error.message}]`;
  return inspect(error);
}

function fallbackInspect(value: unknown): string {
  switch (typeof value) {
    case "string":
      return JSON.stringify(value);
    case "bigint":
      return `${value}n`;
    case "symbol":
      return value.toString();
    case "function":
      return `[Function: ${value.name || "(anonymous)"}]`;
    case "undefined":
      return "undefined";
    case "object":
      if (value === null) return "null";
      try {
        return (
          JSON.stringify(value, (_key, v) => (typeof v === "bigint" ? `${v}n` : v)) ?? String(value)
        );
      } catch {
        return String(value);
      }
    default:
      return String(value);
  }
}
