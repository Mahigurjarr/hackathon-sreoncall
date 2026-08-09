// The single choke point for every model call in the system.
//
// Nothing else under src/ may talk to the API directly. That is what makes the AI-native
// claim checkable: delete this file and detection, RCA, capability selection and PR
// authoring all stop existing — there is no fallback branch anywhere that keeps working.
//
// Modes (SRE_LLM_MODE):
//   live    real API (default)
//   record  real API + persist each exchange to fixtures/llm/
//   replay  fixtures only, no network — used while the shared key has no credits
//
// A replay miss throws. It must never invent a plausible-looking response: a silent stub
// would let a broken reasoning loop present as a working one.

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const API_URL = "https://api.openai.com/v1/chat/completions";
const FIXTURE_DIR = path.join(__dirname, "..", "..", "fixtures", "llm");

const MODELS = { fast: "gpt-5-mini", deep: "gpt-5" };

const mode = () => process.env.SRE_LLM_MODE || "live";

function fixtureKey(body) {
  // Key on the semantic content of the request, not wall-clock or ordering.
  const stable = JSON.stringify({
    model: body.model,
    messages: body.messages,
    tools: body.tools || null,
  });
  return crypto.createHash("sha256").update(stable).digest("hex").slice(0, 16);
}

function readFixture(key) {
  try {
    return JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, `${key}.json`), "utf8"));
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
}

function writeFixture(key, body, response) {
  fs.mkdirSync(FIXTURE_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(FIXTURE_DIR, `${key}.json`),
    JSON.stringify({ request: body, response }, null, 2),
  );
}

async function callApi(body) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is not set — load .env before running.");

  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
  });

  const json = await res.json();
  if (!res.ok) {
    const code = json?.error?.code || res.status;
    const msg = json?.error?.message || JSON.stringify(json);
    if (code === "credit_balance_exhausted" || code === "insufficient_quota") {
      throw new Error(
        `LLM unavailable (${code}): ${msg}\n` +
        `The shared hackathon key is out of credits. Ask the organizers to top it up, or ` +
        `run with SRE_LLM_MODE=replay against recorded fixtures.`,
      );
    }
    throw new Error(`LLM call failed (${code}): ${msg}`);
  }
  return json;
}

async function chat({ model = MODELS.deep, system, messages = [], tools, toolChoice }) {
  const full = system ? [{ role: "system", content: system }, ...messages] : messages;
  const body = { model, messages: full };
  if (tools?.length) {
    body.tools = tools;
    if (toolChoice) body.tool_choice = toolChoice;
  }

  const key = fixtureKey(body);
  let json;

  if (mode() === "replay") {
    const fixture = readFixture(key);
    if (!fixture) {
      throw new Error(
        `No fixture for this request (${key}) and SRE_LLM_MODE=replay.\n` +
        `Record it first with SRE_LLM_MODE=record once the API key has credits.`,
      );
    }
    json = fixture.response;
  } else {
    json = await callApi(body);
    if (mode() === "record") writeFixture(key, body, json);
  }

  const choice = json.choices?.[0]?.message || {};
  return {
    text: choice.content || "",
    toolCalls: (choice.tool_calls || []).map((c) => ({
      id: c.id,
      name: c.function.name,
      args: safeParse(c.function.arguments),
    })),
    raw: json,
    message: choice,
  };
}

function safeParse(s) {
  try { return JSON.parse(s); } catch { return {}; }
}

// Tool-use loop. `handlers` maps tool name -> async (args) => result.
// `onStep` fires per turn so the reasoning trace can be persisted — that trace is the
// artifact a judge asks for when they want to see the reasoning behind a claim.
async function runToolLoop({
  model = MODELS.deep, system, messages = [], tools = [], handlers = {},
  maxTurns = 12, onStep,
}) {
  const convo = [...messages];
  const steps = [];

  for (let turn = 0; turn < maxTurns; turn++) {
    const reply = await chat({ model, system, messages: convo, tools });
    convo.push(reply.message);

    const step = { turn, text: reply.text, toolCalls: reply.toolCalls, results: [] };

    if (!reply.toolCalls.length) {
      steps.push(step);
      if (onStep) await onStep(step);
      return { text: reply.text, steps, messages: convo };
    }

    for (const call of reply.toolCalls) {
      const handler = handlers[call.name];
      let result;
      try {
        result = handler
          ? await handler(call.args)
          : { error: `no handler registered for tool "${call.name}"` };
      } catch (err) {
        // Hand the failure back to the model rather than aborting: adapting to a failed
        // query is exactly the self-correction behaviour we want to exercise.
        result = { error: err.message };
      }
      step.results.push({ name: call.name, args: call.args, result });
      convo.push({
        role: "tool",
        tool_call_id: call.id,
        content: typeof result === "string" ? result : JSON.stringify(result),
      });
    }

    steps.push(step);
    if (onStep) await onStep(step);
  }

  return { text: "", steps, messages: convo, exhausted: true };
}

module.exports = { chat, runToolLoop, MODELS, fixtureKey };
