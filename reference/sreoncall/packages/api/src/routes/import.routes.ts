import { Router, Request, Response } from 'express';
import multer from 'multer';
import { parse } from 'csv-parse/sync';
import { v4 as uuidv4 } from 'uuid';
import { rbac } from '../middleware/rbac.middleware';
import * as ticketService from '../services/ticket.service';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// In-memory job store (sufficient for single-process)
const jobs = new Map<string, { status: string; created_count: number; errors: string[] }>();

const VALID_TYPES = new Set(['epic', 'user_story', 'task', 'bug']);
// Map various priority formats to high/medium/low
const PRIORITY_MAP: Record<string, string> = {
  high: 'high', medium: 'medium', low: 'low',
  P1: 'high', P2: 'high', P3: 'medium', P4: 'low', P5: 'low',
  '1': 'high', '2': 'high', '3': 'medium', '4': 'low', '5': 'low',
  critical: 'high', info: 'low',
};

// POST /api/v1/import/tickets
router.post('/tickets', rbac('tickets:create'), upload.single('file'), async (req: Request, res: Response) => {
  if (!req.file) {
    res.status(400).json({ detail: 'No file uploaded. Send the CSV as form-data field "file".' });
    return;
  }

  const jobId = uuidv4();
  jobs.set(jobId, { status: 'processing', created_count: 0, errors: [] });

  // Respond immediately with job ID so caller can poll
  res.status(202).json({ job_id: jobId, status: 'processing', created_count: 0, errors: [] });

  // Accept a default project_id from the form data
  const defaultProjectId = (req.body?.project_id as string) || '';

  // Process asynchronously
  setImmediate(async () => {
    const job = jobs.get(jobId)!;
    try {
      const content = req.file!.buffer.toString('utf-8');
      let records: Array<Record<string, string>>;
      try {
        records = parse(content, { columns: true, skip_empty_lines: true, trim: true });
      } catch (parseErr: any) {
        job.status = 'failed';
        job.errors.push(`CSV parse error: ${parseErr.message}`);
        return;
      }

      for (let i = 0; i < records.length; i++) {
        const row = records[i];
        try {
          if (!row.title?.trim()) {
            job.errors.push(`Row ${i + 2}: missing title`);
            continue;
          }
          const projectId = row.project_id?.trim() || defaultProjectId;
          if (!projectId) {
            job.errors.push(`Row ${i + 2}: missing project_id`);
            continue;
          }
          const type = VALID_TYPES.has(row.type?.toLowerCase()) ? row.type.toLowerCase() : 'task';
          const priorityKey = (row.priority || 'medium').trim();
          const priority = PRIORITY_MAP[priorityKey] ?? PRIORITY_MAP[priorityKey.toUpperCase()] ?? 'medium';
          await ticketService.createTicket({
            tenant_id: req.tenantId,
            reporter_id: req.userId,
            project_id: projectId,
            type,
            title: row.title.trim(),
            description: (row.description || '').trim(),
            priority,
            labels: row.labels ? row.labels.split(',').map((l) => l.trim()).filter(Boolean) : [],
          });
          job.created_count++;
        } catch (err: any) {
          job.errors.push(`Row ${i + 2}: ${err.message}`);
        }
      }
      job.status = 'completed';
    } catch (err: any) {
      job.status = 'failed';
      job.errors.push(`Unexpected error: ${err.message}`);
    }
  });
});

// GET /api/v1/import/:jobId
router.get('/:jobId', rbac('tickets:read'), (req: Request, res: Response) => {
  const jobId = req.params['jobId'] as string;
  const job = jobs.get(jobId);
  if (!job) {
    res.status(404).json({ detail: 'Job not found' });
    return;
  }
  res.json({ job_id: jobId, ...job });
});

export default router;
