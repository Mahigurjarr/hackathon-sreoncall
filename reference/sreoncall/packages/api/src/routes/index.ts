import { Router, Request, Response } from 'express';
import authRoutes from './auth.routes';
import ticketsRoutes from './tickets.routes';
import tenantsRoutes from './tenants.routes';
import usersRoutes from './users.routes';
import searchRoutes from './search.routes';
import ticketWorkflowsRoutes from './ticket-workflows.routes';
import slaConfigsRoutes from './sla-configs.routes';
import notificationRoutes from './notification.routes';
import dashboardRoutes from './dashboard.routes';
import auditLogRoutes from './audit-log.routes';
import apiKeysRoutes from './api-keys.routes';
import mcpProposalsRoutes from './mcp-proposals.routes';
import runbooksRoutes from './runbooks.routes';
import webhooksRoutes from './webhooks.routes';
import postmortemsRoutes from './postmortems.routes';
import statusPagesRoutes from './status-pages.routes';
import publicStatusPagesRoutes from './public/status-pages.routes';
import publicLeadsRoutes from './public/leads.routes';
import teamsRoutes from './teams.routes';
import channelsRoutes from './channels.routes';
import notetakerRoutes from './notetaker.routes';
import calendarRoutes from './calendar.routes';
import escalationPoliciesRoutes from './escalation-policies.routes';
import importRoutes from './import.routes';
import aiRoutes from './ai.routes';
import incidentsRoutes from './incidents.routes';
import alertsRoutes from './alerts.routes';
import changesRoutes from './changes.routes';
import oncallSchedulesRoutes from './oncall-schedules.routes';
import runbookExecutionsRoutes from './runbook-executions.routes';
import servicesRoutes from './services.routes';
import alertRulesRoutes from './alert-rules.routes';
import syntheticChecksRoutes from './synthetic-checks.routes';
import monitoringIntegrationsRoutes from './monitoring-integrations.routes';
import metricsRoutes from './metrics.routes';
import platformAdminRoutes from './platform-admin.routes';
import { createStorageAuthRoutes, createStoragePublicRoutes } from './storage.routes';
import { createBillingAuthRouter } from './billing.routes';
import projectsRoutes from './projects.routes';
import boardInvitesRoutes from './board-invites.routes';
import platformRoutes from './platform';
import providerRoutes from './provider.routes';
import providerObservabilityRoutes from './provider-observability.routes';
import consumerRoutes from './consumer.routes';
import bridgeRoutes from './bridge.routes';
import slosRoutes from './slos.routes';
import observabilityConnectionsRoutes from './observability-connections.routes';
import observabilityProxyRoutes from './observability-proxy.routes';
import observabilityDiscoveryRoutes from './observability-discovery.routes';
import providerObservabilityDiscoveryRoutes from './provider-observability-discovery.routes';
import observabilityLogsDiscoveryRoutes from './observability-logs-discovery.routes';
import providerObservabilityLogsDiscoveryRoutes from './provider-observability-logs-discovery.routes';
import observabilityMetricsDiscoveryRoutes from './observability-metrics-discovery.routes';
import providerObservabilityMetricsDiscoveryRoutes from './provider-observability-metrics-discovery.routes';
import featureFlagsRoutes from './feature-flags.routes';
import rumApplicationsRoutes from './rum-applications.routes';
import ingestionTokensRoutes from './ingestion-tokens.routes';
import dashboardsRoutes from './dashboards.routes';
import communicationChannelsRoutes from './communication-channels.routes';
import communicationsRoutes from './communications.routes';
import oauthCommsRoutes from './oauth-comms.routes';
import oauthCalendarRoutes from './oauth-calendar.routes';
import agentsRoutes from './agents.routes';
import providerAgentsRoutes from './provider-agents.routes';
import consumerAgentsRoutes from './consumer-agents.routes';
import platformAgentAdminRoutes from './platform-agent-admin.routes';
import scimTokensRoutes from './scim-tokens.routes';
import agentInstallRoutes from './agent-install.routes';
import ingestAuthRoutes from './ingest-auth.routes';
import snmpTrappersRoutes, { snmpTrapperHeartbeatRouter } from './snmp-trappers.routes';
import rollbarWebhookRoutes from './rollbar-webhook.routes';
import assetsRoutes from './assets.routes';
import milestonesRoutes from './milestones.routes';
import sprintsRoutes from './sprints.routes';
import reportsRoutes from './reports.routes';
import consentRoutes from './consent.routes';
import dsarRoutes from './dsar.routes';
import workLogSettingsRoutes from './work-log-settings.routes';
import aiConfigRoutes from './ai-config.routes';
import serviceDependenciesRoutes from './service-dependencies.routes';
import serviceMapRoutes from './service-map.routes';
import serviceTopologySettingsRoutes from './service-topology-settings.routes';
import alertQualityRoutes from './alert-quality.routes';
import incidentCorrelationsRoutes from './incident-correlations.routes';
import businessImpactConfigsRoutes from './business-impact-configs.routes';
import iccVisibilityRoutes from './icc-visibility.routes';
import validationSuitesRoutes from './validation-suites.routes';
import emergingRisksRoutes from './emerging-risks.routes';
import aiObservabilityRoutes from './ai-observability.routes';
import migrationsRoutes from './migrations.routes';
import logPipelinesRoutes from './log-pipelines.routes';
import herokuDrainRoutes from './heroku-drain.routes';
import vercelDrainRoutes from './vercel-drain.routes';
import supabaseDrainRoutes from './supabase-drain.routes';
import tenantObservabilityVerificationRoutes from './tenant-observability-verification.routes';
import publicPartnerApplicationsRoutes from './public/partner-applications.routes';
import publicPartnerRegisterRoutes from './public/partner-register.routes';
import publicPartnerTeamInviteRoutes from './public/partner-team-invite.routes';
import publicAlertRuleWebhooksRoutes from './public/alert-rule-webhooks.routes';
import publicExternalAlertIngestRoutes, { handleIngest as handleExternalAlertIngest } from './public/external-alert-ingest.routes';
import externalAlertSourcesRoutes from './external-alert-sources.routes';
import partnerAuthRoutes from './partner-auth.routes';
import partnerPortalRoutes from './partner';
import {
  providerSupportContractsRouter,
  providerSupportDashboardRouter,
  consumerSupportContractRouter,
  platformAdminSupportContractsRouter,
} from './support-contracts.routes';
import * as userService from '../services/user.service';
import * as onboardingService from '../services/onboarding.service';
import { requireFeatureFlag } from '../middleware/featureFlag.middleware';
import { requirePlanFeature } from '../middleware/planLimit.middleware';
import { z } from 'zod';
import mongoose from 'mongoose';

const acceptInviteSchema = z.object({
  invite_token: z.string().min(1),
  password: z.string().min(8).max(128),
  name: z.string().min(1).max(200).optional(),
});

export function createPublicRouter(): Router {
  const router = Router();
  router.use('/auth', authRoutes);
  router.use('/public/status-pages', publicStatusPagesRoutes);
  router.use('/public/leads', publicLeadsRoutes);
  router.use('/public/partner-applications', publicPartnerApplicationsRoutes);
  router.use('/public/partner-register', publicPartnerRegisterRoutes);
  router.use('/public/partner-team-invite', publicPartnerTeamInviteRoutes);
  router.use('/public/alert-rules/webhooks', publicAlertRuleWebhooksRoutes);
  router.post('/public/alerts/ingest', handleExternalAlertIngest);
  router.use('/public/alerts/ingest', publicExternalAlertIngestRoutes);
  router.use('/partner-auth', partnerAuthRoutes);
  router.use('/partner', partnerPortalRoutes);

  // Public avatar proxy (no auth — URLs contain unguessable UUIDs)
  router.use('/storage', createStoragePublicRoutes());

  // Slack OAuth (public callback)
  router.use('/oauth', oauthCommsRoutes);
  router.use('/oauth', oauthCalendarRoutes);

  // Agent install script (public, no auth)
  router.use('/agent', agentInstallRoutes);

  // Ingest token auth (called by nginx auth_request for ingest.sreoncall.com)
  router.use('/ingest', ingestAuthRoutes);

  // Heroku log drain (URL-token auth, not session-auth)
  router.use('/webhooks/heroku/logs', herokuDrainRoutes);

  // Vercel log drain (URL-token auth)
  router.use('/webhooks/vercel/logs', vercelDrainRoutes);

  // Supabase log drain (URL-token auth)
  router.use('/webhooks/supabase/logs', supabaseDrainRoutes);

  // SNMP Trapper heartbeat (token-auth, not session-auth)
  router.use('/snmp-trappers', snmpTrapperHeartbeatRouter);

  // Rollbar webhook (token-auth via X-Rollbar-Token header or ?token= query param)
  router.use('/webhooks/rollbar', rollbarWebhookRoutes);

  // Public user endpoints (no auth required)
  router.post('/users/accept-invite', async (req: Request, res: Response) => {
    const body = acceptInviteSchema.parse(req.body);
    const { user, org_slug } = await userService.acceptInvite(
      body.invite_token,
      body.password,
      body.name
    );
    res.json({
      id: user._id,
      email: user.email,
      name: user.name,
      roles: user.roles,
      status: user.status,
      org_slug,
    });
  });

  // Public tenant branding endpoint (for login page customization)
  router.get('/public/tenant-branding', async (req: Request, res: Response) => {
    const slug = (req.query.slug as string)?.trim();
    const domain = (req.query.domain as string)?.trim()?.toLowerCase();

    if (!slug && !domain) {
      res.status(400).json({ detail: 'Provide slug or domain query parameter.' });
      return;
    }

    try {
      const Tenant = mongoose.model('Tenant');
      let tenant: any = null;

      if (slug) {
        tenant = await Tenant.findOne({ slug, status: { $ne: 'deleted' } }).select('branding name slug plan_limits custom_domains').lean();
      }
      if (!tenant && domain) {
        tenant = await Tenant.findOne({ custom_domains: domain, status: { $ne: 'deleted' } }).select('branding name slug plan_limits custom_domains').lean();
      }

      if (!tenant) {
        res.json({ branding: null });
        return;
      }

      const whiteLabel = !!(tenant as any).plan_limits?.white_label_enabled;

      // Check if tenant has a public status page with show_on_login enabled
      const StatusPage = mongoose.model('StatusPage');
      let loginStatusPage: { slug: string; name: string } | null = null;
      try {
        const sp = await StatusPage.findOne({
          tenant_id: (tenant as any)._id,
          is_public: true,
          'settings.show_on_login': true,
        }).select('slug name').lean();
        if (sp) loginStatusPage = { slug: (sp as any).slug, name: (sp as any).name };
      } catch {}

      const customDomains = (tenant as any).custom_domains || [];
      res.json({
        branding: tenant.branding || null,
        tenant_name: tenant.name,
        tenant_slug: tenant.slug,
        white_label: whiteLabel,
        login_status_page: loginStatusPage,
        custom_domain: customDomains[0] || null,
      });
    } catch {
      res.json({ branding: null });
    }
  });

  // Public onboarding endpoints (no auth required)
  router.get('/public/onboarding/:token', async (req: Request, res: Response) => {
    const onboarding = await onboardingService.getOnboardingByToken(req.params.token as string);
    if (!onboarding) {
      res.status(404).json({ detail: 'Onboarding not found.' });
      return;
    }

    const expired = onboarding.token_expires_at && onboarding.token_expires_at < new Date();

    res.json({
      tenant_name: onboarding.tenant_name,
      tenant_slug: onboarding.tenant_slug,
      status: onboarding.status,
      expired: !!expired,
      assignee_email: onboarding.assignee_email,
    });
  });

  router.post('/public/onboarding/:token/submit', async (req: Request, res: Response) => {
    const formData = req.body?.form_data;
    if (!formData || typeof formData !== 'object') {
      res.status(400).json({ detail: 'form_data is required.' });
      return;
    }

    const onboarding = await onboardingService.submitOnboardingForm(
      req.params.token as string,
      formData,
    );

    res.json({
      status: onboarding.status,
      submitted_at: onboarding.submitted_at?.toISOString(),
    });
  });

  return router;
}

export function createAuthenticatedRouter(): Router {
  const router = Router();
  router.use('/tickets', ticketsRoutes);
  router.use('/tenants', tenantsRoutes);
  router.use('/users', usersRoutes);
  router.use('/search', searchRoutes);
  router.use('/ticket-workflows', ticketWorkflowsRoutes);
  router.use('/sla-configs', slaConfigsRoutes);
  router.use('/notifications', notificationRoutes);
  router.use('/dashboard', dashboardRoutes);
  router.use('/audit-logs', auditLogRoutes);
  router.use('/api-keys', apiKeysRoutes);
  router.use('/mcp-proposals', mcpProposalsRoutes);
  router.use('/runbooks', runbooksRoutes);
  router.use('/webhooks', webhooksRoutes);
  router.use('/postmortems', postmortemsRoutes);
  router.use('/status-pages', requireFeatureFlag('status_pages_enabled'), statusPagesRoutes);
  router.use('/teams', teamsRoutes);
  router.use('/channels', channelsRoutes);
  router.use('/notetaker', requirePlanFeature('ai_notetaker_enabled'), notetakerRoutes);
  router.use('/calendar', requirePlanFeature('ai_notetaker_enabled'), calendarRoutes);
  router.use('/escalation-policies', escalationPoliciesRoutes);
  router.use('/import', importRoutes);
  router.use('/ai', aiRoutes);
  router.use('/incidents', incidentsRoutes);
  router.use('/alerts', alertsRoutes);
  router.use('/changes', changesRoutes);
  router.use('/oncall-schedules', oncallSchedulesRoutes);
  router.use('/runbook-executions', requireFeatureFlag('runbook_automation_enabled'), runbookExecutionsRoutes);
  router.use('/services', servicesRoutes);
  router.use('/alert-rules', alertRulesRoutes);
  router.use('/external-alert-sources', externalAlertSourcesRoutes);
  router.use('/synthetic-checks', requireFeatureFlag('synthetic_monitoring_enabled'), syntheticChecksRoutes);
  router.use('/monitoring-integrations', monitoringIntegrationsRoutes);
  router.use('/metrics', metricsRoutes);
  router.use('/platform-admin', platformAdminRoutes);
  router.use('/storage', createStorageAuthRoutes());
  router.use('/billing', createBillingAuthRouter());
  router.use('/projects', projectsRoutes);
  router.use('/', boardInvitesRoutes);
  router.use('/platform', platformRoutes);
  router.use('/provider', providerRoutes);
  router.use('/provider/observability/discovery', requireFeatureFlag('observability_discovery_enabled'), providerObservabilityDiscoveryRoutes);
  router.use('/provider/observability/logs-discovery', requireFeatureFlag('observability_discovery_enabled'), providerObservabilityLogsDiscoveryRoutes);
  router.use('/provider/observability/metrics-discovery', requireFeatureFlag('observability_discovery_enabled'), providerObservabilityMetricsDiscoveryRoutes);
  router.use('/provider/observability', requireFeatureFlag('observability_enabled'), providerObservabilityRoutes);
  router.use('/consumer', consumerRoutes);
  router.use('/bridges', bridgeRoutes);
  router.use('/slos', slosRoutes);
  router.use('/observability-connections', requireFeatureFlag('observability_enabled'), observabilityConnectionsRoutes);
  router.use('/observability/discovery', requireFeatureFlag('observability_discovery_enabled'), observabilityDiscoveryRoutes);
  router.use('/observability/logs-discovery', requireFeatureFlag('observability_discovery_enabled'), observabilityLogsDiscoveryRoutes);
  router.use('/observability/metrics-discovery', requireFeatureFlag('observability_discovery_enabled'), observabilityMetricsDiscoveryRoutes);
  router.use('/observability', requireFeatureFlag('observability_enabled'), observabilityProxyRoutes);
  router.use('/feature-flags', featureFlagsRoutes);
  router.use('/rum-applications', requireFeatureFlag('observability_enabled'), rumApplicationsRoutes);
  router.use('/tenant-observability-verification', requireFeatureFlag('observability_enabled'), tenantObservabilityVerificationRoutes);
  router.use('/ingestion-tokens', requireFeatureFlag('observability_enabled'), ingestionTokensRoutes);
  router.use('/observability/ai', requireFeatureFlag('observability_enabled'), aiObservabilityRoutes);
  router.use('/dashboards', dashboardsRoutes);
  router.use('/consumer/channels', communicationChannelsRoutes);
  router.use('/provider/communications', communicationsRoutes);
  router.use('/agents', requireFeatureFlag('ai_agents_enabled'), agentsRoutes);
  router.use('/provider/agents', requireFeatureFlag('ai_agents_enabled'), providerAgentsRoutes);
  router.use('/consumer/agents', requireFeatureFlag('ai_agents_enabled'), consumerAgentsRoutes);
  router.use('/platform-admin/agents', platformAgentAdminRoutes);
  router.use('/scim-tokens', requireFeatureFlag('scim_provisioning_enabled'), scimTokensRoutes);
  router.use('/assets', assetsRoutes);
  router.use('/milestones', milestonesRoutes);
  router.use('/sprints', sprintsRoutes);
  router.use('/reports', reportsRoutes);
  router.use('/consent', consentRoutes);
  router.use('/dsar', dsarRoutes);
  router.use('/snmp-trappers', snmpTrappersRoutes);
  router.use('/work-log-settings', workLogSettingsRoutes);
  router.use('/settings/ai-config', aiConfigRoutes);
  router.use('/service-dependencies', requirePlanFeature('icc_enabled'), serviceDependenciesRoutes);
  router.use('/service-map', requirePlanFeature('icc_enabled'), serviceMapRoutes);
  router.use('/service-topology-settings', serviceTopologySettingsRoutes);
  router.use('/alert-quality', requirePlanFeature('icc_enabled'), alertQualityRoutes);
  router.use('/incident-correlations', requirePlanFeature('icc_enabled'), incidentCorrelationsRoutes);
  router.use('/business-impact-configs', requirePlanFeature('icc_enabled'), businessImpactConfigsRoutes);
  router.use('/icc-visibility', requirePlanFeature('icc_enabled'), iccVisibilityRoutes);
  router.use('/validation-suites', requirePlanFeature('icc_enabled'), validationSuitesRoutes);
  router.use('/emerging-risks', requirePlanFeature('icc_enabled'), emergingRisksRoutes);
  router.use('/migrations', migrationsRoutes);
  router.use('/log-pipelines', requireFeatureFlag('observability_enabled'), logPipelinesRoutes);
  router.use('/provider/support-contracts', providerSupportContractsRouter);
  router.use('/provider/support-dashboard', providerSupportDashboardRouter);
  router.use('/consumer/support-contract', consumerSupportContractRouter);
  router.use('/platform-admin/support-contracts', platformAdminSupportContractsRouter);
  return router;
}
