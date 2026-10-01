const crypto = require("node:crypto");
const { promisify } = require("node:util");
const scrypt = promisify(crypto.scrypt);
const PREFIX = "scrypt$";
async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const key = await scrypt(password, salt, 64);
  return PREFIX + salt + "$" + key.toString("hex");
}
async function verifyPassword(password, encoded) {
  if (typeof encoded !== "string" || !encoded.startsWith(PREFIX)) return false;
  const [, salt, hash] = encoded.split("$");
  if (!salt || !hash || !/^[a-f0-9]{128}$/.test(hash)) return false;
  const key = await scrypt(password, salt, 64);
  return crypto.timingSafeEqual(key, Buffer.from(hash, "hex"));
}
module.exports = { hashPassword, verifyPassword, PREFIX };
