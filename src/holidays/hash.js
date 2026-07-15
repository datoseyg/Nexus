import crypto from "node:crypto";

/**
 * @param {string} input
 * @returns {string} hex sha256
 */
export function sha256Hex(input) {
  return crypto.createHash("sha256").update(input, "utf8").digest("hex");
}
