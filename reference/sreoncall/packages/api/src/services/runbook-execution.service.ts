import { Types } from 'mongoose';
import { RunbookExecution, RunbookExecutionDocument, ExecutionStepState } from '../models/runbook-execution.model';
import * as runbookService from './runbook.service';
import { AppError } from '../middleware/errorHandler.middleware';
import { assertUrlSafe } from '../utils/ssrf-guard';

// ─── Step simulation ──────────────────────────────────────────────────────────

async function executeStep(type: string, instructions: string): Promise<{ output: string; success: boolean }> {
  const firstLine = (instructions || '').split('\n')[0] || '(no command)';

  if (type === 'bash_script') {
    // bash_script execution is intentionally not supported in the API process
    // for security. Return a clear simulation marker so users know it's not real.
    return {
      output: [
        `$ ${firstLine}`,
        '[SIMULATION] Bash execution from the API process is disabled for security.',
        '[SIMULATION] Use a runbook agent (coming soon) to execute shell commands.',
      ].join('\n'),
      success: true,
    };
  }

  if (type === 'api_call') {
    // Parse the instructions for an HTTP request and actually call it.
    // Supports two formats:
    //   1. A bare URL (or "METHOD URL")
    //   2. A curl command (extract URL, method, headers, body)
    try {
      const parsed = parseHttpRequest(instructions);
      if (!parsed) {
        return {
          output: 'No valid HTTP request found in instructions. Provide a URL or curl command.',
          success: false,
        };
      }

      // SSRF guard — block private/loopback IPs unless explicitly safe
      try {
        await assertUrlSafe(parsed.url);
      } catch (err: any) {
        return {
          output: `Request blocked by security policy: ${err.message || 'unsafe URL'}`,
          success: false,
        };
      }

      const startMs = Date.now();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30_000);
      let resp: Response;
      try {
        resp = await fetch(parsed.url, {
          method: parsed.method,
          headers: parsed.headers,
          body: parsed.body,
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }

      const elapsedMs = Date.now() - startMs;
      let body = '';
      try {
        body = (await resp.text()).slice(0, 4000);
      } catch {
        body = '(failed to read response body)';
      }

      const headerLines: string[] = [];
      resp.headers.forEach((v, k) => headerLines.push(`${k}: ${v}`));

      return {
        output: [
          `${parsed.method} ${parsed.url}`,
          `HTTP/1.1 ${resp.status} ${resp.statusText}`,
          ...headerLines,
          '',
          body,
          '',
          `[elapsed] ${elapsedMs}ms`,
        ].join('\n'),
        // 2xx and 3xx are success; 4xx/5xx are failure
        success: resp.status >= 200 && resp.status < 400,
      };
    } catch (err: any) {
      return {
        output: `Request failed: ${err.message || String(err)}`,
        success: false,
      };
    }
  }

  if (type === 'ansible_playbook') {
    return {
      output: [
        '[SIMULATION] Ansible playbook execution from the API process is disabled.',
        '[SIMULATION] Use a runbook agent (coming soon) to run playbooks.',
        '',
        `Playbook: ${firstLine}`,
      ].join('\n'),
      success: true,
    };
  }

  return { output: '', success: true };
}

/**
 * Parse user instructions for an HTTP request.
 * Supports:
 *   - Bare URL: "https://api.example.com/health"
 *   - METHOD URL: "GET https://api.example.com/health"
 *   - curl command: "curl -X POST https://... -H '...' -d '...'"
 */
function parseHttpRequest(instructions: string): { method: string; url: string; headers: Record<string, string>; body?: string } | null {
  const text = (instructions || '').trim();
  if (!text) return null;

  // curl format
  if (text.toLowerCase().startsWith('curl')) {
    // Extract method (-X POST or --request POST)
    const methodMatch = text.match(/-X\s+([A-Z]+)|--request\s+([A-Z]+)/);
    const method = (methodMatch?.[1] || methodMatch?.[2] || 'GET').toUpperCase();

    // Extract URL — first http(s):// occurrence (allow quoted)
    const urlMatch = text.match(/(?:'|")?(https?:\/\/[^\s'"]+)(?:'|")?/);
    if (!urlMatch) return null;
    const url = urlMatch[1];

    // Extract headers (-H 'key: val' or --header 'key: val')
    const headers: Record<string, string> = {};
    const headerRegex = /(?:-H|--header)\s+['"]([^'"]+):\s*([^'"]+)['"]/g;
    let m: RegExpExecArray | null;
    while ((m = headerRegex.exec(text)) !== null) {
      headers[m[1].trim()] = m[2].trim();
    }

    // Extract body (-d, --data, --data-raw)
    const bodyMatch = text.match(/(?:-d|--data(?:-raw)?)\s+['"]([^'"]+)['"]/);
    const body = bodyMatch?.[1];

    return { method, url, headers, body };
  }

  // METHOD URL format
  const methodUrlMatch = text.match(/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(https?:\/\/\S+)/i);
  if (methodUrlMatch) {
    return { method: methodUrlMatch[1].toUpperCase(), url: methodUrlMatch[2], headers: {} };
  }

  // Bare URL
  if (/^https?:\/\//i.test(text)) {
    const firstWhitespace = text.search(/\s/);
    const url = firstWhitespace > 0 ? text.slice(0, firstWhitespace) : text;
    return { method: 'GET', url, headers: {} };
  }

  return null;
}

// ─── Execution engine helpers ─────────────────────────────────────────────────

function addLog(
  exec: RunbookExecutionDocument,
  message: string,
  level: 'info' | 'warn' | 'error' = 'info',
) {
  exec.output_log.push({ timestamp: new Date(), level, message });
}

/**
 * Runs an automated step. For api_call, this actually performs the HTTP request
 * and reports the real status. For bash/ansible, returns a simulation marker.
 * Mutates `stepState` in place.
 */
async function runAutomatedStep(stepState: ExecutionStepState, exec: RunbookExecutionDocument): Promise<boolean> {
  const startMs = Date.now();
  stepState.started_at = new Date();
  stepState.status = 'running';

  const { output, success } = await executeStep(stepState.type, stepState.instructions);

  stepState.completed_at = new Date();
  stepState.duration_ms  = Date.now() - startMs;
  stepState.output       = output;

  if (success) {
    stepState.status = 'completed';
    addLog(exec, `Step ${stepState.order + 1} "${stepState.title}" (${stepState.type}) completed.`);
  } else {
    stepState.status = 'failed';
    stepState.error  = 'Step failed during execution.';
    addLog(exec, `Step ${stepState.order + 1} "${stepState.title}" FAILED.`, 'error');
  }

  return success;
}

/**
 * Advance the execution to the given step index.
 * Returns the new execution status after advancing.
 */
async function advanceToStep(
  exec: RunbookExecutionDocument,
  stepIdx: number,
): Promise<void> {
  if (stepIdx >= exec.steps_state.length) {
    // All steps done → complete
    exec.status       = 'completed';
    exec.completed_at = new Date();
    exec.duration_ms  = Date.now() - exec.started_at.getTime();
    addLog(exec, 'All steps completed. Execution finished successfully.');

    // Update runbook stats (fire-and-forget)
    runbookService
      .updateStats(exec.tenant_id.toString(), exec.runbook_id.toString(), true, exec.duration_ms)
      .catch(() => {});
    return;
  }

  exec.current_step = stepIdx;
  const step = exec.steps_state[stepIdx]!;

  if (step.requires_approval) {
    // Pause for approval before running
    step.status  = 'awaiting_approval';
    exec.status  = 'paused_approval';
    addLog(exec, `Step ${step.order + 1} "${step.title}" requires approval before execution.`, 'warn');
    return;
  }

  if (step.type === 'manual') {
    // Mark as running, wait for operator to complete
    step.status    = 'running';
    step.started_at = new Date();
    exec.status    = 'running';
    addLog(exec, `Step ${step.order + 1} "${step.title}" (manual) — waiting for operator completion.`);
    return;
  }

  // Automated step: run immediately then keep advancing
  const ok = await runAutomatedStep(step, exec);
  if (!ok) {
    exec.status       = 'failed';
    exec.completed_at = new Date();
    exec.duration_ms  = Date.now() - exec.started_at.getTime();
    runbookService
      .updateStats(exec.tenant_id.toString(), exec.runbook_id.toString(), false, exec.duration_ms)
      .catch(() => {});
    return;
  }

  // Recurse to next step
  await advanceToStep(exec, stepIdx + 1);
}

// ─── Public service functions ─────────────────────────────────────────────────

export async function listExecutions(
  tenantId: string,
  opts: { runbook_id?: string; status?: string; limit?: number },
) {
  const filter: Record<string, unknown> = { tenant_id: new Types.ObjectId(tenantId) };
  if (opts.runbook_id) filter['runbook_id'] = new Types.ObjectId(opts.runbook_id);
  if (opts.status)     filter['status']     = opts.status;

  return RunbookExecution.find(filter)
    .sort({ createdAt: -1 })
    .limit(opts.limit ?? 50)
    .lean();
}

export async function getExecutionById(tenantId: string, id: string) {
  const exec = await RunbookExecution.findOne({
    _id: new Types.ObjectId(id),
    tenant_id: new Types.ObjectId(tenantId),
  });
  if (!exec) throw AppError.notFound('Execution not found');
  return exec;
}

export async function startExecution(
  tenantId: string,
  runbookId: string,
  triggeredBy: string,
  opts: {
    variables?: Record<string, string>;
    incident_id?: string | null;
  } = {},
): Promise<RunbookExecutionDocument> {
  const runbook = await runbookService.getRunbookById(tenantId, runbookId);

  if (runbook.steps.length === 0) {
    throw AppError.badRequest('Cannot execute a runbook with no steps');
  }

  const stepsState: Partial<ExecutionStepState>[] = runbook.steps
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((s) => ({
      step_id:           s._id.toString(),
      order:             s.order,
      title:             s.title,
      type:              s.type,
      requires_approval: s.requires_approval,
      instructions:      s.instructions,
      status:            'pending' as const,
      started_at:        null,
      completed_at:      null,
      duration_ms:       null,
      output:            '',
      error:             null,
      approved_by:       null,
      approved_at:       null,
      approval_comment:  null,
    }));

  const exec = await RunbookExecution.create({
    tenant_id:               new Types.ObjectId(tenantId),
    runbook_id:              new Types.ObjectId(runbookId),
    runbook_version:         runbook.version,
    runbook_title:           runbook.title,
    status:                  'running',
    triggered_by:            new Types.ObjectId(triggeredBy),
    triggered_by_incident_id:opts.incident_id ? new Types.ObjectId(opts.incident_id) : null,
    current_step:            0,
    steps_state:             stepsState,
    variables:               opts.variables ?? {},
    started_at:              new Date(),
    output_log:              [{ timestamp: new Date(), level: 'info', message: `Execution started by user ${triggeredBy}` }],
  });

  // Advance to step 0
  await advanceToStep(exec, 0);
  await exec.save();

  return exec;
}

export async function completeManualStep(
  tenantId: string,
  executionId: string,
  stepIdx: number,
  opts: { output?: string; operator_id: string },
): Promise<RunbookExecutionDocument> {
  const exec = await getExecutionById(tenantId, executionId);

  if (exec.status === 'completed' || exec.status === 'cancelled' || exec.status === 'failed') {
    throw AppError.badRequest(`Execution is already ${exec.status}`);
  }

  if (exec.current_step !== stepIdx) {
    throw AppError.badRequest(`Step ${stepIdx} is not the current step (current: ${exec.current_step})`);
  }

  const step = exec.steps_state[stepIdx];
  if (!step) throw AppError.notFound('Step not found');
  if (step.type !== 'manual') throw AppError.badRequest('Only manual steps can be manually completed');
  if (step.status !== 'running') throw AppError.badRequest(`Step status is "${step.status}", expected "running"`);

  step.status       = 'completed';
  step.completed_at = new Date();
  step.duration_ms  = step.started_at
    ? Date.now() - step.started_at.getTime()
    : null;
  step.output       = opts.output || 'Step completed by operator.';
  addLog(exec, `Step ${step.order + 1} "${step.title}" completed by operator ${opts.operator_id}.`);

  await advanceToStep(exec, stepIdx + 1);
  await exec.save();
  return exec;
}

export async function approveStep(
  tenantId: string,
  executionId: string,
  stepIdx: number,
  opts: { user_id: string; decision: 'approved' | 'rejected'; comment?: string },
): Promise<RunbookExecutionDocument> {
  const exec = await getExecutionById(tenantId, executionId);

  if (exec.status !== 'paused_approval') {
    throw AppError.badRequest('Execution is not awaiting approval');
  }
  if (exec.current_step !== stepIdx) {
    throw AppError.badRequest(`Step ${stepIdx} is not the current step`);
  }

  const step = exec.steps_state[stepIdx];
  if (!step) throw AppError.notFound('Step not found');
  if (step.status !== 'awaiting_approval') {
    throw AppError.badRequest('Step is not awaiting approval');
  }

  step.approved_by      = new Types.ObjectId(opts.user_id) as any;
  step.approved_at      = new Date();
  step.approval_comment = opts.comment || null;

  if (opts.decision === 'rejected') {
    step.status  = 'failed';
    step.error   = `Rejected by user ${opts.user_id}: ${opts.comment || '(no comment)'}`;
    exec.status  = 'failed';
    exec.completed_at = new Date();
    exec.duration_ms  = Date.now() - exec.started_at.getTime();
    addLog(exec, `Step ${step.order + 1} REJECTED by user ${opts.user_id}.`, 'error');
    runbookService
      .updateStats(tenantId, exec.runbook_id.toString(), false, exec.duration_ms)
      .catch(() => {});
    await exec.save();
    return exec;
  }

  // Approved: now actually run the step
  addLog(exec, `Step ${step.order + 1} approved by user ${opts.user_id}. Proceeding.`);
  exec.status = 'running';

  if (step.type === 'manual') {
    step.status     = 'running';
    step.started_at = new Date();
    // Wait for operator to complete manually
  } else {
    await runAutomatedStep(step, exec);
    if ((step.status as string) === 'failed') {
      exec.status       = 'failed';
      exec.completed_at = new Date();
      exec.duration_ms  = Date.now() - exec.started_at.getTime();
      runbookService
        .updateStats(tenantId, exec.runbook_id.toString(), false, exec.duration_ms)
        .catch(() => {});
      await exec.save();
      return exec;
    }
    // Advance
    await advanceToStep(exec, stepIdx + 1);
  }

  await exec.save();
  return exec;
}

export async function cancelExecution(
  tenantId: string,
  executionId: string,
  cancelledBy: string,
): Promise<RunbookExecutionDocument> {
  const exec = await getExecutionById(tenantId, executionId);

  if (exec.status === 'completed' || exec.status === 'cancelled' || exec.status === 'failed') {
    throw AppError.badRequest(`Execution is already ${exec.status}`);
  }

  // Mark current pending/running steps as skipped
  for (const step of exec.steps_state) {
    if (['pending', 'running', 'awaiting_approval'].includes(step.status)) {
      step.status = 'skipped';
    }
  }

  exec.status       = 'cancelled';
  exec.completed_at = new Date();
  exec.duration_ms  = Date.now() - exec.started_at.getTime();
  addLog(exec, `Execution cancelled by user ${cancelledBy}.`, 'warn');

  await exec.save();
  return exec;
}
