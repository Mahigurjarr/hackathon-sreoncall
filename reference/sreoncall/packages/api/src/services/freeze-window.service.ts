import { Types } from 'mongoose';
import { FreezeWindow, FreezeWindowDocument } from '../models/freeze-window.model';
import { AppError } from '../middleware/errorHandler.middleware';

export async function listFreezeWindows(tenantId: Types.ObjectId): Promise<FreezeWindowDocument[]> {
  return FreezeWindow.find({ tenant_id: tenantId }).sort({ start: -1 }).limit(200);
}

export async function createFreezeWindow(input: {
  tenant_id: Types.ObjectId;
  created_by: Types.ObjectId;
  name: string;
  description?: string;
  start: string;
  end: string;
  service_ids?: string[];
}): Promise<FreezeWindowDocument> {
  const start = new Date(input.start);
  const end = new Date(input.end);
  if (end <= start) throw AppError.badRequest('end must be after start');

  return FreezeWindow.create({
    tenant_id: input.tenant_id,
    name: input.name,
    description: input.description || '',
    start,
    end,
    service_ids: (input.service_ids || []).map((id) => new Types.ObjectId(id)),
    created_by: input.created_by,
  });
}

export async function deleteFreezeWindow(tenantId: Types.ObjectId, id: string): Promise<void> {
  const result = await FreezeWindow.deleteOne({ _id: id, tenant_id: tenantId });
  if (result.deletedCount === 0) throw AppError.notFound('Freeze window');
}
