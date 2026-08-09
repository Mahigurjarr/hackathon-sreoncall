"use strict";

// Grounded conversational surface over the state the autonomous agent already produced.
// This is deliberately not a second investigator: it cannot invent fresh telemetry, mutate
// incidents, or execute a proposal. Its job is to explain live state, cite the evidence ledger,
// and route a human toward an existing review-gated action.

const crypto = require("node:crypto");
const { chat, MODELS } = require("../llm/client");
const store = require("../store/state");

const TERMINAL = new Set(["resolved", "closed", "mitigated"]);
const REVIEWABLE = new Set(["draft", "revised", "apply_failed"]);
const ROLES = new Set(["operations", "executive", "engineer"]);
const MAX_TURNS = 30;

const SYSTEM_PROMPT = `
You are the grounded command interface for an autonomous SRE agent monitoring the Astronomy
Shop. The sentinel—not the user—detects incidents, investigates them, and drafts remediation.
You explain that existing work and help the human decide what to inspect or review next.

Rules:
- Answer the user's actual question first, in plain language. Be concise but actionable.
- Distinguish verified telemetry from AI inference. Use phrases such as "Verified" and
  "Agent assessment" when the difference matters.
- Every operational claim must cite one or more evidence ids from the supplied packet using
  [E123] syntax. Never invent an id. Incident ids and proposal ids are not evidence ids.
- State missing telemetry and uncertainty explicitly. Silence is not health.
- Never claim an action was executed. You may only recommend inspecting an incident or
  reviewing an already-drafted proposal. Approval and execution remain separate human steps.
- Adapt depth to the selected role: executive = impact and decisions; operations = priority,
  ownership and next action; engineer = queries, services, rates, logs and traces.
- Use at most 220 words unless the user explicitly requests detail.
- Return only the required respond_to_operator tool call.
`.trim();

const RESPONSE_TOOL = {
  type: "function",
  function: {
    name: "respond_to_operator",
    description: "Return a grounded answer and a safe navigational next action.",
    parameters: {
      type: "object",
      properties: {
        headline: { type: "string", description: "Short direct answer, no markdown." },
        answer: { type: "string", description: "Grounded explanation with [E#] citations." },
        confidence: { type: "string", enum: ["high", "medium", "low"] },
        limitations: {
          type: "array",
          items: { type: "string" },
          description: "Missing data or uncertainty that materially limits the answer.",
        },
        action: {
          type: "object",
          properties: {
            type: { type: "string", enum: ["inspect_incident", "review_proposal", "none"] },
            targetId: { type: "string" },
            label: { type: "string" },
            reason: { type: "string" },
          },
          required: ["type", "label", "reason"],
        },
        suggestedPrompts: {
          type: "array",
          minItems: 2,
          maxItems: 3,
          items: { type: "string" },
        },
      },
      required: ["headline", "answer", "confidence", "limitations", "action", "suggestedPrompts"],
    },
  },
};

function trim(value, length) {
  const text = String(value || "");
  return text.length > length ? `${text.slice(0, length)}…` : text;
}

function contextPacket(state, { role, view, incidentId }) {
  const open = (state.incidents || []).filter((incident) => !TERMINAL.has(incident.status));
  const evidence = (state.evidence || []).slice(-90);
  const proposals = (state.proposals || []).slice(-20);

  return {
    requestedRole: role,
    currentView: view || "dashboard",
    selectedIncidentId: incidentId || null,
    observedAt: state.health?.at || state.lastSweep || null,
    fleetSummary: state.fleetSummary?.text || null,
    health: {
      reachable: state.health?.reachable ?? null,
      services: (state.health?.services || []).map((service) => ({
        service: service.service,
        status: service.status,
        requestsPerSecond: service.callRate,
        errorsPerSecond: service.errorRate,
        errorRatio: service.errorRatio,
      })),
    },
    openIncidents: open.map((incident) => ({
      id: incident.id,
      service: incident.service,
      confidence: incident.confidence,
      headline: trim(incident.headline, 300),
      rootCause: trim(incident.rca, 1200),
      evidenceIds: incident.evidence || [],
      remediation: incident.remediation || null,
    })),
    emergingRisks: (state.emergingRisks || []).slice(-20),
    reviewableProposals: proposals.filter((proposal) => REVIEWABLE.has(proposal.status)).map((proposal) => ({
      id: proposal.id,
      kind: proposal.kind,
      status: proposal.status,
      summary: proposal.summary,
      incidentId: proposal.payload?.incidentId || null,
      citedEvidence: proposal.payload?.citedEvidence || [],
    })),
    recentEvidence: evidence.map((entry) => ({
      id: entry.id,
      kind: entry.kind,
      at: entry.at,
      target: entry.target,
      summary: entry.summary,
      query: trim(entry.query, 260),
    })),
  };
}

function conversationMessages(conversation) {
  return (conversation?.turns || []).slice(-6).flatMap((turn) => [
    { role: "user", content: turn.question },
    { role: "assistant", content: `${turn.headline}\n${turn.answer}` },
  ]);
}

function validateAction(action, state) {
  if (!action || action.type === "none") return { type: "none", label: "", reason: action?.reason || "" };
  if (action.type === "inspect_incident") {
    const exists = (state.incidents || []).some((incident) => incident.id === action.targetId);
    if (exists) return action;
  }
  if (action.type === "review_proposal") {
    const exists = (state.proposals || []).some(
      (proposal) => proposal.id === action.targetId && REVIEWABLE.has(proposal.status),
    );
    if (exists) return action;
  }
  return {
    type: "none",
    label: "",
    reason: "The suggested target is not present in current state, so no action was exposed.",
  };
}

function groundedCitations(answer, state) {
  const known = new Set((state.evidence || []).map((entry) => entry.id));
  const cited = [...new Set([...String(answer || "").matchAll(/\[(E\d+)\]/g)].map((match) => match[1]))];
  const invalid = cited.filter((id) => !known.has(id));
  if (invalid.length) {
    throw new Error(`copilot returned unknown evidence citation(s): ${invalid.join(", ")}`);
  }
  return cited;
}

function persistTurn(conversationId, role, context, question, response) {
  store.update((state) => {
    if (!Array.isArray(state.copilotConversations)) state.copilotConversations = [];
    let conversation = state.copilotConversations.find((item) => item.id === conversationId);
    if (!conversation) {
      conversation = { id: conversationId, createdAt: new Date().toISOString(), role, turns: [] };
      state.copilotConversations.push(conversation);
    }
    conversation.role = role;
    conversation.updatedAt = new Date().toISOString();
    conversation.turns.push({
      at: new Date().toISOString(),
      context,
      question,
      ...response,
    });
    if (conversation.turns.length > MAX_TURNS) conversation.turns = conversation.turns.slice(-MAX_TURNS);
  });
}

async function askCopilot({ message, conversationId, role = "operations", context = {} }) {
  const question = String(message || "").trim();
  if (!question) throw new Error("message is required");
  if (question.length > 2000) throw new Error("message must be 2000 characters or fewer");

  const selectedRole = ROLES.has(role) ? role : "operations";
  const state = store.load();
  const id = conversationId || `C-${crypto.randomUUID()}`;
  const conversation = (state.copilotConversations || []).find((item) => item.id === id);
  const packet = contextPacket(state, { ...context, role: selectedRole });
  const messages = [
    ...conversationMessages(conversation),
    {
      role: "user",
      content: [
        `Operator question: ${question}`,
        "",
        "Current grounded system packet:",
        JSON.stringify(packet),
      ].join("\n"),
    },
  ];

  const reply = await chat({
    model: MODELS.fast,
    system: SYSTEM_PROMPT,
    messages,
    tools: [RESPONSE_TOOL],
    toolChoice: { type: "function", function: { name: "respond_to_operator" } },
  });
  const call = reply.toolCalls.find((toolCall) => toolCall.name === "respond_to_operator");
  if (!call) throw new Error("copilot returned no structured response");

  const citations = groundedCitations(call.args.answer, state);
  const response = {
    headline: trim(call.args.headline, 180),
    answer: String(call.args.answer || "").trim(),
    confidence: ["high", "medium", "low"].includes(call.args.confidence) ? call.args.confidence : "low",
    limitations: Array.isArray(call.args.limitations) ? call.args.limitations.slice(0, 5).map((item) => trim(item, 240)) : [],
    action: validateAction(call.args.action, state),
    suggestedPrompts: Array.isArray(call.args.suggestedPrompts)
      ? call.args.suggestedPrompts.slice(0, 3).map((item) => trim(item, 140))
      : [],
    citations,
  };

  persistTurn(id, selectedRole, context, question, response);
  return { conversationId: id, ...response };
}

module.exports = { askCopilot, contextPacket, groundedCitations, validateAction };
