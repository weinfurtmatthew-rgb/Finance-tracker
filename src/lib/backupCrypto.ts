/**
 * Password protection for backup files: the backup text is encrypted with AES-256-GCM, using a key made
 * from the password with PBKDF2-SHA256. Everything happens on the phone with the browser's built-in
 * Web Crypto; the password is never stored. Without the password the file can't be read, and GCM also
 * detects any change to the file, so a wrong password and a damaged file both fail to open.
 */

export const ENCRYPTED_FORMAT = 'finance-tracker-backup-encrypted';
export const ENCRYPTED_VERSION = 1;
/** OWASP's recommendation for PBKDF2-SHA256 (about half a second on a recent iPhone). */
export const PBKDF2_ITERATIONS = 600_000;

export interface EncryptedBackup {
  format: typeof ENCRYPTED_FORMAT;
  version: number;
  /** When the backup was made: readable without the password, so a file can be recognized. */
  exportedAt: string;
  kdf: { name: 'PBKDF2'; hash: 'SHA-256'; iterations: number; salt: string };
  cipher: { name: 'AES-GCM'; iv: string };
  data: string;
}

export class WrongPasswordError extends Error {
  constructor() {
    super('That password doesn’t open this backup (or the file was changed).');
    this.name = 'WrongPasswordError';
  }
}

const toBase64 = (bytes: Uint8Array) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
const fromBase64 = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

/** The AES key for a password and salt. */
export async function deriveKey(password: string, salt: Uint8Array, iterations = PBKDF2_ITERATIONS): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** Encrypts backup text. Returns the file's text and the key, so the result can be checked without deriving it again. */
export async function encryptBackup(text: string, password: string, iterations = PBKDF2_ITERATIONS): Promise<{ file: string; key: CryptoKey }> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt, iterations);
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(text)));
  let exportedAt = new Date().toISOString();
  try {
    exportedAt = JSON.parse(text).exportedAt ?? exportedAt;
  } catch {
    // Not JSON: keep the current time.
  }
  const file: EncryptedBackup = {
    format: ENCRYPTED_FORMAT,
    version: ENCRYPTED_VERSION,
    exportedAt,
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations, salt: toBase64(salt) },
    cipher: { name: 'AES-GCM', iv: toBase64(iv) },
    data: toBase64(sealed),
  };
  return { file: JSON.stringify(file), key };
}

function parseEnvelope(text: string): EncryptedBackup | null {
  try {
    const json = JSON.parse(text);
    return json?.format === ENCRYPTED_FORMAT ? json : null;
  } catch {
    return null;
  }
}

/** True for a password-protected backup file. */
export const isEncryptedBackup = (text: string) => parseEnvelope(text) !== null;

/** The plain backup text inside a protected file. Pass `key` to reuse one from encryptBackup. */
export async function decryptBackup(text: string, password: string, key?: CryptoKey): Promise<string> {
  const env = parseEnvelope(text);
  if (!env) throw new Error('This file is not a password-protected backup.');
  if (env.version > ENCRYPTED_VERSION) throw new Error('This backup was made by a newer version of the app.');
  const k = key ?? (await deriveKey(password, fromBase64(env.kdf.salt), env.kdf.iterations));
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(env.cipher.iv) as BufferSource }, k, fromBase64(env.data) as BufferSource);
    return new TextDecoder().decode(plain);
  } catch {
    throw new WrongPasswordError();
  }
}

/** When a protected file was made, without opening it. */
export const encryptedExportedAt = (text: string) => parseEnvelope(text)?.exportedAt;
