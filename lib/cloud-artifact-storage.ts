import { isAwsS3Enabled, uploadJsonToS3 } from "@/lib/aws-storage";
import { isGcpStorageEnabled, uploadJsonToGcs } from "@/lib/gcp-storage";

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export function getConfiguredCloudStorageProvider() {
  if (isAwsS3Enabled()) {
    return "aws-s3" as const;
  }

  if (isGcpStorageEnabled()) {
    return "gcp-storage" as const;
  }

  return null;
}

export async function uploadJsonArtifact(
  relativePath: string,
  payload: JsonValue,
  metadata?: Record<string, string>,
) {
  if (isAwsS3Enabled()) {
    return uploadJsonToS3(relativePath, payload, metadata);
  }

  if (isGcpStorageEnabled()) {
    return uploadJsonToGcs(relativePath, payload, metadata);
  }

  return null;
}
