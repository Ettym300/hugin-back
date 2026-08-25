import fs from 'node:fs';
import path from 'node:path';
import { NextFunction, Request, Response } from 'express';
import sharp from 'sharp';
import { devCdnPublicRoot } from './devCdn';

const PUBLIC_IMAGE_DIRS = /^(avatars|profile_banners|emojis)\//;

function mimeFromExt(ext: string) {
  if (ext === '.gif') return 'image/gif';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  return 'application/octet-stream';
}

function resolveAssetPaths(relPath: string) {
  const normalized = relPath.replace(/\\/g, '/');
  const absolute = path.join(devCdnPublicRoot, normalized);
  const webpPath = absolute.replace(/\.(gif|png|jpe?g)$/i, '.webp');
  const gifPath = absolute.replace(/\.webp$/i, '.gif');

  return {
    absolute,
    webpPath: absolute.endsWith('.webp') ? absolute : webpPath,
    gifPath: absolute.endsWith('.gif') ? absolute : gifPath,
  };
}

export async function serveDevCdnAsset(req: Request, res: Response, next: NextFunction) {
  const relPath = decodeURIComponent(req.path.replace(/^\//, ''));
  if (!PUBLIC_IMAGE_DIRS.test(relPath)) {
    return next();
  }

  const ext = path.extname(relPath).toLowerCase();
  if (!['.webp', '.gif', '.png', '.jpg', '.jpeg'].includes(ext)) {
    return next();
  }

  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.setHeader('Cache-Control', 'public, max-age=3600');

  const { absolute, webpPath, gifPath } = resolveAssetPaths(relPath);
  const wantStatic = req.query.type === 'webp';
  const size = Number.parseInt(String(req.query.size || ''), 10);
  const hasWebp = fs.existsSync(webpPath);
  const hasGif = fs.existsSync(gifPath) || (absolute.endsWith('.gif') && fs.existsSync(absolute));
  const gifSource = hasGif ? (fs.existsSync(gifPath) ? gifPath : absolute) : undefined;

  try {
    if (wantStatic && gifSource) {
      let pipeline = sharp(gifSource, { animated: true, page: 0 });
      if (Number.isFinite(size) && size > 0 && size <= 4096) {
        pipeline = pipeline.resize(size, size, { fit: 'cover' });
      }
      const buf = await pipeline.webp().toBuffer();
      return res.type('image/webp').send(buf);
    }

    if (wantStatic && hasWebp) {
      let pipeline = sharp(webpPath, { animated: true, page: 0 });
      if (Number.isFinite(size) && size > 0 && size <= 4096) {
        pipeline = pipeline.resize(size, size, { fit: 'cover' });
      }
      const buf = await pipeline.webp().toBuffer();
      return res.type('image/webp').send(buf);
    }

    let fileToServe: string | undefined;
    let mime = 'image/webp';

    if (!wantStatic && gifSource) {
      fileToServe = gifSource;
      mime = 'image/gif';
    } else if (hasWebp) {
      fileToServe = webpPath;
    } else if (fs.existsSync(absolute)) {
      fileToServe = absolute;
      mime = mimeFromExt(path.extname(absolute));
    }

    if (!fileToServe) {
      return next();
    }

    if (Number.isFinite(size) && size > 0 && size <= 4096) {
      const resized = sharp(fileToServe, fileToServe.endsWith('.gif') ? { animated: true } : undefined)
        .resize(size, size, { fit: 'cover' });

      if (fileToServe.endsWith('.gif')) {
        const buf = await resized.gif().toBuffer();
        return res.type('image/gif').send(buf);
      }

      const buf = await resized.webp().toBuffer();
      return res.type('image/webp').send(buf);
    }

    return res.type(mime).sendFile(fileToServe);
  } catch (err) {
    console.error('[devCdn] serve failed', err);
    return next();
  }
}
