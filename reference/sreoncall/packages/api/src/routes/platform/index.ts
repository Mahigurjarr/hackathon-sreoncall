import { Router } from 'express';
import { platformAdminGuard } from '../../middleware/platformAdmin.middleware';
import tenantsRoutes from './tenants.routes';
import plansRoutes from './plans.routes';
import featureFlagsRoutes from './feature-flags.routes';
import configRoutes from './config.routes';
import statsRoutes from './stats.routes';
import auditLogRoutes from './audit-log.routes';
import providerLinksRoutes from './provider-links.routes';
import credentialsRoutes from './credentials.routes';
import breachReportsRoutes from './breach-reports.routes';
import activationCodesRoutes from './activation-codes.routes';
import leadsRoutes from './leads.routes';
import partnersRoutes from './partners.routes';
import dealsRoutes from './deals.routes';

const router = Router();

// All platform routes require platform_admin role
router.use(platformAdminGuard);

router.use('/tenants', tenantsRoutes);
router.use('/plans', plansRoutes);
router.use('/feature-flags', featureFlagsRoutes);
router.use('/config', configRoutes);
router.use('/stats', statsRoutes);
router.use('/audit-log', auditLogRoutes);
router.use('/provider-links', providerLinksRoutes);
router.use('/credentials', credentialsRoutes);
router.use('/breach-reports', breachReportsRoutes);
router.use('/activation-codes', activationCodesRoutes);
router.use('/leads', leadsRoutes);
router.use('/partners', partnersRoutes);
router.use('/deals', dealsRoutes);

export default router;
