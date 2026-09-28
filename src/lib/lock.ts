/**
 * Passcode lock. The passcode is never stored — only a salted PBKDF2 hash of it.
 * This is a privacy screen for the app; iOS itself encrypts the app's storage when the phone is locked.
 */
export interface PasscodeRecord {
  salt: string;
  hash: string;
  iterations: number;
}

const enc = new TextEncoder();
const toB64 = (buf: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function derive(passcode: string, salt: Uint8Array, iterations: number): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(passcode), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations }, key, 256);
  return toB64(bits);
}

export async function createPasscode(passcode: string): Promise<PasscodeRecord> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iterations = 310_000;
  return { salt: toB64(salt), hash: await derive(passcode, salt, iterations), iterations };
}

export async function checkPasscode(passcode: string, record: PasscodeRecord): Promise<boolean> {
  const h = await derive(passcode, fromB64(record.salt), record.iterations);
  // Constant-time-ish comparison.
  let diff = h.length ^ record.hash.length;
  for (let i = 0; i < Math.min(h.length, record.hash.length); i++) diff |= h.charCodeAt(i) ^ record.hash.charCodeAt(i);
  return diff === 0;
}
