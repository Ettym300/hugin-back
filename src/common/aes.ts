import crypto from 'crypto';

// aes-256-cbc needs exactly a 32-byte key. Relying on env.CONNECTIONS_SECRET
// being hand-typed to exactly 32 characters is fragile — a key of the wrong
// length makes createCipheriv/createDecipheriv throw synchronously, and
// since these run inside unguarded async route handlers that crashes the
// whole api process (took it down every time a Google/Drive connection was
// linked). Hash the configured secret to a fixed 32 bytes instead, so any
// non-empty secret works no matter its length.
function deriveKey(key: string) {
  return crypto.createHash('sha256').update(key).digest();
}

function encrypt(text: string, key: string) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', deriveKey(key), iv);
  let encrypted = cipher.update(text);

  encrypted = Buffer.concat([encrypted, cipher.final()]);

  return iv.toString('hex') + ':' + encrypted.toString('hex');
}

function decrypt(text: string, key: string) {
  const textParts = text.split(':');
  const iv = Buffer.from(textParts.shift()!, 'hex');
  const encryptedText = Buffer.from(textParts.join(':'), 'hex');
  const decipher = crypto.createDecipheriv('aes-256-cbc', deriveKey(key), iv);
  let decrypted = decipher.update(encryptedText);

  decrypted = Buffer.concat([decrypted, decipher.final()]);

  return decrypted.toString();
}

export default {
  encrypt,
  decrypt,
};
