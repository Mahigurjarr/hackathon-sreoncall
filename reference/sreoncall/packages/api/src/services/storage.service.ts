import { Types } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import { getMinioClient } from '../config/minio';
import { FileAttachment, FileAttachmentDocument } from '../models/file-attachment.model';
import { AppError } from '../middleware/errorHandler.middleware';
import { logger } from '../utils/logger';

const DEFAULT_BUCKET = 'attachments';
const PRESIGNED_URL_EXPIRY = 3600; // 1 hour
const MAX_FILE_SIZE = 250 * 1024 * 1024; // 250MB (matches Jira)

interface UploadRequest {
  tenant_id: Types.ObjectId;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  uploaded_by: Types.ObjectId;
  resource_type?: string;
  resource_id?: string;
  bucket?: string;
}

interface PresignedUploadResponse {
  upload_url: string;
  file_id: string;
  object_key: string;
  bucket: string;
  expires_in: number;
}

interface PresignedDownloadResponse {
  download_url: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  expires_in: number;
}

export async function generateUploadUrl(input: UploadRequest): Promise<PresignedUploadResponse> {
  if (input.size_bytes > MAX_FILE_SIZE) {
    throw AppError.badRequest(`File size exceeds maximum allowed size of ${MAX_FILE_SIZE / 1024 / 1024}MB.`);
  }

  const bucket = input.bucket || DEFAULT_BUCKET;
  const fileId = uuidv4();
  const ext = input.original_name.includes('.') ? input.original_name.split('.').pop() : '';
  const objectKey = `${input.tenant_id}/${input.resource_type || 'general'}/${fileId}${ext ? '.' + ext : ''}`;

  const client = getMinioClient();

  // Generate pre-signed PUT URL
  const uploadUrl = await client.presignedPutObject(bucket, objectKey, PRESIGNED_URL_EXPIRY);

  // Create file attachment record
  const fileAttachment = await FileAttachment.create({
    tenant_id: input.tenant_id,
    filename: `${fileId}${ext ? '.' + ext : ''}`,
    original_name: input.original_name,
    mime_type: input.mime_type,
    size_bytes: input.size_bytes,
    bucket,
    object_key: objectKey,
    uploaded_by: input.uploaded_by,
    resource_type: input.resource_type,
    resource_id: input.resource_id,
  });

  return {
    upload_url: uploadUrl,
    file_id: fileAttachment._id.toString(),
    object_key: objectKey,
    bucket,
    expires_in: PRESIGNED_URL_EXPIRY,
  };
}

export async function generateDownloadUrl(
  tenantId: Types.ObjectId,
  fileId: string
): Promise<PresignedDownloadResponse> {
  const file = await FileAttachment.findOne({ _id: fileId, tenant_id: tenantId });
  if (!file) {
    throw AppError.notFound('File');
  }

  const client = getMinioClient();
  const downloadUrl = await client.presignedGetObject(file.bucket, file.object_key, PRESIGNED_URL_EXPIRY);

  return {
    download_url: downloadUrl,
    filename: file.original_name,
    mime_type: file.mime_type,
    size_bytes: file.size_bytes,
    expires_in: PRESIGNED_URL_EXPIRY,
  };
}

export async function getFileMetadata(
  tenantId: Types.ObjectId,
  fileId: string
): Promise<FileAttachmentDocument> {
  const file = await FileAttachment.findOne({ _id: fileId, tenant_id: tenantId });
  if (!file) {
    throw AppError.notFound('File');
  }
  return file;
}

export async function getFilesForResource(
  tenantId: Types.ObjectId,
  resourceType: string,
  resourceId: string
): Promise<FileAttachmentDocument[]> {
  return FileAttachment.find({
    tenant_id: tenantId,
    resource_type: resourceType,
    resource_id: resourceId,
  }).sort({ created_at: -1 });
}

export async function uploadFileContent(
  tenantId: Types.ObjectId,
  fileId: string,
  stream: Buffer,
  size: number,
  contentType: string,
): Promise<void> {
  const file = await FileAttachment.findOne({ _id: fileId, tenant_id: tenantId });
  if (!file) {
    throw AppError.notFound('File');
  }

  const client = getMinioClient();
  await client.putObject(file.bucket, file.object_key, stream, size, {
    'Content-Type': contentType,
  });
}

export async function downloadFileBuffer(
  tenantId: Types.ObjectId,
  fileId: string
): Promise<{ buffer: Buffer; mime_type: string; original_name: string }> {
  const file = await FileAttachment.findOne({ _id: fileId, tenant_id: tenantId });
  if (!file) {
    throw AppError.notFound('File');
  }

  const client = getMinioClient();
  const stream = await client.getObject(file.bucket, file.object_key);
  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    stream.on('data', (chunk: Buffer) => chunks.push(chunk));
    stream.on('end', () => resolve());
    stream.on('error', reject);
  });

  return {
    buffer: Buffer.concat(chunks),
    mime_type: file.mime_type,
    original_name: file.original_name,
  };
}

export async function deleteFile(tenantId: Types.ObjectId, fileId: string): Promise<void> {
  const file = await FileAttachment.findOne({ _id: fileId, tenant_id: tenantId });
  if (!file) {
    throw AppError.notFound('File');
  }

  try {
    const client = getMinioClient();
    await client.removeObject(file.bucket, file.object_key);
  } catch (err: any) {
    logger.error('Failed to remove object from MinIO', {
      bucket: file.bucket,
      objectKey: file.object_key,
      error: err.message,
    });
  }

  await FileAttachment.deleteOne({ _id: fileId });
}
