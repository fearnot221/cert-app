import { randomInt } from "node:crypto";
import argon2 from "argon2";

/**
 * Certificate download passwords. Each one is mailed once with its serial number and only its argon2id
 * hash is stored, so neither staff nor a database copy can read it back.
 */
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I, O, 0 or 1 to misread on paper
const GROUPS = 3;
const GROUP_LENGTH = 4;

/** 12 symbols from 32, about 60 bits, written as XXXX-XXXX-XXXX. */
export function generateAccessPassword() {
  return Array.from({ length: GROUPS }, () =>
    Array.from({ length: GROUP_LENGTH }, () => ALPHABET[randomInt(ALPHABET.length)]).join(""),
  ).join("-");
}

/** What people type: any case, with or without the hyphens or spaces. */
export function normalizeAccessPassword(input: string) {
  return input.normalize("NFKC").toUpperCase().replace(/[\s-]/g, "");
}

export function hashAccessPassword(password: string) {
  return argon2.hash(normalizeAccessPassword(password), {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });
}

export async function verifyAccessPassword(hash: string, input: string) {
  const value = normalizeAccessPassword(input);
  if (value.length !== GROUPS * GROUP_LENGTH) return false;
  try {
    return await argon2.verify(hash, value);
  } catch {
    return false;
  }
}

/** Failed attempts on one certificate before it stops accepting passwords for a while. */
export const ACCESS_MAX_FAILURES = 10;
export const ACCESS_LOCK_MS = 15 * 60 * 1000;
