import fs from "node:fs";
import path from "node:path";
import { LOCAL_ROOT, ensureLocalLayout } from "@/lib/local/config";

export const LOCAL_CONFIG_PATH = path.join(LOCAL_ROOT, "config.json");

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readStoredLocalConfig(): Record<string, unknown> {
  try {
    const raw = fs.readFileSync(LOCAL_CONFIG_PATH, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function writeStoredLocalConfig(next: Record<string, unknown>): void {
  ensureLocalLayout();
  fs.writeFileSync(LOCAL_CONFIG_PATH, `${JSON.stringify(next, null, 2)}\n`, "utf8");
}

export function updateStoredLocalConfig(
  updater: (current: Record<string, unknown>) => Record<string, unknown>
): Record<string, unknown> {
  const next = updater(readStoredLocalConfig());
  writeStoredLocalConfig(next);
  return next;
}
