import * as Minio from 'minio';
import { getConfig } from './index';
import { logger } from '../utils/logger';

let minioClient: Minio.Client | null = null;

const DEFAULT_BUCKETS = ['attachments', 'avatars', 'exports', 'recordings'];

export function getMinioClient(): Minio.Client {
  if (minioClient) return minioClient;

  const config = getConfig();

  minioClient = new Minio.Client({
    endPoint: config.MINIO_ENDPOINT,
    port: config.MINIO_PORT,
    useSSL: config.MINIO_USE_SSL,
    accessKey: config.MINIO_ACCESS_KEY,
    secretKey: config.MINIO_SECRET_KEY,
  });

  return minioClient;
}

export async function initMinioBuckets(): Promise<void> {
  const client = getMinioClient();

  for (const bucket of DEFAULT_BUCKETS) {
    try {
      const exists = await client.bucketExists(bucket);
      if (!exists) {
        await client.makeBucket(bucket);
        logger.info(`MinIO bucket "${bucket}" created`);
      } else {
        logger.info(`MinIO bucket "${bucket}" already exists`);
      }
    } catch (err: any) {
      logger.error(`Failed to initialize MinIO bucket "${bucket}"`, {
        error: err.message,
      });
    }
  }
}
