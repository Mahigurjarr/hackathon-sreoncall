import { MeiliSearch } from 'meilisearch';
import { getConfig } from './index';
import { logger } from '../utils/logger';

let meiliClient: MeiliSearch | null = null;

const INDEX_SETTINGS: Record<string, {
  searchableAttributes: string[];
  filterableAttributes: string[];
  sortableAttributes: string[];
}> = {
  tickets: {
    searchableAttributes: ['title', 'description', 'number', 'labels'],
    filterableAttributes: ['tenant_id', 'status', 'priority', 'assignee_id', 'team_id', 'type', 'labels'],
    sortableAttributes: ['created_at', 'updated_at', 'priority', 'number'],
  },
  users: {
    searchableAttributes: ['name', 'email'],
    filterableAttributes: ['tenant_id', 'status', 'roles'],
    sortableAttributes: ['name', 'created_at'],
  },
};

export function getMeiliClient(): MeiliSearch {
  if (meiliClient) return meiliClient;

  const config = getConfig();

  meiliClient = new MeiliSearch({
    host: config.MEILISEARCH_URL,
    apiKey: config.MEILISEARCH_MASTER_KEY,
  });

  return meiliClient;
}

export async function initMeiliIndexes(): Promise<void> {
  const client = getMeiliClient();

  for (const [indexName, settings] of Object.entries(INDEX_SETTINGS)) {
    try {
      await client.createIndex(indexName, { primaryKey: 'id' });
      logger.info(`Meilisearch index "${indexName}" created`);
    } catch (err: any) {
      if (err.code === 'index_already_exists') {
        logger.info(`Meilisearch index "${indexName}" already exists`);
      } else {
        logger.error(`Failed to create Meilisearch index "${indexName}"`, {
          error: err.message,
        });
        continue;
      }
    }

    try {
      const index = client.index(indexName);
      await index.updateSearchableAttributes(settings.searchableAttributes);
      await index.updateFilterableAttributes(settings.filterableAttributes);
      await index.updateSortableAttributes(settings.sortableAttributes);
      logger.info(`Meilisearch index "${indexName}" settings updated`);
    } catch (err: any) {
      logger.error(`Failed to update Meilisearch index "${indexName}" settings`, {
        error: err.message,
      });
    }
  }
}
