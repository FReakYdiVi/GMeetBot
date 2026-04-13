import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getAuthCookieName } from "@/lib/auth";

export async function POST() {
  const cookieStore = await cookies();
  cookieStore.delete(getAuthCookieName());
  return NextResponse.json({ ok: true });
}
