import { isBackupData, type BackupData } from "./db";

const iterations = 310_000;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function derive(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey("raw", encoder.encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

interface EncryptedBackup {
  format: "CSB1";
  kdf: "PBKDF2-SHA256";
  iterations: number;
  cipher: "AES-256-GCM";
  salt: string;
  iv: string;
  ciphertext: string;
}

export async function encryptBackup(data: BackupData, passphrase: string): Promise<Blob> {
  if (!passphrase) throw new Error("Enter a backup passphrase.");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await derive(passphrase, salt);
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoder.encode(JSON.stringify(data)));
  const file: EncryptedBackup = {
    format: "CSB1", kdf: "PBKDF2-SHA256", iterations, cipher: "AES-256-GCM",
    salt: toBase64(salt), iv: toBase64(iv), ciphertext: toBase64(new Uint8Array(ciphertext)),
  };
  return new Blob([JSON.stringify(file)], { type: "application/vnd.circular-sloth.backup+json" });
}

export async function decryptBackup(blob: Blob, passphrase: string): Promise<BackupData> {
  let file: Partial<EncryptedBackup>;
  try {
    file = JSON.parse(await blob.text()) as Partial<EncryptedBackup>;
  } catch {
    throw new Error("This backup file could not be read.");
  }
  if (file.format !== "CSB1" || file.kdf !== "PBKDF2-SHA256" || file.cipher !== "AES-256-GCM" ||
      file.iterations !== iterations || !file.salt || !file.iv || !file.ciphertext) {
    throw new Error("This backup file is not a supported Circular Sloth backup.");
  }
  try {
    const key = await derive(passphrase, fromBase64(file.salt));
    const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64(file.iv) }, key, fromBase64(file.ciphertext));
    const value: unknown = JSON.parse(decoder.decode(plaintext));
    if (!isBackupData(value)) throw new Error("This backup does not contain a valid family workspace.");
    return value;
  } catch (error) {
    if (error instanceof Error && error.message.includes("valid family workspace")) throw error;
    throw new Error("That passphrase did not unlock this backup. Check it and try again.");
  }
}

export function backupFilename(now = new Date()): string {
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(now);
  return `circular-sloth-backup-${date}.csb`;
}

export async function hashPin(pin: string, saltText?: string): Promise<{ hash: string; salt: string }> {
  const salt = saltText ? fromBase64(saltText) : crypto.getRandomValues(new Uint8Array(16));
  const material = await crypto.subtle.importKey("raw", encoder.encode(pin), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations, hash: "SHA-256" }, material, 256);
  return { hash: toBase64(new Uint8Array(bits)), salt: toBase64(salt) };
}

export async function verifyPin(pin: string, expected: string, salt: string): Promise<boolean> {
  const actual = fromBase64((await hashPin(pin, salt)).hash);
  const wanted = fromBase64(expected);
  if (actual.length !== wanted.length) return false;
  let difference = 0;
  for (let index = 0; index < actual.length; index += 1) difference |= actual[index]! ^ wanted[index]!;
  return difference === 0;
}

export function pinRetryDelay(wrongAttempts: number): number {
  if (wrongAttempts < 5) return 0;
  return Math.min(30_000, 5_000 * 2 ** Math.floor((wrongAttempts - 5) / 2));
}
