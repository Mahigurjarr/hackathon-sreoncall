import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { rbac } from '../middleware/rbac.middleware';
import * as mcpProposalService from '../services/mcp-proposal.service';

const router = Router();

function serialize(p: any) {
  return {
    id: p._id.toString(),
    tool_name: p.tool_name,
    target_type: p.target_type,
    summary: p.summary,
    payload: p.payload,
    status: p.status,
    applied_entity_id: p.applied_entity_id?.toString() ?? null,
    apply_error: p.apply_error,
    reviewed_by: p.reviewed_by?.toString() ?? null,
    reviewed_at: p.reviewed_at?.toISOString?.() ?? p.reviewed_at,
    createdAt: p.createdAt?.toISOString?.() ?? p.createdAt,
  };
}

const listQuerySchema = z.object({
  status: z.enum(['pending', 'approved', 'rejected', 'applied', 'apply_failed']).optional(),
});

// GET /api/v1/mcp-proposals
router.get('/', rbac('mcp:read'), async (req: Request, res: Response) => {
  const { status } = listQuerySchema.parse(req.query);
  const proposals = await mcpProposalService.listProposals(req.tenantId, status);
  res.json({ data: proposals.map(serialize) });
});

// GET /api/v1/mcp-proposals/:id
router.get('/:id', rbac('mcp:read'), async (req: Request, res: Response) => {
  const proposal = await mcpProposalService.getProposal(req.tenantId, req.params['id'] as string);
  res.json(serialize(proposal));
});

// POST /api/v1/mcp-proposals/:id/approve
router.post('/:id/approve', rbac('mcp:manage'), async (req: Request, res: Response) => {
  const proposal = await mcpProposalService.approveProposal(req.tenantId, req.params['id'] as string, req.userId);
  res.json(serialize(proposal));
});

// POST /api/v1/mcp-proposals/:id/reject
router.post('/:id/reject', rbac('mcp:manage'), async (req: Request, res: Response) => {
  const proposal = await mcpProposalService.rejectProposal(req.tenantId, req.params['id'] as string, req.userId);
  res.json(serialize(proposal));
});

export default router;
