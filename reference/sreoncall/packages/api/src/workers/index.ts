import { startSearchWorker, stopSearchWorker } from './search.worker';
import { startNotificationWorker, stopNotificationWorker } from './notification.worker';
import { startSyntheticCheckWorker, stopSyntheticCheckWorker } from './synthetic-check.worker';
import { startAlertRuleWorker, stopAlertRuleWorker } from './alert-rule.worker';
import { startEscalationWorker, stopEscalationWorker } from './escalation.worker';
import { startSlaTimerWorker, stopSlaTimerWorker } from './sla-timer.worker';
import { startBridgeWorker, stopBridgeWorker } from './bridge.worker';
import { startCommunicationWorker, stopCommunicationWorker } from './communication.worker';
import { startAgentWorker, stopAgentWorker } from './agent.worker';
import { startWebhookDeliveryWorker, stopWebhookDeliveryWorker } from './webhook-delivery.worker';
import { startOutboundMessageWorker, stopOutboundMessageWorker } from './outbound-message.worker';
import { startAssetDiscoveryWorker, stopAssetDiscoveryWorker } from './asset-discovery.worker';
import { startSupabaseLogsPollerWorker, stopSupabaseLogsPollerWorker } from './supabase-logs-poller.worker';
import { startHerokuActivityPollerWorker, stopHerokuActivityPollerWorker } from './heroku-activity-poller.worker';
import { startDsarWorker, stopDsarWorker } from './dsar.worker';
import { startSloWorker, stopSloWorker } from './slo.worker';
import { startActionItemReminderWorker, stopActionItemReminderWorker } from './action-item-reminder.worker';
import { startStatusPageNotificationWorker, stopStatusPageNotificationWorker } from './status-page-notification.worker';
import { startStatusPageDigestWorker, stopStatusPageDigestWorker } from './status-page-digest.worker';
import { startWorkLogDigestWorker, stopWorkLogDigestWorker } from './work-log-digest.worker';
import { startResolutionWorker, stopResolutionWorker } from './resolution.worker';
import { startDependencyDiscoveryWorker, stopDependencyDiscoveryWorker } from './dependency-discovery.worker';
import { startDependencyDiscoveryScheduler, stopDependencyDiscoveryScheduler } from './dependency-discovery-scheduler.worker';
import { startStatusCascadeWorker, stopStatusCascadeWorker } from './status-cascade.worker';
import { startIncidentCorrelatorWorker, stopIncidentCorrelatorWorker } from './incident-correlator.worker';
import { startAlertQualityWorker, stopAlertQualityWorker } from './alert-quality.worker';
import { startStakeholderCommsWorker, stopStakeholderCommsWorker } from './stakeholder-comms.worker';
import { startToilTrackerWorker, stopToilTrackerWorker } from './toil-tracker.worker';
import { startPredictiveWorker, stopPredictiveWorker } from './predictive.worker';
import { startCredentialRotationWorker, stopCredentialRotationWorker } from './credential-rotation.worker';
import { startSecurityMonitoringWorker, stopSecurityMonitoringWorker } from './security-monitoring.worker';
import { startExternalAlertStaleWorker, stopExternalAlertStaleWorker } from './external-alert-stale.worker';
import { startNotetakerWorker, stopNotetakerWorker } from './notetaker.worker';
import { logger } from '../utils/logger';

export async function startWorkers(): Promise<void> {
  logger.info('Starting workers...');

  try {
    await startSearchWorker();
    logger.info('Search worker started');
  } catch (err: any) {
    logger.warn('Failed to start search worker', { error: err.message });
  }

  try {
    await startNotificationWorker();
    logger.info('Notification worker started');
  } catch (err: any) {
    logger.warn('Failed to start notification worker', { error: err.message });
  }

  try {
    startSyntheticCheckWorker();
    logger.info('Synthetic check worker started');
  } catch (err: any) {
    logger.warn('Failed to start synthetic check worker', { error: err.message });
  }

  try {
    startAlertRuleWorker();
    logger.info('Alert rule worker started');
  } catch (err: any) {
    logger.warn('Failed to start alert rule worker', { error: err.message });
  }

  try {
    startEscalationWorker();
    logger.info('Escalation worker started');
  } catch (err: any) {
    logger.warn('Failed to start escalation worker', { error: err.message });
  }

  try {
    startSlaTimerWorker();
    logger.info('SLA timer worker started');
  } catch (err: any) {
    logger.warn('Failed to start SLA timer worker', { error: err.message });
  }

  try {
    await startBridgeWorker();
    logger.info('Bridge worker started');
  } catch (err: any) {
    logger.warn('Failed to start bridge worker', { error: err.message });
  }

  try {
    await startCommunicationWorker();
    logger.info('Communication worker started');
  } catch (err: any) {
    logger.warn('Failed to start communication worker', { error: err.message });
  }

  try {
    await startAgentWorker();
    logger.info('Agent worker started');
  } catch (err: any) {
    logger.warn('Failed to start agent worker', { error: err.message });
  }

  try {
    await startWebhookDeliveryWorker();
    logger.info('Webhook delivery worker started');
  } catch (err: any) {
    logger.warn('Failed to start webhook delivery worker', { error: err.message });
  }

  try {
    await startOutboundMessageWorker();
    logger.info('Outbound message worker started');
  } catch (err: any) {
    logger.warn('Failed to start outbound message worker', { error: err.message });
  }

  try {
    startAssetDiscoveryWorker();
    logger.info('Asset discovery worker started');
  } catch (err: any) {
    logger.warn('Failed to start asset discovery worker', { error: err.message });
  }

  try {
    startSupabaseLogsPollerWorker();
    logger.info('Supabase logs poller started');
  } catch (err: any) {
    logger.warn('Failed to start Supabase logs poller', { error: err.message });
  }

  try {
    startHerokuActivityPollerWorker();
    logger.info('Heroku activity poller started');
  } catch (err: any) {
    logger.warn('Failed to start Heroku activity poller', { error: err.message });
  }

  try {
    await startDsarWorker();
    logger.info('DSAR worker started');
  } catch (err: any) {
    logger.warn('Failed to start DSAR worker', { error: err.message });
  }

  try {
    startSloWorker();
    logger.info('SLO evaluation worker started');
  } catch (err: any) {
    logger.warn('Failed to start SLO evaluation worker', { error: err.message });
  }

  try {
    startActionItemReminderWorker();
    logger.info('Action item reminder worker started');
  } catch (err: any) {
    logger.warn('Failed to start action item reminder worker', { error: err.message });
  }

  try {
    await startStatusPageNotificationWorker();
    logger.info('Status page notification worker started');
  } catch (err: any) {
    logger.warn('Failed to start status page notification worker', { error: err.message });
  }

  try {
    startStatusPageDigestWorker();
    logger.info('Status page digest worker started');
  } catch (err: any) {
    logger.warn('Failed to start status page digest worker', { error: err.message });
  }

  try {
    startWorkLogDigestWorker();
    logger.info('Work log digest worker started');
  } catch (err: any) {
    logger.warn('Failed to start work log digest worker', { error: err.message });
  }

  // --- ICC Workers ---

  try {
    await startResolutionWorker();
    logger.info('Resolution worker started');
  } catch (err: any) {
    logger.warn('Failed to start resolution worker', { error: err.message });
  }

  try {
    await startDependencyDiscoveryWorker();
    logger.info('Dependency discovery worker started');
  } catch (err: any) {
    logger.warn('Failed to start dependency discovery worker', { error: err.message });
  }

  try {
    startDependencyDiscoveryScheduler();
    logger.info('Dependency discovery scheduler started');
  } catch (err: any) {
    logger.warn('Failed to start dependency discovery scheduler', { error: err.message });
  }

  try {
    await startStatusCascadeWorker();
    logger.info('Status cascade worker started');
  } catch (err: any) {
    logger.warn('Failed to start status cascade worker', { error: err.message });
  }

  try {
    await startIncidentCorrelatorWorker();
    logger.info('Incident correlator worker started');
  } catch (err: any) {
    logger.warn('Failed to start incident correlator worker', { error: err.message });
  }

  try {
    await startAlertQualityWorker();
    logger.info('Alert quality worker started');
  } catch (err: any) {
    logger.warn('Failed to start alert quality worker', { error: err.message });
  }

  try {
    await startStakeholderCommsWorker();
    logger.info('Stakeholder comms worker started');
  } catch (err: any) {
    logger.warn('Failed to start stakeholder comms worker', { error: err.message });
  }

  try {
    await startToilTrackerWorker();
    logger.info('Toil tracker worker started');
  } catch (err: any) {
    logger.warn('Failed to start toil tracker worker', { error: err.message });
  }

  try {
    await startPredictiveWorker();
    logger.info('Predictive worker started');
  } catch (err: any) {
    logger.warn('Failed to start predictive worker', { error: err.message });
  }

  try {
    await startCredentialRotationWorker();
    logger.info('Credential rotation worker started');
  } catch (err: any) {
    logger.warn('Failed to start credential rotation worker', { error: err.message });
  }

  try {
    startSecurityMonitoringWorker();
    logger.info('Security monitoring worker started');
  } catch (err: any) {
    logger.warn('Failed to start security monitoring worker', { error: err.message });
  }

  try {
    startExternalAlertStaleWorker();
    logger.info('External alert stale-detection worker started');
  } catch (err: any) {
    logger.warn('Failed to start external alert stale-detection worker', { error: err.message });
  }

  try {
    await startNotetakerWorker();
    logger.info('Notetaker worker started');
  } catch (err: any) {
    logger.warn('Failed to start notetaker worker', { error: err.message });
  }

  logger.info('All workers started');
}

export async function stopWorkers(): Promise<void> {
  logger.info('Stopping workers...');
  await stopSearchWorker();
  await stopNotificationWorker();
  stopSyntheticCheckWorker();
  stopAlertRuleWorker();
  stopEscalationWorker();
  stopSlaTimerWorker();
  await stopBridgeWorker();
  await stopCommunicationWorker();
  await stopAgentWorker();
  await stopWebhookDeliveryWorker();
  await stopOutboundMessageWorker();
  stopAssetDiscoveryWorker();
  stopSupabaseLogsPollerWorker();
  stopHerokuActivityPollerWorker();
  await stopDsarWorker();
  stopSloWorker();
  stopActionItemReminderWorker();
  await stopStatusPageNotificationWorker();
  stopStatusPageDigestWorker();
  stopWorkLogDigestWorker();
  await stopResolutionWorker();
  await stopDependencyDiscoveryWorker();
  stopDependencyDiscoveryScheduler();
  await stopStatusCascadeWorker();
  await stopIncidentCorrelatorWorker();
  await stopAlertQualityWorker();
  await stopStakeholderCommsWorker();
  await stopToilTrackerWorker();
  await stopPredictiveWorker();
  await stopCredentialRotationWorker();
  stopSecurityMonitoringWorker();
  stopExternalAlertStaleWorker();
  await stopNotetakerWorker();
  logger.info('All workers stopped');
}
