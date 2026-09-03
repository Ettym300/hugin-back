import express, { NextFunction, Request, Response } from 'express';
import busboy from 'busboy';
import path from 'node:path';
import env from '../common/env';
import { generateError } from '../common/errorHandler';
import {
  devCdnPublicRoot,
  ensureDevCdnDirs,
  generateDevCdnToken,
  proxyImageDimensions,
  saveDevCdnUpload,
  verifyDevCdnUpload,
  verifyDevCdnUploadToken,
  writeDevCdnTempFile,
} from './devCdn';
import { serveDevCdnAsset } from './devCdnServe';

type UploadType = 'avatars' | 'profile_banners' | 'emojis' | 'attachments';

function checkInternalSecret(req: Request, res: Response, next: NextFunction) {
  const auth = req.headers.authorization;
  if (!auth || auth !== env.RUGIN_CDN_SECRET) {
    return res.status(401).json(generateError('Unauthorized.'));
  }
  next();
}

function mimeFromFilename(filename: string) {
  const ext = path.extname(filename).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.webp') return 'image/webp';
  return 'application/octet-stream';
}

function parseRawUpload(req: Request) {
  return new Promise<{ tempPath: string; filesize: number; mimetype: string; filename: string }>(
    (resolve, reject) => {
      const fileNameHeader = req.headers['file-name'];
      const filename = fileNameHeader
        ? decodeURIComponent(String(fileNameHeader))
        : 'upload.bin';
      const mimetype = String(req.headers['content-type'] || mimeFromFilename(filename));

      writeDevCdnTempFile(req, filename)
        .then((saved) => {
          resolve({
            ...saved,
            mimetype,
            filename,
          });
        })
        .catch(reject);
    },
  );
}

function parseMultipartUpload(req: Request) {
  return new Promise<{ tempPath: string; filesize: number; mimetype: string; filename: string }>(
    (resolve, reject) => {
      const bb = busboy({
        headers: req.headers,
        limits: { files: 1, fileSize: 12 * 1024 * 1024 },
      });

      let settled = false;
      let gotFile = false;

      bb.on('file', (name, file, info) => {
        if (name !== 'f') {
          file.resume();
          return;
        }
        gotFile = true;
        const filename = info.filename || 'upload.bin';
        writeDevCdnTempFile(file, filename)
          .then((saved) => {
            if (settled) return;
            settled = true;
            resolve({
              ...saved,
              mimetype: info.mimeType || mimeFromFilename(filename),
              filename,
            });
          })
          .catch((err) => {
            if (settled) return;
            settled = true;
            reject(err);
          });
      });

      bb.on('error', (err) => {
        if (settled) return;
        settled = true;
        reject(err);
      });

      bb.on('close', () => {
        if (gotFile || settled) return;
        settled = true;
        reject(new Error('Missing file field "f".'));
      });

      req.pipe(bb);
    },
  );
}

function parseUpload(req: Request) {
  const contentType = String(req.headers['content-type'] || '');
  if (contentType.startsWith('multipart/form-data')) {
    return parseMultipartUpload(req);
  }
  return parseRawUpload(req);
}

async function handleUploadRoute(req: Request, res: Response, type: UploadType) {
  const auth = verifyDevCdnUploadToken(String(req.headers.authorization || ''));
  if (!auth) {
    return res.status(401).json(generateError('Invalid upload token.'));
  }

  const groupId = req.params.groupId as string | undefined;
  if (type !== 'emojis' && !groupId) {
    return res.status(400).json(generateError('Missing groupId.'));
  }

  try {
    const upload = await parseUpload(req);
    const fileId = await saveDevCdnUpload({
      type,
      groupId: groupId || 'emojis',
      userId: auth.userId,
      tempPath: upload.tempPath,
      mimetype: upload.mimetype,
      filesize: upload.filesize,
    });

    res.json({ fileId });
  } catch (err) {
    console.error('[devCdn] upload failed', err);
    res.status(400).json(generateError(err instanceof Error ? err.message : 'Upload failed.'));
  }
}

export function createDevCdnRouter() {
  const router = express.Router();

  router.post('/internal/generate-token', checkInternalSecret, (req, res) => {
    const { userId, channelId } = req.body || {};
    if (!userId || typeof userId !== 'string') {
      return res.status(400).json(generateError('userId is required.'));
    }

    const [result, error] = generateDevCdnToken({ userId, channelId });
    if (error || !result) {
      return res.status(400).json(generateError('Could not generate token.'));
    }

    res.json(result);
  });

  router.post('/internal/verify-file', checkInternalSecret, async (req, res) => {
    const { userId, fileId, groupId, imageOnly } = req.body || {};
    if (!userId || !fileId) {
      return res.status(400).json(generateError('userId and fileId are required.'));
    }

    const [result, error] = await verifyDevCdnUpload({
      userId,
      fileId,
      groupId,
      imageOnly: !!imageOnly,
    });

    if (error || !result) {
      return res.status(403).json(generateError(error || 'Could not verify upload.'));
    }

    res.json(result);
  });

  router.get('/proxy-dimensions', checkInternalSecret, async (req, res) => {
    const url = req.query.url;
    if (!url || typeof url !== 'string') {
      return res.status(400).json(generateError('url is required.'));
    }

    try {
      const dimensions = await proxyImageDimensions(url);
      res.json(dimensions);
    } catch (err) {
      res
        .status(400)
        .json(generateError(err instanceof Error ? err.message : 'Could not process image.'));
    }
  });

  router.post('/avatars/:groupId', (req, res) => handleUploadRoute(req, res, 'avatars'));
  router.post('/profile_banners/:groupId', (req, res) =>
    handleUploadRoute(req, res, 'profile_banners'),
  );
  router.post('/emojis', (req, res) => handleUploadRoute(req, res, 'emojis'));
  router.post('/attachments/:groupId', (req, res) => handleUploadRoute(req, res, 'attachments'));

  router.get(/^\/(avatars|profile_banners|emojis)\/.+/, serveDevCdnAsset);
  router.use(express.static(devCdnPublicRoot));

  return router;
}
