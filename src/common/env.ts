import dotenv from 'dotenv';
dotenv.config({ quiet: true });

import { JsonWebKey } from 'crypto';

function unquote(value?: string) {
  if (!value) return value as string;
  return value.trim().replace(/^['"]|['"]$/g, '');
}

const origin = (): string | string[] => {
  const raw = unquote(process.env.ORIGIN);
  if (!raw) {
    console.warn("ORIGIN is not provided in .env. '*' will be used by default.");
    return '*';
  }
  if (raw.startsWith('[')) {
    return JSON.parse(raw);
  }
  return raw;
};

export default {
  DEV_MODE: process.env.DEV_MODE === 'true',
  API_PORT: parseInt(process.env.API_PORT as string),
  HUGIN_EMBED_BOT_PRIVATE_KEY: JSON.parse((process.env.HUGIN_EMBED_BOT_PRIVATE_KEY as string) || 'null') as JsonWebKey | null,
  WS_PORT: parseInt(process.env.WS_PORT as string),
  JWT_SECRET: unquote(process.env.JWT_SECRET) as string,
  CONNECTIONS_SECRET: unquote(process.env.CONNECTIONS_SECRET) as string,
  JWT_WEBHOOK_SECRET: unquote(process.env.JWT_WEBHOOK_SECRET) as string,
  JWT_CONNECTIONS_SECRET: unquote(process.env.JWT_CONNECTIONS_SECRET) as string,
  DATABASE_URL: unquote(process.env.DATABASE_URL) as string,
  REDIS_HOST: unquote(process.env.REDIS_HOST) as string,
  REDIS_PATH: unquote(process.env.REDIS_PATH) as string,
  REDIS_PORT: parseInt(process.env.REDIS_PORT as string),
  REDIS_PASS: unquote(process.env.REDIS_PASS) as string,
  ORIGIN: origin(),
  CLIENT_URL: unquote(process.env.CLIENT_URL) as string,
  HUGIN_CDN: unquote(process.env.HUGIN_CDN) as string,
  LOCAL_HUGIN_CDN: unquote(process.env.LOCAL_HUGIN_CDN) as string,
  HUGIN_CDN_SECRET: unquote(process.env.HUGIN_CDN_SECRET) as string,
  CDN_DATA_DIR: unquote(process.env.CDN_DATA_DIR) || '.dev-cdn',

  MAX_CHANNELS_PER_SERVER: parseInt(process.env.MAX_CHANNELS_PER_SERVER || '100') as number,
  MAX_INVITES_PER_SERVER: parseInt(process.env.MAX_INVITES_PER_SERVER || '10') as number,
  MAX_ROLES_PER_SERVER: parseInt(process.env.MAX_ROLES_PER_SERVER || '50') as number,

  TURNSTILE_SECRET: process.env.TURNSTILE_SECRET as string,
  CLOUDFLARE_CALLS_ID: process.env.CLOUDFLARE_CALLS_ID as string,
  CLOUDFLARE_CALLS_TOKEN: process.env.CLOUDFLARE_CALLS_TOKEN as string,

  LIVEKIT_URL: unquote(process.env.LIVEKIT_URL) as string,
  LIVEKIT_PUBLIC_WS_URL: unquote(process.env.LIVEKIT_PUBLIC_WS_URL) as string,
  LIVEKIT_API_KEY: unquote(process.env.LIVEKIT_API_KEY) as string,
  LIVEKIT_API_SECRET: unquote(process.env.LIVEKIT_API_SECRET) as string,

  // Set to "true" when SMTP is configured and email verification should be required again.
  EMAIL_CONFIRMATION_ENABLED: process.env.EMAIL_CONFIRMATION_ENABLED === 'true',

  SMTP_USER: process.env.SMTP_USER as string,
  SMTP_PASS: process.env.SMTP_PASS as string,
  SMTP_FROM: process.env.SMTP_FROM as string,
  SMTP_HOST: process.env.SMTP_HOST as string,
  SMTP_PORT: parseInt(process.env.SMTP_PORT as string),

  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID as string,
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET as string,
  GOOGLE_REDIRECT_URL: process.env.GOOGLE_REDIRECT_URL as string,
  KLIPY_API_KEY: process.env.KLIPY_API_KEY as string,
  CLUSTER_INDEX: parseInt(process.env.CLUSTER_INDEX as string),
  OPTIMIZE_API_KEY: process.env.OPTIMIZE_API_KEY as string,
  TYPE: (process.argv.includes('--ws') ? 'ws' : 'api') as 'api' | 'ws',
  EXTERNAL_EMBED_SECRET: process.env.EXTERNAL_EMBED_SECRET as string,
};
