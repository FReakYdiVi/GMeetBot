import { AuthShell } from "@/components/auth-shell";
import { MeetScribeApp } from "@/components/meet-scribe-app";
import { getCurrentUser } from "@/lib/auth";

export default async function Home() {
  const currentUser = await getCurrentUser();

  if (!currentUser) {
    return <AuthShell />;
  }

  return <MeetScribeApp currentUser={currentUser} />;
}
