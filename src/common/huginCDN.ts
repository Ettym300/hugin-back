import { CustomResult } from './CustomResult';
import env from './env';

function cdnUrl(pathname: string) {
  const base = env.LOCAL_HUGIN_CDN.endsWith('/') ? env.LOCAL_HUGIN_CDN : env.LOCAL_HUGIN_CDN + '/';
  return new URL(pathname.replace(/^\//, ''), base);
}

function readImageMeta(buffer: Buffer): { width: number; height: number; animated: boolean } | null {
  if (buffer.length < 24) return null;

  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) {
    return {
      width: buffer.readUInt16LE(6),
      height: buffer.readUInt16LE(8),
      animated: buffer.includes(Buffer.from('NETSCAPE2.0')),
    };
  }

  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return {
      width: buffer.readUInt32BE(16),
      height: buffer.readUInt32BE(20),
      animated: false,
    };
  }

  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
    const type = buffer.toString('ascii', 12, 16);
    if (type === 'VP8X' && buffer.length >= 30) {
      return {
        width: 1 + buffer.readUIntLE(24, 3),
        height: 1 + buffer.readUIntLE(27, 3),
        animated: !!(buffer[20] & 0x10),
      };
    }
  }

  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buffer.length) {
      if (buffer[i] !== 0xff) break;
      const marker = buffer[i + 1];
      const len = buffer.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return {
          height: buffer.readUInt16BE(i + 5),
          width: buffer.readUInt16BE(i + 7),
          animated: false,
        };
      }
      i += 2 + len;
    }
  }

  return null;
}

async function localImageDimensions(url: string) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'HuginBot/1.0 (+https://hugin.app/bot)' },
  }).catch(() => null);
  if (!res?.ok) return null;
  const buffer = Buffer.from(await res.arrayBuffer());
  return readImageMeta(buffer);
}

export function proxyUrlImageDimensions(url: string): Promise<CustomResult<{ width: number; height: number; animated: boolean }, any>> {
  return new Promise((resolve) => {
    const endpoint = cdnUrl('proxy-dimensions');
    endpoint.searchParams.set('url', url);

    fetch(endpoint, {
      method: 'GET',
      headers: {
        Authorization: env.HUGIN_CDN_SECRET,
      },
    })
      .then(async (res) => {
        if (res.status == 200) return resolve([await res.json(), null]);
        const fallback = await localImageDimensions(url);
        resolve(fallback ? [fallback, null] : [null, true]);
      })
      .catch(async () => {
        const fallback = await localImageDimensions(url);
        resolve(fallback ? [fallback, null] : [null, true]);
      });
  });
}

export async function deleteFile(path: string) {
  return await fetch(env.LOCAL_HUGIN_CDN + 'internal', {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      Authorization: env.HUGIN_CDN_SECRET,
    },
    body: JSON.stringify({ path }),
  }).catch((err) => {
    console.trace(err);
  });
}

// deletes 1000 images from a channel.
export async function deleteChannelAttachmentBatch(channelId: string): Promise<CustomResult<{ count?: number; status: boolean }, { type: string; error?: string }>> {
  return new Promise((resolve) => {
    fetch(env.LOCAL_HUGIN_CDN + `internal/attachments/${channelId}/batch`, {
      method: 'DELETE',
      headers: {
        Authorization: env.HUGIN_CDN_SECRET,
      },
    })
      .then(async (res) => {
        if (res.status == 200) return resolve([await res.json(), null]);
        return resolve([null, await res.json()]);
      })
      .catch(() => resolve([null, { type: 'CDN_CONNECTION_FAIL' }]));
  });
}

export async function deleteImageBatch(paths: string[]) {
  return await fetch(env.LOCAL_HUGIN_CDN + 'internal/batch', {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      Authorization: env.HUGIN_CDN_SECRET,
    },
    body: JSON.stringify({ paths }),
  }).catch((e) => {});
}

// /verify/:groupId?/:fileId
interface VerifyUploadOpts {
  userId: string;
  fileId: string;
  groupId?: string;
  imageOnly?: boolean;
}

export interface VerifyResponse {
  fileId: string;
  path: string;
  filesize: number;
  animated: boolean;
  duration: number;
  mimetype: string;
  compressed: boolean;
  width?: number;
  height?: number;
  expireAt?: number;
}
export async function verifyUpload(opts: VerifyUploadOpts) {
  const url = new URL(env.LOCAL_HUGIN_CDN);
  url.pathname = `/internal/verify-file`;

  return await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: env.HUGIN_CDN_SECRET,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      userId: opts.userId,
      fileId: opts.fileId,
      groupId: opts.groupId,
      ...(opts.imageOnly ? { imageOnly: true } : {}),
    }),
  })
    .then(async (res) => {
      if (res.status == 200) return [(await res.json()) as VerifyResponse, null] as const;
      return [null, (await res.json()).message as string] as const;
    })
    .catch(() => [null, 'Could not connect to the CDN.'] as const);
}

interface GenerateTokenOps {
  userId: string;
  channelId?: string;
}
export interface GenerateTokenResponse {
  token: string;
}
export async function generateToken(opts: GenerateTokenOps) {
  const url = new URL(env.LOCAL_HUGIN_CDN);
  url.pathname = `/internal/generate-token`;

  return await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: env.HUGIN_CDN_SECRET,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      userId: opts.userId,
      channelId: opts.channelId,
    }),
  })
    .then(async (res) => {
      if (res.status == 200) return [(await res.json()) as GenerateTokenResponse, null] as const;
      return [null, (await res.json()).message as string] as const;
    })
    .catch(() => [null, 'Could not connect to the CDN.'] as const);
}
