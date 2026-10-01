import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { z } from "zod";
import { err } from "./errors.js";

const checkoutStepSchema = z.object({
  name: z.string(),
  file: z.string(),
  route: z.string(),
});

const configSchema = z.object({
  srcRoot: z.string().default("src"),
  entry: z.string().default("src/main.tsx"),
  checkboxComponents: z.array(z.string()).default(["Checkbox"]),
  buttonComponents: z.array(z.string()).default(["Button"]),
  checkoutFlow: z.object({ steps: z.array(checkoutStepSchema) }).optional(),
  /** Path to a module (relative to project root) exporting a numeric fee map,
   * e.g. "src/constants/fees.ts" exporting `FEES = { handling: 39 }`.
   * Spec Appendix A. Resolved to actual amounts by pricing/extract.ts. */
  feeConstants: z.string().optional(),
  currency: z.array(z.string()).default(["₹", "Rs", "INR"]),
  runtime: z
    .object({
      buildCommand: z.string().default("npm run build"),
      outDir: z.string().default("dist"),
      routes: z.record(z.string(), z.string()).optional(),
    })
    .default({ buildCommand: "npm run build", outDir: "dist" }),
});

export type PramaanConfig = z.infer<typeof configSchema> & { configHash: string };

export async function loadConfig(configPath: string): Promise<PramaanConfig> {
  let raw: string;
  try {
    raw = await readFile(configPath, "utf-8");
  } catch (cause) {
    throw err("E_CONFIG_INVALID", `Could not read config at ${configPath}`, { cause: String(cause) });
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (cause) {
    throw err("E_CONFIG_INVALID", `Config at ${configPath} is not valid JSON`, { cause: String(cause) });
  }

  const parsed = configSchema.safeParse(json);
  if (!parsed.success) {
    throw err("E_CONFIG_INVALID", `Config at ${configPath} failed validation`, {
      issues: parsed.error.issues,
    });
  }

  const configHash = createHash("sha256").update(raw).digest("hex");
  return { ...parsed.data, configHash };
}
