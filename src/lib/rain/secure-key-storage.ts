// SEC-H1 — Secure private-key wrapping for provenance Ed25519 keys
// Client-side: generate extractable briefly, encrypt JWK, import back as non-extractable,
// persist only encrypted blob (PBKDF2-derived AES-GCM key from masterSecret).

export interface EncryptedPrivateJwk {
  ciphertext: string; // base64
  iv: string;        // base64
  salt: string;      // base64
}

async function deriveAesKey(masterSecret: string, salt: Uint8Array): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw', enc.encode(masterSecret), 'PBKDF2', false, ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 600000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encryptPrivateJwk(
  jwk: JsonWebKey,
  masterSecret: string
): Promise<EncryptedPrivateJwk> {
  const enc = new TextEncoder();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const aesKey = await deriveAesKey(masterSecret, salt);
  const plaintext = enc.encode(JSON.stringify(jwk));
  const ciphertextBuf = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv }, aesKey, plaintext
  );
  return {
    ciphertext: btoa(String.fromCharCode(...new Uint8Array(ciphertextBuf))),
    iv: btoa(String.fromCharCode(...iv)),
    salt: btoa(String.fromCharCode(...salt)),
  };
}

export async function decryptPrivateJwk(
  enc: EncryptedPrivateJwk,
  masterSecret: string
): Promise<JsonWebKey> {
  const iv = Uint8Array.from(atob(enc.iv), c => c.charCodeAt(0));
  const salt = Uint8Array.from(atob(enc.salt), c => c.charCodeAt(0));
  const ciphertext = Uint8Array.from(atob(enc.ciphertext), c => c.charCodeAt(0));
  const aesKey = await deriveAesKey(masterSecret, salt);
  const plainBuf = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv }, aesKey, ciphertext
  );
  const dec = new TextDecoder();
  return JSON.parse(dec.decode(plainBuf));
}

// Non-extractable import after decryption
export async function importPrivateKeyNonExtractable(
  jwk: JsonWebKey
): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'jwk', jwk, { name: 'Ed25519' }, false, ['sign']
  );
}
