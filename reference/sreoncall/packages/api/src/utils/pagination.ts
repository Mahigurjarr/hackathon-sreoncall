import { Types } from 'mongoose';

export interface PaginationParams {
  cursor?: string;
  limit: number;
  sort_by?: string;
  sort_order?: 'asc' | 'desc';
}

export interface PaginatedResult<T> {
  data: T[];
  pagination: {
    next_cursor: string | null;
    prev_cursor: string | null;
    has_more: boolean;
    limit: number;
    total?: number;
  };
}

/**
 * Decode a base64-encoded cursor back to a value.
 */
export function decodeCursor(cursor: string): { id: string; value?: any } {
  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
    return JSON.parse(decoded);
  } catch {
    throw new Error('Invalid cursor format');
  }
}

/**
 * Encode a cursor from a document's _id and optional sort value.
 */
export function encodeCursor(id: string, value?: any): string {
  const payload = JSON.stringify({ id, value });
  return Buffer.from(payload, 'utf8').toString('base64url');
}

/**
 * Parse pagination query parameters.
 */
export function parsePaginationParams(query: Record<string, any>): PaginationParams {
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || 25, 1), 100);
  const sort_by = query.sort_by || 'createdAt';
  const sort_order = query.sort_order === 'asc' ? 'asc' : 'desc';
  const cursor = query.cursor || undefined;

  return { cursor, limit, sort_by, sort_order };
}

/**
 * Build a Mongoose filter for cursor-based pagination.
 * Works with any sortable field + _id as tiebreaker.
 */
export function buildCursorFilter(
  params: PaginationParams,
  baseFilter: Record<string, any> = {}
): { filter: Record<string, any>; sort: Record<string, 1 | -1> } {
  const { cursor, sort_by = 'createdAt', sort_order = 'desc' } = params;
  const sortDirection = sort_order === 'asc' ? 1 : -1;
  const sort: Record<string, 1 | -1> = { [sort_by]: sortDirection, _id: sortDirection };

  let filter = { ...baseFilter };

  if (cursor) {
    const decoded = decodeCursor(cursor);
    const operator = sort_order === 'desc' ? '$lt' : '$gt';

    if (decoded.value !== undefined) {
      filter.$or = [
        { [sort_by]: { [operator]: decoded.value } },
        {
          [sort_by]: decoded.value,
          _id: { [operator]: new Types.ObjectId(decoded.id) },
        },
      ];
    } else {
      filter._id = { [operator]: new Types.ObjectId(decoded.id) };
    }
  }

  return { filter, sort };
}

/**
 * Create paginated response from results.
 */
export function paginateResults<T extends { _id: any; [key: string]: any }>(
  results: T[],
  params: PaginationParams,
  total?: number
): PaginatedResult<T> {
  const { limit, sort_by = 'createdAt' } = params;
  const has_more = results.length > limit;
  const data = has_more ? results.slice(0, limit) : results;

  let next_cursor: string | null = null;
  if (has_more && data.length > 0) {
    const last = data[data.length - 1];
    const sortValue = sort_by !== '_id' ? last[sort_by] : undefined;
    next_cursor = encodeCursor(last._id.toString(), sortValue);
  }

  let prev_cursor: string | null = null;
  if (params.cursor && data.length > 0) {
    const first = data[0];
    const sortValue = sort_by !== '_id' ? first[sort_by] : undefined;
    prev_cursor = encodeCursor(first._id.toString(), sortValue);
  }

  return {
    data,
    pagination: {
      next_cursor,
      prev_cursor,
      has_more,
      limit,
      ...(total !== undefined ? { total } : {}),
    },
  };
}
