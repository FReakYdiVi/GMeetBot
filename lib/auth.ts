import { randomBytes, randomUUID, scryptSync, timingSafeEqual, createHmac } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { cookies } from "next/headers";
import { uploadJsonArtifact } from "@/lib/cloud-artifact-storage";
import { getDataPath, getDataRoot } from "@/lib/data-root";
import type { AuthUser } from "@/lib/types";

type StoredUser = AuthUser & {
  passwordHash: string;
};

type SessionPayload = {
  userId: string;
  email: string;
  exp: number;
};

const AUTH_COOKIE_NAME = "meet_scribe_auth";
const USERS_FILE_PATH = getDataPath("users.json");
const ONE_WEEK_IN_SECONDS = 60 * 60 * 24 * 7;

function ensureDataDir() {
  mkdirSync(getDataRoot(), { recursive: true });
}

function readUsers() {
  ensureDataDir();

  if (!existsSync(USERS_FILE_PATH)) {
    return [] as StoredUser[];
  }

  try {
    return JSON.parse(readFileSync(USERS_FILE_PATH, "utf8")) as StoredUser[];
  } catch {
    return [] as StoredUser[];
  }
}

function writeUsers(users: StoredUser[]) {
  ensureDataDir();
  writeFileSync(USERS_FILE_PATH, JSON.stringify(users, null, 2), "utf8");
  void uploadJsonArtifact("users/users.json", users, {
    artifactType: "users",
  }).catch(() => null);
}

function getAuthSecret() {
  return process.env.AUTH_SECRET ?? "dev-only-auth-secret-change-me";
}

function base64UrlEncode(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function base64UrlDecode(value: string) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function hashPassword(password: string, salt = randomBytes(16).toString("hex")) {
  const derived = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${derived}`;
}

function verifyPassword(password: string, storedHash: string) {
  const [salt, existingHash] = storedHash.split(":");

  if (!salt || !existingHash) {
    return false;
  }

  const candidate = scryptSync(password, salt, 64);
  const original = Buffer.from(existingHash, "hex");

  if (candidate.length !== original.length) {
    return false;
  }

  return timingSafeEqual(candidate, original);
}

function signPayload(payload: string) {
  return createHmac("sha256", getAuthSecret()).update(payload).digest("base64url");
}

function stripPassword(user: StoredUser): AuthUser {
  const { passwordHash, ...safeUser } = user;
  void passwordHash;
  return safeUser;
}

export function createUser(input: {
  name: string;
  email: string;
  password: string;
}) {
  const users = readUsers();
  const email = input.email.trim().toLowerCase();

  if (users.some((user) => user.email === email)) {
    throw new Error("An account with this email already exists.");
  }

  const now = new Date().toISOString();
  const user: StoredUser = {
    id: randomUUID(),
    name: input.name.trim(),
    email,
    createdAt: now,
    passwordHash: hashPassword(input.password),
  };

  users.push(user);
  writeUsers(users);
  return stripPassword(user);
}

export function verifyUserCredentials(email: string, password: string) {
  const normalizedEmail = email.trim().toLowerCase();
  const user = readUsers().find((item) => item.email === normalizedEmail);

  if (!user || !verifyPassword(password, user.passwordHash)) {
    return null;
  }

  return stripPassword(user);
}

export function findUserById(userId: string) {
  const user = readUsers().find((item) => item.id === userId);
  return user ? stripPassword(user) : null;
}

export function createAuthCookie(user: AuthUser) {
  const payload: SessionPayload = {
    userId: user.id,
    email: user.email,
    exp: Math.floor(Date.now() / 1000) + ONE_WEEK_IN_SECONDS,
  };

  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = signPayload(encodedPayload);
  return `${encodedPayload}.${signature}`;
}

export function parseAuthCookie(cookieValue: string | undefined | null) {
  if (!cookieValue) {
    return null;
  }

  const [encodedPayload, signature] = cookieValue.split(".");

  if (!encodedPayload || !signature) {
    return null;
  }

  const expectedSignature = signPayload(encodedPayload);

  if (signature !== expectedSignature) {
    return null;
  }

  try {
    const payload = JSON.parse(base64UrlDecode(encodedPayload)) as SessionPayload;

    if (payload.exp * 1000 < Date.now()) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

export async function getCurrentUser() {
  const cookieStore = await cookies();
  const payload = parseAuthCookie(cookieStore.get(AUTH_COOKIE_NAME)?.value);

  if (!payload) {
    return null;
  }

  return findUserById(payload.userId);
}

export function getAuthCookieName() {
  return AUTH_COOKIE_NAME;
}
