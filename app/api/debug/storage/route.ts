import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getAwsS3ConfigStatus } from "@/lib/aws-storage";
import { getConfiguredCloudStorageProvider, uploadJsonArtifact } from "@/lib/cloud-artifact-storage";
import { isGcpStorageEnabled } from "@/lib/gcp-storage";

export async function GET() {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json({
    provider: getConfiguredCloudStorageProvider(),
    aws: getAwsS3ConfigStatus(),
    gcpConfigured: isGcpStorageEnabled(),
  });
}

export async function POST() {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const timestamp = new Date().toISOString();

  try {
    const result = await uploadJsonArtifact(`debug/ping-${Date.now()}.json`, {
      createdAt: timestamp,
      createdBy: user.email,
      message: "AWS/GCP storage connectivity check from Meet AI Scribe.",
    }, {
      artifactType: "debug",
      triggeredBy: user.id,
    });

    return NextResponse.json({
      ok: Boolean(result),
      provider: getConfiguredCloudStorageProvider(),
      result,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        provider: getConfiguredCloudStorageProvider(),
        error: error instanceof Error ? error.message : "Unknown storage error",
      },
      { status: 500 },
    );
  }
}
