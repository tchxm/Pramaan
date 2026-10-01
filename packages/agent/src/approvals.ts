// Human approval handshake — Spec Section 14.9. This package never mints
// the AUTHORITATIVE approval token on its own in a server deployment (I-06):
// `RunAuditIO` may supply `mintApprovalToken`/`verifyApprovalToken` hooks
// backed by the server's real per-audit HMAC secret (see
// packages/server/src/security.ts). When the caller does not supply them
// (standalone CLI runs, tests), we fall back to an equivalent local
// HMAC-SHA256 scheme with a random per-audit secret generated here, so the
// handshake still works end-to-end. See runAudit.ts KNOWN RISKS.

import { createHash, createHmac, randomBytes } from "node:crypto";

export interface ApprovalTokenInfo {
  auditId: string;
  findingId: string;
  proposalId: string;
  textSha256: string;
}

export interface ApprovalCrypto {
  mint(info: ApprovalTokenInfo): string;
  verify(token: string, info: ApprovalTokenInfo): boolean;
}

function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf-8").digest("hex");
}

/** Same algorithm as packages/server/src/security.ts's mintApprovalToken,
 * duplicated deliberately (agent must not depend on server). */
function hmacToken(secret: Buffer, info: ApprovalTokenInfo): string {
  return createHmac("sha256", secret)
    .update(`${info.auditId}:${info.findingId}:${info.proposalId}:${info.textSha256}`)
    .digest("hex");
}

export function createLocalApprovalCrypto(secret: Buffer = randomBytes(32)): ApprovalCrypto {
  return {
    mint: (info) => hmacToken(secret, info),
    verify: (token, info) => token === hmacToken(secret, info),
  };
}

export function sha256OfText(text: string): string {
  return sha256Hex(text);
}
