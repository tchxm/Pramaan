#!/usr/bin/env node
// PRAMAAN CLI entry point. Spec Section 16.
import { runScan } from "./commands/scan.js";
import { runAuditCommand } from "./commands/audit.js";
import { runInspect } from "./commands/inspect.js";
import { runFix } from "./commands/fix.js";
import { runVerify } from "./commands/verify.js";
import { runEvidenceGenerate, runEvidenceVerify } from "./commands/evidence.js";
import { runApply } from "./commands/apply.js";

interface ParsedArgs {
  positionals: string[];
  flags: Record<string, string | boolean | string[]>;
}

function parseArgs(argv: string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags: Record<string, string | boolean | string[]> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        if (key === "param") {
          const existing = flags[key];
          flags[key] = existing ? [...(existing as string[]), next] : [next];
        } else {
          flags[key] = next;
        }
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positionals.push(arg);
    }
  }
  return { positionals, flags };
}

function num(v: string | boolean | string[] | undefined): number | undefined {
  if (typeof v !== "string") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}
function str(v: string | boolean | string[] | undefined): string | undefined {
  return typeof v === "string" ? v : undefined;
}
function bool(v: string | boolean | string[] | undefined): boolean {
  return v === true || v === "true";
}

async function main(): Promise<number> {
  const [command, ...rest] = process.argv.slice(2);
  if (!command) {
    console.log("pramaan: no command given. See PRAMAAN_MASTER_SPEC.md Section 16.");
    return 2;
  }
  const { positionals, flags } = parseArgs(rest);
  const cwd = process.cwd();

  switch (command) {
    case "audit": {
      const target = positionals[0];
      if (!target) {
        console.error("usage: pramaan audit <path> [flags]");
        return 2;
      }
      return runAuditCommand(target, {
        config: str(flags.config),
        out: str(flags.out) ?? "./pramaan-report",
        json: bool(flags.json),
        noRuntime: bool(flags["no-runtime"]),
        autoApprovePreview: bool(flags["auto-approve-preview"]),
        maxAttempts: num(flags["max-attempts"]),
        model: str(flags.model),
        yes: bool(flags.yes),
      });
    }
    case "scan": {
      const target = positionals[0];
      if (!target) {
        console.error("usage: pramaan scan <path>");
        return 2;
      }
      return runScan(target, { config: str(flags.config), json: bool(flags.json) });
    }
    case "inspect": {
      const findingId = positionals[0];
      if (!findingId) {
        console.error("usage: pramaan inspect <findingId>");
        return 2;
      }
      return runInspect(cwd, findingId, { audit: str(flags.audit), json: bool(flags.json) });
    }
    case "fix": {
      const findingId = positionals[0];
      if (!findingId) {
        console.error("usage: pramaan fix <findingId> --strategy <id> [--param k=v] | --agent");
        return 2;
      }
      return runFix(cwd, findingId, {
        strategy: str(flags.strategy),
        param: flags.param as string[] | undefined,
        agent: bool(flags.agent),
        audit: str(flags.audit),
      });
    }
    case "verify": {
      const findingId = positionals[0];
      return runVerify(cwd, findingId, { audit: str(flags.audit) });
    }
    case "evidence": {
      if (positionals[0] === "verify") {
        const packPath = positionals[1];
        if (!packPath) {
          console.error("usage: pramaan evidence verify <path>");
          return 2;
        }
        return runEvidenceVerify(packPath);
      }
      return runEvidenceGenerate(cwd, { audit: str(flags.audit), out: str(flags.out) });
    }
    case "apply": {
      const auditId = positionals[0];
      if (!auditId) {
        console.error("usage: pramaan apply <auditId> [--yes]");
        return 2;
      }
      return runApply(cwd, auditId, { yes: bool(flags.yes) });
    }
    default:
      console.log(`pramaan: unknown command "${command}". See PRAMAAN_MASTER_SPEC.md Section 16.`);
      return 2;
  }
}

main()
  .then((code) => process.exit(code))
  .catch((cause) => {
    console.error(cause instanceof Error ? cause.stack ?? cause.message : String(cause));
    process.exit(3);
  });
