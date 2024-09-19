import crypto from "crypto";

/**
 * Generate a unique code with crypto.
 */
export function generateCode(length: number): string {
  return crypto
    .randomBytes(Math.ceil(length / 2))
    .toString("hex")
    .slice(0, length);
}
