import { Types } from 'mongoose';
import { getMeiliClient } from '../config/meilisearch';
import { logger } from '../utils/logger';

interface SearchParams {
  query: string;
  tenant_id: Types.ObjectId;
  entity_types?: string[];
  filters?: Record<string, any>;
  limit?: number;
  offset?: number;
}

interface SearchResult {
  entity_type: string;
  hits: any[];
  total_hits: number;
  processing_time_ms: number;
}

interface MultiSearchResult {
  results: SearchResult[];
  total_hits: number;
  query: string;
}

export async function search(params: SearchParams): Promise<MultiSearchResult> {
  const client = getMeiliClient();
  const entityTypes = params.entity_types || ['tickets', 'users'];
  const limit = Math.min(params.limit || 20, 100);
  const offset = params.offset || 0;

  const results: SearchResult[] = [];
  let totalHits = 0;

  for (const entityType of entityTypes) {
    try {
      const index = client.index(entityType);

      const filterParts: string[] = [`tenant_id = "${params.tenant_id.toString()}"`];

      if (params.filters) {
        for (const [key, value] of Object.entries(params.filters)) {
          if (Array.isArray(value)) {
            const values = value.map((v) => `"${v}"`).join(', ');
            filterParts.push(`${key} IN [${values}]`);
          } else if (value !== undefined && value !== null) {
            filterParts.push(`${key} = "${value}"`);
          }
        }
      }

      const searchResult = await index.search(params.query, {
        filter: filterParts.join(' AND '),
        limit,
        offset,
      });

      const entityResult: SearchResult = {
        entity_type: entityType,
        hits: searchResult.hits,
        total_hits: searchResult.estimatedTotalHits || 0,
        processing_time_ms: searchResult.processingTimeMs,
      };

      results.push(entityResult);
      totalHits += entityResult.total_hits;
    } catch (err: any) {
      logger.error(`Search failed for entity type "${entityType}"`, {
        error: err.message,
        query: params.query,
      });
      results.push({
        entity_type: entityType,
        hits: [],
        total_hits: 0,
        processing_time_ms: 0,
      });
    }
  }

  return {
    results,
    total_hits: totalHits,
    query: params.query,
  };
}

export async function indexDocument(
  indexName: string,
  document: Record<string, any>
): Promise<void> {
  try {
    const client = getMeiliClient();
    const index = client.index(indexName);
    await index.addDocuments([document]);
  } catch (err: any) {
    logger.error(`Failed to index document in "${indexName}"`, { error: err.message });
  }
}

export async function removeDocument(indexName: string, documentId: string): Promise<void> {
  try {
    const client = getMeiliClient();
    const index = client.index(indexName);
    await index.deleteDocument(documentId);
  } catch (err: any) {
    logger.error(`Failed to remove document from "${indexName}"`, { error: err.message });
  }
}
