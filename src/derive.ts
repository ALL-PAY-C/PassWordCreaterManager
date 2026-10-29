const CLASSES = {
  lower: "abcdefghijklmnopqrstuvwxyz",
  upper: "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  digits: "0123456789",
  symbols: "!@#$%^&*()-_=+[]{}:,.<>?/",
};

const ITERATIONS = 100000;
const SALT_PREFIX = "pwvault:v2";

const enc = (s: string) => new TextEncoder().encode(s);
const norm = (s: string) => s.trim().toLowerCase();

export interface DeriveInput {
  /** the app-level account used as the seed */
  appName: string;
  /** the app-level master password; every derived password depends on it */
  appPassword: string;
  /** the site or service account name */
  site: string;
  /** the simple password you would have used, e.g. "github-abc" */
  simple: string;
  length?: number;
  counter?: number;
  symbols?: boolean;
}

/**
 * Turns (seed account + seed password) x (site + simple password) into a strong password.
 * Same four inputs always produce the same string, on any device, offline.
 */
export async function derivePassword(input: DeriveInput): Promise<string> {
  const length = Math.min(Math.max(input.length ?? 16, 8), 64);
  const counter = input.counter ?? 1;
  const symbols = input.symbols !== false;

  const salt = [SALT_PREFIX, norm(input.appName), norm(input.site), input.simple].join("|");
  const base = await crypto.subtle.importKey("raw", enc(input.appPassword), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: enc(salt), iterations: ITERATIONS, hash: "SHA-256" },
    base,
    256,
  );
  const key = await crypto.subtle.importKey("raw", bits, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);

  const pool = CLASSES.lower + CLASSES.upper + CLASSES.digits + (symbols ? CLASSES.symbols : "");
  const bytes: number[] = [];
  const message = norm(input.site) + ":" + counter;
  for (let block = 0; bytes.length < length * 8; block++) {
    const mac = await crypto.subtle.sign("HMAC", key, enc(message + ":" + block));
    bytes.push(...new Uint8Array(mac));
  }

  const chars: string[] = [];
  let i = 0;
  while (chars.length < length) {
    const b = bytes[i++];
    if (b >= 256 - (256 % pool.length)) continue;
    chars.push(pool[b % pool.length]);
  }

  const required = [CLASSES.lower, CLASSES.upper, CLASSES.digits].concat(symbols ? [CLASSES.symbols] : []);
  required.forEach((set, idx) => {
    if (!chars.some((c) => set.includes(c))) chars[idx % chars.length] = set[bytes[i++ % bytes.length] % set.length];
  });

  for (let j = chars.length - 1; j > 0; j--) {
    const k = bytes[i++ % bytes.length] % (j + 1);
    const tmp = chars[j];
    chars[j] = chars[k];
    chars[k] = tmp;
  }

  return chars.join("");
}
