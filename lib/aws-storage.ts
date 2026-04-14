import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

let cachedClient: S3Client | null | undefined;
let loggedAwsConfig = false;

function readEnv(...keys: string[]) {
  for (const key of keys) {
    const value = process.env[key]?.trim();

    if (value) {
      return value;
    }
  }

  return "";
}

function getBucketName() {
  return readEnv("S3_BUCKET", "AWS_S3_BUCKET");
}

function getRegion() {
  return readEnv("S3_REGION", "AWS_REGION");
}

function getObjectPrefix() {
  return readEnv("S3_PREFIX", "AWS_S3_PREFIX") || "meet-ai-scribe";
}

function getAccessKeyId() {
  return readEnv("S3_ACCESS_KEY_ID", "AWS_ACCESS_KEY_ID");
}

function getSecretAccessKey() {
  return readEnv("S3_SECRET_ACCESS_KEY", "AWS_SECRET_ACCESS_KEY");
}

function getSessionToken() {
  return readEnv("S3_SESSION_TOKEN", "AWS_SESSION_TOKEN");
}

function getS3Client() {
  if (cachedClient !== undefined) {
    return cachedClient;
  }

  const region = getRegion();
  const bucket = getBucketName();

  if (!region || !bucket) {
    cachedClient = null;
    return cachedClient;
  }

  cachedClient = new S3Client({
    region,
    credentials:
      getAccessKeyId() && getSecretAccessKey()
        ? {
            accessKeyId: getAccessKeyId(),
            secretAccessKey: getSecretAccessKey(),
            sessionToken: getSessionToken() || undefined,
          }
        : undefined,
  });

  return cachedClient;
}

export function isAwsS3Enabled() {
  return Boolean(getS3Client() && getBucketName() && getRegion());
}

export function getAwsS3ConfigStatus() {
  return {
    region: Boolean(getRegion()),
    bucket: Boolean(getBucketName()),
    accessKeyId: Boolean(getAccessKeyId()),
    secretAccessKey: Boolean(getSecretAccessKey()),
    sessionToken: Boolean(getSessionToken()),
  };
}

export async function uploadJsonToS3(
  relativePath: string,
  payload: JsonValue,
  metadata?: Record<string, string>,
) {
  const client = getS3Client();
  const bucket = getBucketName();

  if (!client || !bucket) {
    return null;
  }

  const key = `${getObjectPrefix().replace(/\/+$/, "")}/${relativePath.replace(/^\/+/, "")}`;

  if (!loggedAwsConfig) {
    loggedAwsConfig = true;
    console.info("[cloud-storage] AWS S3 upload enabled", {
      bucket,
      region: getRegion(),
      prefix: getObjectPrefix(),
      hasSessionToken: Boolean(getSessionToken()),
    });
  }

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: JSON.stringify(payload, null, 2),
      ContentType: "application/json",
      Metadata: metadata,
    }),
  );

  return {
    bucket,
    objectPath: key,
    provider: "aws-s3" as const,
  };
}
