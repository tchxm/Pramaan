// Canonical JSON serialization — Spec Section 15.3.
// UTF-8, keys sorted lexicographically at every depth, arrays in order,
// no insignificant whitespace, numbers as JSON default.

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

function isPlainObject(value: unknown): value is Record<string, Json> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function canonicalJson(value: unknown): string {
  return serialize(value as Json);
}

function serialize(value: Json): string {
  if (value === null || typeof value === "number" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(serialize).join(",")}]`;
  }
  if (isPlainObject(value)) {
    const keys = Object.keys(value).sort();
    const parts = keys.map((k) => `${JSON.stringify(k)}:${serialize(value[k] as Json)}`);
    return `{${parts.join(",")}}`;
  }
  throw new TypeError(`Cannot canonicalize value of type ${typeof value}`);
}
