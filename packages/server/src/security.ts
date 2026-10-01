// Path confinement + server-side approval token minting. Spec 17.4 / 14.9.
import { createHash, createHmac, randomBytes } from "node:crypto";
import { realpath } from "node:fs/promises";
import path from "node:path";
import { err } from "@pramaan/core";

export function defaultAllowedRoots(): string[] {
  const raw = process.env.PRAMAAN_ALLOWED_ROOTS;
  const roots = raw && raw.length > 0 ? raw.split(path.delimiter).filter(Boolean) : ["./fixtures", process.cwd()];
  return roots.map((r) => path.resolve(process.cwd(), r));
}

/**
 * Resolves `candidate` to a real, confined absolute path. Rejects `..`
 * traversal and symlink escapes outside every root in `allowedRoots` with
 * E_BAD_INPUT, per Section 17.4.
 */
export async function resolveConfinedPath(
  candidate: string,
  allowedRoots: string[] = defaultAllowedRoots(),
): Promise<string> {
  const segments = candidate.split(/[\\/]/);
  if (segments.includes("..")) {
    throw err("E_BAD_INPUT", "Path traversal ('..') is not allowed", { path: candidate });
  }

  const resolved = path.resolve(process.cwd(), candidate);
  let real = resolved;
  try {
    real = await realpath(resolved);
  } catch {
    // Path may not exist yet (e.g. an artifact not written); fall back to
    // the lexical resolution, still checked against the roots below.
  }

  const confined = allowedRoots.some((root) => {
    const relative = path.relative(root, real);
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
  });
  if (!confined) {
    throw err("E_BAD_INPUT", "Path resolves outside PRAMAAN_ALLOWED_ROOTS", { path: candidate });
  }
  return real;
}

export function randomSecret(): Buffer {
  return randomBytes(32);
}

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf-8").digest("hex");
}

/**
 * HMAC(auditId, findingId, proposalId, sha256(to)) minted server-side only,
 * in the approvals route handler. Never given to @pramaan/agent. Spec 14.9.
 */
export function mintApprovalToken(
  secret: Buffer,
  auditId: string,
  findingId: string,
  proposalId: string,
  to: string,
): string {
  const toHash = sha256Hex(to);
  return createHmac("sha256", secret)
    .update(`${auditId}:${findingId}:${proposalId}:${toHash}`)
    .digest("hex");
}
