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

function serialize(value: Json | undefined): string {
  if (value === null || typeof value === "number" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    // Match JSON.stringify: an undefined array element serializes as null.
    return `[${value.map((v) => (v === undefined ? "null" : serialize(v))).join(",")}]`;
  }
  if (isPlainObject(value)) {
    // Match JSON.stringify: a key whose value is undefined is omitted
    // entirely, not serialized as a literal. `undefined` is not valid JSON,
    // so a key present with that value (e.g. `fail(code, message)` leaving
    // `details` unset) must be dropped rather than crash canonicalization.
    const keys = Object.keys(value)
      .filter((k) => value[k] !== undefined)
      .sort();
    const parts = keys.map((k) => `${JSON.stringify(k)}:${serialize(value[k])}`);
    return `{${parts.join(",")}}`;
  }
  if (value === undefined) {
    throw new TypeError("Cannot canonicalize a top-level undefined value");
  }
  throw new TypeError(`Cannot canonicalize value of type ${typeof value}`);
}
