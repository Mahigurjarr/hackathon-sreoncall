import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import multer from 'multer';
import { rbac } from '../middleware/rbac.middleware';
import { getMinioClient } from '../config/minio';
import { AppError } from '../middleware/errorHandler.middleware';
import * as storageService from '../services/storage.service';

const AVATAR_BUCKET = 'avatars';
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } });
const fileUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 250 * 1024 * 1024 } });

/** Authenticated routes (mounted in authenticated router) */
export function createStorageAuthRoutes(): Router {
  const router = Router();

  // GET /api/v1/storage/files/:fileId/download — proxy file content from MinIO
  router.get(
    '/files/:fileId/download',
    rbac('files:read'),
    async (req: Request, res: Response) => {
      const file = await storageService.getFileMetadata(req.tenantId, req.params.fileId as string);
      const { getMinioClient } = await import('../config/minio');
      const client = getMinioClient();
      const stream = await client.getObject(file.bucket, file.object_key);

      res.setHeader('Content-Type', file.mime_type);
      res.setHeader('Content-Length', file.size_bytes.toString());
      const isInline = file.mime_type.startsWith('image/') || file.mime_type === 'application/pdf';
      res.setHeader(
        'Content-Disposition',
        `${isInline ? 'inline' : 'attachment'}; filename="${encodeURIComponent(file.original_name)}"`,
      );
      stream.pipe(res);
    },
  );

  // POST /api/v1/storage/files/:fileId/upload — proxy upload to MinIO (browser can't reach MinIO directly)
  router.post(
    '/files/:fileId/upload',
    rbac('files:upload'),
    fileUpload.single('file'),
    async (req: Request, res: Response) => {
      const file = (req as any).file;
      if (!file) {
        throw AppError.badRequest('No file provided.');
      }
      await storageService.uploadFileContent(
        req.tenantId,
        req.params.fileId as string,
        file.buffer,
        file.size,
        file.mimetype,
      );
      res.status(200).json({ ok: true });
    },
  );

  // POST /api/v1/storage/avatar — upload avatar image, returns { url }
  router.post(
    '/avatar',
    rbac('files:upload'),
    upload.single('file'),
    async (req: Request, res: Response) => {
      const file = (req as any).file;
      if (!file) {
        throw AppError.badRequest('No file provided.');
      }
      if (!file.mimetype.startsWith('image/')) {
        throw AppError.badRequest('File must be an image.');
      }

      const ext = file.originalname.includes('.')
        ? '.' + file.originalname.split('.').pop()
        : '';
      const objectKey = `${req.tenantId}/avatar/${uuidv4()}${ext}`;

      const client = getMinioClient();
      await client.putObject(AVATAR_BUCKET, objectKey, file.buffer, file.size, {
        'Content-Type': file.mimetype,
      });

      // Return a proxied URL that goes through our API
      const url = `/api/v1/storage/avatar/${objectKey}`;
      res.json({ url });
    },
  );

  return router;
}

/** Public routes — avatar proxy (no auth needed, URLs contain unguessable UUIDs) */
export function createStoragePublicRoutes(): Router {
  const router = Router();

  // GET /api/v1/storage/avatar/:tenantId/:type/:fileId — proxy avatar image from MinIO
  router.get('/avatar/:tenantId/:type/:fileId', async (req: Request, res: Response) => {
    const objectKey = `${req.params.tenantId}/${req.params.type}/${req.params.fileId}`;
    if (!objectKey) {
      throw AppError.badRequest('Missing object key.');
    }

    try {
      const client = getMinioClient();
      const stat = await client.statObject(AVATAR_BUCKET, objectKey);
      const stream = await client.getObject(AVATAR_BUCKET, objectKey);

      res.setHeader('Content-Type', stat.metaData?.['content-type'] || 'image/png');
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      stream.pipe(res);
    } catch (err: any) {
      if (err.code === 'NoSuchKey' || err.code === 'NotFound') {
        throw AppError.notFound('Avatar');
      }
      throw err;
    }
  });

  return router;
}
