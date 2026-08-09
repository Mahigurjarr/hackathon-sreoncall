import { Router, Request, Response } from 'express';
import * as statsService from '../../services/platform/stats.service';

const router = Router();

// GET /platform/stats
router.get('/', async (_req: Request, res: Response) => {
  const stats = await statsService.getSystemStats();
  res.json(stats);
});

export default router;
