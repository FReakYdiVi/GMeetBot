import { join } from "node:path";

const DEFAULT_DATA_ROOT = join(process.cwd(), "data");

export function getDataRoot() {
  return process.env.DATA_ROOT?.trim() || DEFAULT_DATA_ROOT;
}

export function getDataPath(...segments: string[]) {
  const customRoot = process.env.DATA_ROOT?.trim();
  return customRoot ? join(customRoot, ...segments) : join(process.cwd(), "data", ...segments);
}
