import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { rbac } from '../middleware/rbac.middleware';
import { LogPipeline } from '../models/log-pipeline.model';
import { generateAlloyConfig } from '../services/log-pipeline-config.service';

const router = Router();

const ruleTypeEnum = z.enum(['json_parse', 'regex_extract', 'label_set', 'line_filter', 'drop', 'redact']);

const createRuleSchema = z.object({
  name: z.string().min(1).max(200),
  type: ruleTypeEnum,
  enabled: z.boolean().optional().default(true),
  config: z.record(z.unknown()).optional().default({}),
});

const updateRuleSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  type: ruleTypeEnum.optional(),
  enabled: z.boolean().optional(),
  config: z.record(z.unknown()).optional(),
});

const reorderSchema = z.object({
  ruleIds: z.array(z.string().min(1)),
});

const previewSchema = z.object({
  sampleLines: z.array(z.string()),
});

function serializeRule(rule: any) {
  return {
    id: rule._id?.toString() ?? rule.id,
    name: rule.name,
    order: rule.order,
    enabled: rule.enabled,
    type: rule.type,
    config: rule.config,
  };
}

// GET / — get pipeline rules for tenant
router.get('/', rbac('metrics:read'), async (req: Request, res: Response) => {
  const tenantId = (req as any).tenantId;
  const pipeline = await LogPipeline.findOne({ tenant_id: tenantId });
  const rules = pipeline?.rules ?? [];
  res.json({ data: rules.map(serializeRule) });
});

// POST /rules — add a rule
router.post('/rules', rbac('metrics:write'), async (req: Request, res: Response) => {
  const tenantId = (req as any).tenantId;
  const body = createRuleSchema.parse(req.body);

  const pipeline = await LogPipeline.findOne({ tenant_id: tenantId });
  const currentMaxOrder = pipeline?.rules?.length
    ? Math.max(...pipeline.rules.map(r => r.order))
    : -1;

  const newRule = {
    name: body.name,
    order: currentMaxOrder + 1,
    enabled: body.enabled,
    type: body.type,
    config: body.config,
  };

  const updated = await LogPipeline.findOneAndUpdate(
    { tenant_id: tenantId },
    { $push: { rules: newRule } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  const addedRule = updated.rules[updated.rules.length - 1];
  res.status(201).json({ data: serializeRule(addedRule) });
});

// PATCH /rules/:ruleId — update a rule
router.patch('/rules/:ruleId', rbac('metrics:write'), async (req: Request, res: Response) => {
  const tenantId = (req as any).tenantId;
  const { ruleId } = req.params;
  const body = updateRuleSchema.parse(req.body);

  const setFields: Record<string, unknown> = {};
  if (body.name !== undefined) setFields['rules.$.name'] = body.name;
  if (body.type !== undefined) setFields['rules.$.type'] = body.type;
  if (body.enabled !== undefined) setFields['rules.$.enabled'] = body.enabled;
  if (body.config !== undefined) setFields['rules.$.config'] = body.config;

  if (Object.keys(setFields).length === 0) {
    res.status(400).json({ error: 'No fields to update' });
    return;
  }

  const updated = await LogPipeline.findOneAndUpdate(
    { tenant_id: tenantId, 'rules._id': ruleId },
    { $set: setFields },
    { new: true },
  );

  if (!updated) {
    res.status(404).json({ error: 'Rule not found' });
    return;
  }

  const rule = updated.rules.find(r => r._id?.toString() === ruleId);
  res.json({ data: serializeRule(rule) });
});

// DELETE /rules/:ruleId — delete a rule
router.delete('/rules/:ruleId', rbac('metrics:write'), async (req: Request, res: Response) => {
  const tenantId = (req as any).tenantId;
  const { ruleId } = req.params;

  const updated = await LogPipeline.findOneAndUpdate(
    { tenant_id: tenantId },
    { $pull: { rules: { _id: ruleId } } },
    { new: true },
  );

  if (!updated) {
    res.status(404).json({ error: 'Pipeline not found' });
    return;
  }

  res.json({ data: (updated.rules ?? []).map(serializeRule) });
});

// POST /reorder — reorder rules
router.post('/reorder', rbac('metrics:write'), async (req: Request, res: Response) => {
  const tenantId = (req as any).tenantId;
  const { ruleIds } = reorderSchema.parse(req.body);

  const pipeline = await LogPipeline.findOne({ tenant_id: tenantId });
  if (!pipeline) {
    res.status(404).json({ error: 'Pipeline not found' });
    return;
  }

  // Reorder rules based on provided IDs
  for (let i = 0; i < ruleIds.length; i++) {
    const rule = pipeline.rules.find(r => r._id?.toString() === ruleIds[i]);
    if (rule) {
      (rule as any).order = i;
    }
  }

  await pipeline.save();
  res.json({ data: pipeline.rules.map(serializeRule) });
});

// GET /config — generate Alloy config snippet
router.get('/config', rbac('metrics:read'), async (req: Request, res: Response) => {
  const tenantId = (req as any).tenantId;
  const pipeline = await LogPipeline.findOne({ tenant_id: tenantId });
  const rules = pipeline?.rules ?? [];
  const config = generateAlloyConfig(rules as any);
  res.json({ data: config });
});

// POST /preview — preview pipeline on sample lines
router.post('/preview', rbac('metrics:read'), async (req: Request, res: Response) => {
  const tenantId = (req as any).tenantId;
  const { sampleLines } = previewSchema.parse(req.body);

  const pipeline = await LogPipeline.findOne({ tenant_id: tenantId });
  const rules = (pipeline?.rules ?? [])
    .filter(r => r.enabled)
    .sort((a, b) => a.order - b.order);

  // Simple preview: apply transforms to sample lines
  const output = sampleLines.map(line => {
    let result = line;
    for (const rule of rules) {
      switch (rule.type) {
        case 'json_parse': {
          try {
            const parsed = JSON.parse(result);
            result = JSON.stringify(parsed, null, 2);
          } catch {
            // Not valid JSON, pass through
          }
          break;
        }
        case 'regex_extract': {
          try {
            const re = new RegExp(rule.config.expression || '');
            const match = re.exec(result);
            if (match?.groups) {
              result = `${result} | extracted: ${JSON.stringify(match.groups)}`;
            }
          } catch {
            // Invalid regex, skip
          }
          break;
        }
        case 'line_filter': {
          try {
            const re = new RegExp(rule.config.match || '');
            if (rule.config.action === 'drop' && re.test(result)) {
              result = '[DROPPED]';
            }
          } catch {
            // Invalid regex, skip
          }
          break;
        }
        case 'drop': {
          try {
            const matchStr = rule.config.match || '';
            if (rule.config.match_type === 'contains') {
              if (result.includes(matchStr)) result = '[DROPPED]';
            } else {
              const re = new RegExp(matchStr);
              if (re.test(result)) result = '[DROPPED]';
            }
          } catch {
            // Invalid pattern, skip
          }
          break;
        }
        case 'redact': {
          try {
            const re = new RegExp(rule.config.pattern || '', 'g');
            result = result.replace(re, rule.config.replacement || '[REDACTED]');
          } catch {
            // Invalid regex, skip
          }
          break;
        }
        case 'label_set':
          // Label operations don't transform log lines
          break;
      }
    }
    return result;
  });

  res.json({ data: { input: sampleLines, output } });
});

export default router;
