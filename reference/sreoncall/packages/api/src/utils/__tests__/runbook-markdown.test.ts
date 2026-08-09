import { describe, it, expect } from 'vitest';
import { parseRunbookStepsFromMarkdown } from '../runbook-markdown';

describe('parseRunbookStepsFromMarkdown', () => {
  it('returns empty array for empty input', () => {
    expect(parseRunbookStepsFromMarkdown('')).toEqual([]);
    expect(parseRunbookStepsFromMarkdown(null as any)).toEqual([]);
  });

  it('extracts numbered items from Immediate Triage section', () => {
    const md = `
# Runbook: API down

## 1. Overview
Some overview text.

## 4. Immediate Triage (first 5 minutes)
1. Check pod status with \`kubectl get pods\`
2. Inspect recent deployments
3. Check DB connectivity

## 9. Post-Incident Actions
- Schedule post-mortem
`;
    const steps = parseRunbookStepsFromMarkdown(md);
    expect(steps).toHaveLength(3);
    expect(steps[0].title).toMatch(/Check pod status/);
    expect(steps[0].order).toBe(0);
    expect(steps[2].title).toMatch(/Check DB connectivity/);
  });

  it('pulls bolded prefix as step title', () => {
    const md = `
## Immediate Triage
1. **Acknowledge** the incident and notify the team
2. **Assess scope**: identify services and user impact
`;
    const steps = parseRunbookStepsFromMarkdown(md);
    expect(steps[0].title).toBe('Acknowledge');
    expect(steps[0].instructions).toContain('notify the team');
    expect(steps[1].title).toBe('Assess scope');
  });

  it('detects bash_script steps via fenced code blocks', () => {
    const md = `
## Mitigation & Recovery
1. Restart the deployment
\`\`\`bash
kubectl rollout restart deployment/api
\`\`\`
2. Manually verify pod health
`;
    const steps = parseRunbookStepsFromMarkdown(md);
    expect(steps).toHaveLength(2);
    expect(steps[0].type).toBe('bash_script');
    expect(steps[0].instructions).toContain('kubectl rollout restart');
    expect(steps[1].type).toBe('manual');
  });

  it('combines multiple actionable sections', () => {
    const md = `
## Immediate Triage
1. Check dashboards

## Mitigation & Recovery
1. Scale up replicas
2. Roll back deployment

## Verification & Post-Recovery Checks
1. Smoke test /health
`;
    const steps = parseRunbookStepsFromMarkdown(md);
    expect(steps).toHaveLength(4);
    expect(steps.map((s) => s.title)).toEqual([
      'Check dashboards',
      'Scale up replicas',
      'Roll back deployment',
      'Smoke test /health',
    ]);
  });

  it('ignores non-actionable sections (Overview, Severity)', () => {
    const md = `
## 1. Overview
1. This is not a step — it is descriptive
2. Neither is this

## 3. Severity & Impact Assessment
- P1 criteria

## 4. Immediate Triage
1. Real step here
`;
    const steps = parseRunbookStepsFromMarkdown(md);
    expect(steps).toHaveLength(1);
    expect(steps[0].title).toMatch(/Real step/);
  });

  it('caps at 40 steps to avoid noise', () => {
    const items = Array.from({ length: 60 }, (_, i) => `${i + 1}. step ${i}`).join('\n');
    const md = `## Immediate Triage\n${items}`;
    expect(parseRunbookStepsFromMarkdown(md).length).toBe(40);
  });

  it('handles bullet lists (- and *)', () => {
    const md = `
## Escalation
- If unresolved in 15 min, page the on-call lead
* Escalate to platform team after 30 min
`;
    const steps = parseRunbookStepsFromMarkdown(md);
    expect(steps).toHaveLength(2);
  });
});
