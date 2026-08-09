import { Router, Request, Response, NextFunction } from 'express';
import { getAllEffectiveValues } from '../services/platform/feature-flag.service';

const router = Router();

// Any authenticated tenant user can read their own effective flags (read-only).
router.get('/effective', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const flags = await getAllEffectiveValues(String(req.tenantId));
    res.json({ flags });
  } catch (err) {
    next(err);
  }
});

export default router;
