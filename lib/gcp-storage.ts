import { Storage } from "@google-cloud/storage";

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

let cachedStorage: Storage | null | undefined;

function parseInlineCredentials() {
  const rawJson = process.env.GCP_SERVICE_ACCOUNT_KEY_JSON?.trim();
  const rawBase64 = process.env.GCP_SERVICE_ACCOUNT_KEY_BASE64?.trim();

  if (rawJson) {
    return JSON.parse(rawJson) as {
      client_email?: string;
      private_key?: string;
      project_id?: string;
    };
  }

  if (rawBase64) {
    return JSON.parse(Buffer.from(rawBase64, "base64").toString("utf8")) as {
      client_email?: string;
      private_key?: string;
      project_id?: string;
    };
  }

  return null;
}

function getBucketName() {
  return process.env.GCP_STORAGE_BUCKET?.trim() || "";
}

function getObjectPrefix() {
  return process.env.GCP_STORAGE_PREFIX?.trim() || "meet-ai-scribe";
}

function getStorageClient() {
  if (cachedStorage !== undefined) {
    return cachedStorage;
  }

  const projectId = process.env.GCP_PROJECT_ID?.trim();
  const credentials = parseInlineCredentials();

  if (!getBucketName()) {
    cachedStorage = null;
    return cachedStorage;
  }

  cachedStorage = credentials
    ? new Storage({
        projectId: projectId || credentials.project_id,
        credentials: {
          client_email: credentials.client_email,
          private_key: credentials.private_key,
        },
      })
    : new Storage({
        projectId,
      });

  return cachedStorage;
}

export function isGcpStorageEnabled() {
  return Boolean(getStorageClient() && getBucketName());
}

export async function uploadJsonToGcs(
  relativePath: string,
  payload: JsonValue,
  metadata?: Record<string, string>,
) {
  const storage = getStorageClient();
  const bucketName = getBucketName();

  if (!storage || !bucketName) {
    return null;
  }

  const objectPath = `${getObjectPrefix().replace(/\/+$/, "")}/${relativePath.replace(/^\/+/, "")}`;
  const file = storage.bucket(bucketName).file(objectPath);

  await file.save(JSON.stringify(payload, null, 2), {
    resumable: false,
    contentType: "application/json",
    metadata: metadata ? { metadata } : undefined,
  });

  return {
    bucket: bucketName,
    objectPath,
  };
}
