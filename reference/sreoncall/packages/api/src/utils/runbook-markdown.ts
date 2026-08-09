export interface ParsedRunbookStep {
  order: number;
  title: string;
  instructions: string;
  type: 'manual' | 'bash_script';
}

/**
 * Extract executable steps from AI-generated runbook markdown.
 *
 * The generator emits a structured 10-section markdown document. We pick the
 * operational sections (Immediate Triage, Diagnosis, Mitigation &
 * Recovery, Verification, Escalation) and turn each numbered item into a
 * structured step so the runbook is actually executable from the UI.
 *
 * Steps that contain a fenced ```bash ... ``` block become bash_script
 * steps; everything else is a manual step carrying the full instructions.
 */

const ACTIONABLE_HEADINGS = [
  /^\s*##\s*\d*\.?\s*Immediate Triage/i,
  /^\s*##\s*\d*\.?\s*Diagnosis/i,
  /^\s*##\s*\d*\.?\s*Mitigation/i,
  /^\s*##\s*\d*\.?\s*Verification/i,
  /^\s*##\s*\d*\.?\s*Escalation/i,
  /^\s*##\s*\d*\.?\s*Response Steps/i,
];

function isSectionStart(line: string): boolean {
  return /^\s*##\s+/.test(line) || /^\s*#\s+/.test(line);
}

function isActionableHeading(line: string): boolean {
  return ACTIONABLE_HEADINGS.some((rx) => rx.test(line));
}

function stripLeadingMarker(line: string): string {
  // Matches "1. ", "1) ", "- ", "* "
  return line.replace(/^\s*(?:\d+[.)]|[-*])\s+/, '').trim();
}

function isListItem(line: string): boolean {
  return /^\s*(?:\d+[.)]|[-*])\s+/.test(line);
}

function extractTitleAndBody(block: string): { title: string; body: string } {
  const lines = block.split('\n');
  const first = lines[0] ? lines[0].trim() : '';
  const rest = lines.slice(1).join('\n').trim();

  // Pull bolded prefix as title: "**Restart** the pod" → title "Restart"
  const bold = first.match(/^\*\*([^*]+?)\*\*[:\s-]*(.*)$/);
  if (bold) {
    const [, boldTitle, remainder] = bold;
    const body = [remainder.trim(), rest].filter(Boolean).join('\n\n');
    return { title: boldTitle.trim(), body };
  }

  // Fall back to first sentence (≤80 chars) as title
  const firstLine = first.length > 120 ? first.slice(0, 117) + '…' : first;
  return { title: firstLine || 'Step', body: rest };
}

function detectStepType(body: string): 'manual' | 'bash_script' {
  return /```(?:bash|sh|shell)\b/i.test(body) ? 'bash_script' : 'manual';
}

export function parseRunbookStepsFromMarkdown(markdown: string): ParsedRunbookStep[] {
  const steps: ParsedRunbookStep[] = [];
  if (!markdown || typeof markdown !== 'string') return steps;

  const lines = markdown.split('\n');
  let inActionableSection = false;
  let buffer: string[] = [];

  const flushBuffer = () => {
    if (buffer.length === 0) return;
    const block = buffer.join('\n').trim();
    buffer = [];
    if (!block) return;

    const { title, body } = extractTitleAndBody(block);
    if (!title) return;

    steps.push({
      order: steps.length,
      title: title.slice(0, 300),
      instructions: block.slice(0, 10000),
      type: detectStepType(body || block),
    });
  };

  for (const raw of lines) {
    const line = raw;

    if (isSectionStart(line)) {
      flushBuffer();
      inActionableSection = isActionableHeading(line);
      continue;
    }

    if (!inActionableSection) continue;

    if (isListItem(line)) {
      // starting a new list item — flush previous
      flushBuffer();
      buffer.push(stripLeadingMarker(line));
      continue;
    }

    // Continuation of current step (code block, sub-bullet, paragraph)
    if (buffer.length > 0) {
      buffer.push(line);
    }
  }

  flushBuffer();

  // Cap at 40 steps — anything more is likely noise
  return steps.slice(0, 40);
}
