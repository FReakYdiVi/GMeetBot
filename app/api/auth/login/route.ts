import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createAuthCookie, getAuthCookieName, verifyUserCredentials } from "@/lib/auth";

type LoginPayload = {
  email?: string;
  password?: string;
};

export async function POST(request: Request) {
  const body = (await request.json()) as LoginPayload;
  const email = body.email?.trim() ?? "";
  const password = body.password ?? "";

  if (!email || !password) {
    return NextResponse.json(
      { error: "Please enter both email and password." },
      { status: 400 },
    );
  }

  const user = verifyUserCredentials(email, password);

  if (!user) {
    return NextResponse.json(
      { error: "Invalid email or password." },
      { status: 401 },
    );
  }

  const cookieStore = await cookies();
  cookieStore.set(getAuthCookieName(), createAuthCookie(user), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });

  return NextResponse.json({ user });
}
