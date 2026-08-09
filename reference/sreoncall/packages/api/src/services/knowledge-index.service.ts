import mongoose, { Types } from 'mongoose';
import { Incident } from '../models/incident.model';
import { Postmortem } from '../models/postmortem.model';
import { Runbook } from '../models/runbook.model';
import { ChangeRequest } from '../models/change-request.model';
import { logger } from '../utils/logger';

// ─── Knowledge Index Service ────────────────────────────────────────────────
//
// In-memory full-text search index for RAG (Retrieval-Augmented Generation).
// Indexes incidents, postmortems, runbooks, and change requests for fast
// keyword-based retrieval.
//
// This implementation uses a simple in-memory store with TF-IDF-like scoring.
// It is designed to be swapped for Meilisearch or a vector DB in production.
// ─────────────────────────────────────────────────────────────────────────────

// ─── Types ──────────────────────────────────────────────────────────────────

export type KnowledgeDocType = 'incident' | 'postmortem' | 'runbook' | 'change' | 'service_doc';

export interface KnowledgeDocument {
  id: string;
  type: KnowledgeDocType;
  tenant_id: string;
  title: string;
  content: string;          // Combined searchable text
  service_ids: string[];
  created_at: Date;
  metadata: Record<string, any>;
}

export interface SearchResult {
  document: KnowledgeDocument;
  score: number;
  highlights: string[];
}

export interface SearchOptions {
  types?: KnowledgeDocType[];
  service_ids?: string[];
  date_from?: Date;
  date_to?: Date;
  limit?: number;
}

export interface IndexStats {
  total: number;
  by_type: Record<KnowledgeDocType, number>;
}

// ─── In-Memory Store ────────────────────────────────────────────────────────

const store: Map<string, KnowledgeDocument[]> = new Map();

// ─── Text Processing Utilities ──────────────────────────────────────────────

/** Stop words to exclude from search tokens */
const STOP_WORDS = new Set([
  'a', 'an', 'the', 'is', 'it', 'in', 'on', 'at', 'to', 'for', 'of', 'and',
  'or', 'not', 'no', 'but', 'by', 'with', 'from', 'as', 'was', 'were', 'be',
  'been', 'being', 'has', 'have', 'had', 'do', 'does', 'did', 'will', 'would',
  'could', 'should', 'may', 'might', 'can', 'this', 'that', 'these', 'those',
  'are', 'am', 'so', 'if', 'then', 'than', 'too', 'very', 'just', 'about',
]);

/**
 * Tokenize text into searchable terms.
 * Lowercases, removes punctuation, filters stop words and short tokens.
 */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-_]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t));
}

/**
 * Extract highlighted snippets around matching terms in the content.
 */
function extractHighlights(content: string, queryTokens: string[], maxSnippets = 3): string[] {
  const highlights: string[] = [];
  const lowerContent = content.toLowerCase();
  const sentences = content.split(/[.!?\n]+/).filter((s) => s.trim().length > 0);

  for (const sentence of sentences) {
    if (highlights.length >= maxSnippets) break;
    const lowerSentence = sentence.toLowerCase();
    const hasMatch = queryTokens.some((token) => lowerSentence.includes(token));
    if (hasMatch) {
      const trimmed = sentence.trim();
      highlights.push(trimmed.length > 200 ? trimmed.slice(0, 200) + '...' : trimmed);
    }
  }

  return highlights;
}

// ─── Scoring ────────────────────────────────────────────────────────────────

/** Age decay half-life in milliseconds (90 days) */
const AGE_DECAY_HALF_LIFE_MS = 90 * 24 * 60 * 60 * 1000;

/** Boost multiplier for title matches vs content matches */
const TITLE_BOOST = 2.0;

/**
 * Score a document against a set of query tokens.
 * Uses a TF-IDF-like approach: fraction of matching tokens * boosts.
 */
function scoreDocument(doc: KnowledgeDocument, queryTokens: string[]): number {
  if (queryTokens.length === 0) return 0;

  const titleTokens = tokenize(doc.title);
  const contentTokens = tokenize(doc.content);

  // Count matching tokens in title and content
  let titleMatches = 0;
  let contentMatches = 0;

  for (const qt of queryTokens) {
    if (titleTokens.some((tt) => tt.includes(qt) || qt.includes(tt))) {
      titleMatches++;
    }
    if (contentTokens.some((ct) => ct.includes(qt) || qt.includes(ct))) {
      contentMatches++;
    }
  }

  // Base score: fraction of query tokens that matched anywhere
  const titleScore = (titleMatches / queryTokens.length) * TITLE_BOOST;
  const contentScore = contentMatches / queryTokens.length;
  let score = titleScore + contentScore;

  // Recency boost: more recent documents score slightly higher
  const ageMs = Date.now() - doc.created_at.getTime();
  const recencyFactor = Math.pow(0.5, ageMs / AGE_DECAY_HALF_LIFE_MS);
  score *= (1 + 0.2 * recencyFactor);   // Up to 20% boost for very recent docs

  return score;
}

// ─── Store Helpers ──────────────────────────────────────────────────────────

function getTenantDocs(tenantId: string): KnowledgeDocument[] {
  if (!store.has(tenantId)) {
    store.set(tenantId, []);
  }
  return store.get(tenantId)!;
}

function upsertDocument(doc: KnowledgeDocument): void {
  const docs = getTenantDocs(doc.tenant_id);
  const existingIdx = docs.findIndex((d) => d.id === doc.id && d.type === doc.type);
  if (existingIdx >= 0) {
    docs[existingIdx] = doc;
  } else {
    docs.push(doc);
  }
}

// ─── Indexing Functions ─────────────────────────────────────────────────────

/**
 * Index an incident: title, description, timeline messages, and AI root cause.
 */
export function indexIncident(tenantId: string, incident: any): void {
  try {
    const timelineText = (incident.timeline || [])
      .map((t: any) => t.message || '')
      .filter(Boolean)
      .join('. ');

    const rcaText = incident.ai?.root_cause || '';

    const contentParts = [
      incident.title || '',
      incident.description || '',
      timelineText,
      rcaText,
      (incident.labels || []).join(' '),
    ];

    const doc: KnowledgeDocument = {
      id: String(incident._id),
      type: 'incident',
      tenant_id: tenantId,
      title: incident.title || '',
      content: contentParts.filter(Boolean).join(' '),
      service_ids: (incident.affected_service_ids || []).map(String),
      created_at: incident.createdAt || incident.created_at || new Date(),
      metadata: {
        severity: incident.severity,
        status: incident.status,
        number: incident.number,
      },
    };

    upsertDocument(doc);
    logger.debug('Indexed incident', { tenant_id: tenantId, incident_id: doc.id });
  } catch (err: any) {
    logger.error('Failed to index incident', { tenant_id: tenantId, error: err.message });
  }
}

/**
 * Index a postmortem: title, summary, root cause, contributing factors,
 * timeline descriptions, and action item descriptions.
 */
export function indexPostmortem(tenantId: string, postmortem: any): void {
  try {
    const timelineText = (postmortem.timeline || [])
      .map((t: any) => t.description || '')
      .filter(Boolean)
      .join('. ');

    const actionItemsText = (postmortem.action_items || [])
      .map((a: any) => a.description || '')
      .filter(Boolean)
      .join('. ');

    const contributingText = (postmortem.contributing_factors || []).join('. ');

    const contentParts = [
      postmortem.title || '',
      postmortem.summary || '',
      postmortem.root_cause || '',
      contributingText,
      timelineText,
      actionItemsText,
    ];

    const doc: KnowledgeDocument = {
      id: String(postmortem._id),
      type: 'postmortem',
      tenant_id: tenantId,
      title: postmortem.title || '',
      content: contentParts.filter(Boolean).join(' '),
      service_ids: [],   // Postmortems link via incident; no direct service_ids
      created_at: postmortem.created_at || postmortem.createdAt || new Date(),
      metadata: {
        severity: postmortem.severity,
        status: postmortem.status,
        incident_id: postmortem.incident_id ? String(postmortem.incident_id) : null,
      },
    };

    upsertDocument(doc);
    logger.debug('Indexed postmortem', { tenant_id: tenantId, postmortem_id: doc.id });
  } catch (err: any) {
    logger.error('Failed to index postmortem', { tenant_id: tenantId, error: err.message });
  }
}

/**
 * Index a runbook: title, description, category, tags, and step titles/instructions.
 */
export function indexRunbook(tenantId: string, runbook: any): void {
  try {
    const stepsText = (runbook.steps || [])
      .map((s: any) => [s.title, s.instructions].filter(Boolean).join(': '))
      .filter(Boolean)
      .join('. ');

    const contentParts = [
      runbook.title || '',
      runbook.description || '',
      runbook.category || '',
      (runbook.tags || []).join(' '),
      stepsText,
    ];

    const doc: KnowledgeDocument = {
      id: String(runbook._id),
      type: 'runbook',
      tenant_id: tenantId,
      title: runbook.title || '',
      content: contentParts.filter(Boolean).join(' '),
      service_ids: (runbook.service_ids || []).map(String),
      created_at: runbook.created_at || runbook.createdAt || new Date(),
      metadata: {
        category: runbook.category,
        status: runbook.status,
        version: runbook.version,
        step_count: (runbook.steps || []).length,
      },
    };

    upsertDocument(doc);
    logger.debug('Indexed runbook', { tenant_id: tenantId, runbook_id: doc.id });
  } catch (err: any) {
    logger.error('Failed to index runbook', { tenant_id: tenantId, error: err.message });
  }
}

/**
 * Index a change request: title, description, justification, rollback plan,
 * risk factors, PIR notes, and discussion notes.
 */
export function indexChange(tenantId: string, change: any): void {
  try {
    const riskFactorsText = (change.risk?.factors || []).join('. ');
    const pirNotes = change.pir?.notes || '';
    const notesText = (change.notes || [])
      .map((n: any) => n.body || '')
      .filter(Boolean)
      .join('. ');

    const contentParts = [
      change.title || '',
      change.description || '',
      change.justification || '',
      change.rollback_plan || '',
      change.risk?.blast_radius_description || '',
      riskFactorsText,
      pirNotes,
      notesText,
      (change.labels || []).join(' '),
    ];

    const doc: KnowledgeDocument = {
      id: String(change._id),
      type: 'change',
      tenant_id: tenantId,
      title: change.title || '',
      content: contentParts.filter(Boolean).join(' '),
      service_ids: (change.affected_service_ids || []).map(String),
      created_at: change.createdAt || change.created_at || new Date(),
      metadata: {
        number: change.number,
        type: change.type,
        status: change.status,
        risk_score: change.risk?.score,
        pir_status: change.pir?.status || null,
        pir_outcome: change.pir?.outcome || null,
      },
    };

    upsertDocument(doc);
    logger.debug('Indexed change request', { tenant_id: tenantId, change_id: doc.id });
  } catch (err: any) {
    logger.error('Failed to index change request', { tenant_id: tenantId, error: err.message });
  }
}

// ─── Search Functions ───────────────────────────────────────────────────────

/**
 * Full-text search across the knowledge index for a tenant.
 *
 * Tokenizes the query, scores each document using keyword overlap with
 * title-boost and recency-boost, then applies optional filters.
 */
export function search(tenantId: string, query: string, options?: SearchOptions): SearchResult[] {
  const limit = options?.limit ?? 10;
  const queryTokens = tokenize(query);

  if (queryTokens.length === 0) {
    return [];
  }

  let docs = getTenantDocs(tenantId);

  // Apply filters before scoring for performance
  if (options?.types && options.types.length > 0) {
    const allowedTypes = new Set(options.types);
    docs = docs.filter((d) => allowedTypes.has(d.type));
  }

  if (options?.service_ids && options.service_ids.length > 0) {
    const allowedServices = new Set(options.service_ids);
    docs = docs.filter((d) =>
      d.service_ids.length === 0 || d.service_ids.some((sid) => allowedServices.has(sid))
    );
  }

  if (options?.date_from) {
    const from = options.date_from.getTime();
    docs = docs.filter((d) => d.created_at.getTime() >= from);
  }

  if (options?.date_to) {
    const to = options.date_to.getTime();
    docs = docs.filter((d) => d.created_at.getTime() <= to);
  }

  // Score and rank
  const scored: SearchResult[] = [];

  for (const doc of docs) {
    const score = scoreDocument(doc, queryTokens);
    if (score > 0) {
      scored.push({
        document: doc,
        score,
        highlights: extractHighlights(doc.content, queryTokens),
      });
    }
  }

  // Sort by score descending, then by recency
  scored.sort((a, b) => {
    if (Math.abs(a.score - b.score) > 0.001) {
      return b.score - a.score;
    }
    return b.document.created_at.getTime() - a.document.created_at.getTime();
  });

  return scored.slice(0, limit);
}

/**
 * Find documents similar to a given document by shared keywords.
 * Extracts the top keywords from the source document and searches for them.
 */
export function searchSimilar(tenantId: string, documentId: string, limit = 10): SearchResult[] {
  const docs = getTenantDocs(tenantId);
  const sourceDoc = docs.find((d) => d.id === documentId);

  if (!sourceDoc) {
    logger.warn('searchSimilar: source document not found', { tenant_id: tenantId, document_id: documentId });
    return [];
  }

  // Extract top keywords from the source document by frequency
  const tokens = tokenize(sourceDoc.title + ' ' + sourceDoc.content);
  const freq = new Map<string, number>();
  for (const token of tokens) {
    freq.set(token, (freq.get(token) || 0) + 1);
  }

  // Pick the top 15 most frequent tokens as the similarity query
  const topTokens = Array.from(freq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([token]) => token);

  if (topTokens.length === 0) {
    return [];
  }

  // Score all other documents against these tokens
  const scored: SearchResult[] = [];

  for (const doc of docs) {
    if (doc.id === documentId) continue;   // Exclude the source document

    const score = scoreDocument(doc, topTokens);
    if (score > 0) {
      scored.push({
        document: doc,
        score,
        highlights: extractHighlights(doc.content, topTokens, 2),
      });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

// ─── Index Management ───────────────────────────────────────────────────────

/**
 * Rebuild the full knowledge index for a tenant from the database.
 * Queries all Incident, Postmortem, Runbook, and ChangeRequest documents
 * and re-indexes them.
 */
export async function rebuildIndex(tenantId: string): Promise<IndexStats> {
  logger.info('Rebuilding knowledge index', { tenant_id: tenantId });
  const startTime = Date.now();

  // Clear existing index for this tenant
  store.set(tenantId, []);

  const tenantObjectId = new Types.ObjectId(tenantId);
  let incidentCount = 0;
  let postmortemCount = 0;
  let runbookCount = 0;
  let changeCount = 0;

  // ── Index Incidents ─────────────────────────────────────────────────────
  try {
    const incidents = await Incident.find({ tenant_id: tenantObjectId }).lean();
    for (const inc of incidents) {
      indexIncident(tenantId, inc);
      incidentCount++;
    }
  } catch (err: any) {
    logger.error('Failed to index incidents during rebuild', { tenant_id: tenantId, error: err.message });
  }

  // ── Index Postmortems ───────────────────────────────────────────────────
  try {
    const postmortems = await Postmortem.find({ tenant_id: tenantObjectId }).lean();
    for (const pm of postmortems) {
      indexPostmortem(tenantId, pm);
      postmortemCount++;
    }
  } catch (err: any) {
    logger.error('Failed to index postmortems during rebuild', { tenant_id: tenantId, error: err.message });
  }

  // ── Index Runbooks ──────────────────────────────────────────────────────
  try {
    const runbooks = await Runbook.find({ tenant_id: tenantObjectId }).lean();
    for (const rb of runbooks) {
      indexRunbook(tenantId, rb);
      runbookCount++;
    }
  } catch (err: any) {
    logger.error('Failed to index runbooks during rebuild', { tenant_id: tenantId, error: err.message });
  }

  // ── Index Change Requests ─────────────────────────────────────────────
  try {
    const changes = await ChangeRequest.find({ tenant_id: tenantObjectId }).lean();
    for (const cr of changes) {
      indexChange(tenantId, cr);
      changeCount++;
    }
  } catch (err: any) {
    logger.error('Failed to index change requests during rebuild', { tenant_id: tenantId, error: err.message });
  }

  const elapsed = Date.now() - startTime;
  const stats = getIndexStats(tenantId);

  logger.info('Knowledge index rebuild complete', {
    tenant_id: tenantId,
    elapsed_ms: elapsed,
    total: stats.total,
    incidents: incidentCount,
    postmortems: postmortemCount,
    runbooks: runbookCount,
    changes: changeCount,
  });

  return stats;
}

/**
 * Return the count of indexed documents by type for a tenant.
 */
export function getIndexStats(tenantId: string): IndexStats {
  const docs = store.get(tenantId) || [];

  const byType: Record<KnowledgeDocType, number> = {
    incident: 0,
    postmortem: 0,
    runbook: 0,
    change: 0,
    service_doc: 0,
  };

  for (const doc of docs) {
    byType[doc.type] = (byType[doc.type] || 0) + 1;
  }

  return {
    total: docs.length,
    by_type: byType,
  };
}

// ─── Utility Exports ────────────────────────────────────────────────────────

/**
 * Remove a specific document from the index.
 */
export function removeDocument(tenantId: string, documentId: string): boolean {
  const docs = store.get(tenantId);
  if (!docs) return false;

  const idx = docs.findIndex((d) => d.id === documentId);
  if (idx >= 0) {
    docs.splice(idx, 1);
    return true;
  }
  return false;
}

/**
 * Clear the entire index for a tenant.
 */
export function clearIndex(tenantId: string): void {
  store.delete(tenantId);
  logger.info('Cleared knowledge index', { tenant_id: tenantId });
}

/**
 * Clear all tenant indexes. Useful for testing.
 */
export function clearAllIndexes(): void {
  store.clear();
  logger.info('Cleared all knowledge indexes');
}
