import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { AlertRule } from '../../models/alert-rule.model';
import { handleRuleFiring, handleRuleResolved } from '../../services/alert-rule-runtime.service';

const router = Router();

const ingestSchema = z.object({
  status: z.enum(['firing', 'resolved', 'ok']).optional().default('firing'),
  value: z.number().optional().default(1),
  labels: z.record(z.string()).optional().default({}),
  message: z.string().max(2000).optional(),
});

router.post('/:id/:secret', async (req: Request, res: Response) => {
  const body = ingestSchema.parse(req.body);
  const rule = await AlertRule.findOne({
    _id: req.params['id'],
    source_type: 'byos_webhook',
    webhook_secret: req.params['secret'],
  });

  if (!rule) {
    res.status(404).json({ detail: 'Webhook alert rule not found' });
    return;
  }

  if (rule.status !== 'active') {
    res.status(409).json({ detail: 'Alert rule is inactive' });
    return;
  }

  if (body.status === 'firing') {
    await handleRuleFiring(rule as any, body.value, body.labels, body.message);
  } else {
    await handleRuleResolved(rule as any, body.value, body.message);
  }

  res.status(202).json({
    accepted: true,
    rule_id: rule._id.toString(),
    state: body.status === 'firing' ? 'firing' : 'ok',
  });
});

router.get('/:id/:secret/test', async (req: Request, res: Response) => {
  const rule = await AlertRule.findOne({
    _id: req.params['id'],
    source_type: 'byos_webhook',
    webhook_secret: req.params['secret'],
  }).lean();

  if (!rule) {
    res.status(404).json({ detail: 'Webhook alert rule not found' });
    return;
  }

  res.json({
    status: 'ok',
    rule_id: (rule as any)._id.toString(),
    rule_name: (rule as any).name,
  });
});

export default router;
