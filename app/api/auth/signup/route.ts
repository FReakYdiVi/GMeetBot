import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createAuthCookie, createUser, getAuthCookieName } from "@/lib/auth";

type SignUpPayload = {
  name?: string;
  email?: string;
  password?: string;
};

function isValidEmail(value: string) {
  return /\S+@\S+\.\S+/.test(value);
}

export async function POST(request: Request) {
  const body = (await request.json()) as SignUpPayload;
  const name = body.name?.trim() ?? "";
  const email = body.email?.trim() ?? "";
  const password = body.password ?? "";

  if (name.length < 2) {
    return NextResponse.json(
      { error: "Please enter a name with at least 2 characters." },
      { status: 400 },
    );
  }

  if (!isValidEmail(email)) {
    return NextResponse.json({ error: "Please enter a valid email." }, { status: 400 });
  }

  if (password.length < 8) {
    return NextResponse.json(
      { error: "Password must be at least 8 characters long." },
      { status: 400 },
    );
  }

  try {
    const user = createUser({ name, email, password });
    const cookieStore = await cookies();

    cookieStore.set(getAuthCookieName(), createAuthCookie(user), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
    });

    return NextResponse.json({ user }, { status: 201 });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to create account right now.";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}
