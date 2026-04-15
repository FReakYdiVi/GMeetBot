import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

type PlaywrightStorageState = {
  cookies?: unknown[];
  origins?: unknown[];
};

function getStorageStatePath() {
  return process.env.GOOGLE_ACCOUNT_STORAGE_STATE_PATH?.trim();
}

function getInlineStorageState() {
  const rawJson = process.env.GOOGLE_ACCOUNT_STORAGE_STATE_JSON?.trim();
  const rawBase64 = process.env.GOOGLE_ACCOUNT_STORAGE_STATE_BASE64?.trim();

  if (rawJson) {
    return rawJson;
  }

  if (rawBase64) {
    return Buffer.from(rawBase64, "base64").toString("utf8");
  }

  return null;
}

function looksLikePlaywrightStorageState(value: string) {
  try {
    const parsed = JSON.parse(value) as PlaywrightStorageState;
    return Array.isArray(parsed.cookies) || Array.isArray(parsed.origins);
  } catch {
    return false;
  }
}

export function bootstrapGoogleAccountStorageState() {
  const storageStatePath = getStorageStatePath();
  const inlineStorageState = getInlineStorageState();

  if (!storageStatePath || !inlineStorageState) {
    return {
      bootstrapped: false,
      reason: "missing-path-or-inline-state" as const,
    };
  }

  if (!looksLikePlaywrightStorageState(inlineStorageState)) {
    throw new Error(
      "GOOGLE_ACCOUNT_STORAGE_STATE_BASE64 / GOOGLE_ACCOUNT_STORAGE_STATE_JSON does not contain a valid Playwright storage state.",
    );
  }

  mkdirSync(dirname(storageStatePath), { recursive: true });

  const existing = existsSync(storageStatePath)
    ? readFileSync(storageStatePath, "utf8")
    : null;

  if (existing === inlineStorageState) {
    return {
      bootstrapped: false,
      reason: "already-current" as const,
      path: storageStatePath,
    };
  }

  writeFileSync(storageStatePath, inlineStorageState, "utf8");

  return {
    bootstrapped: true,
    reason: "written-from-env" as const,
    path: storageStatePath,
  };
}
