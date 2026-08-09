import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  Bot,
  BrainCircuit,
  Command,
  CornerDownLeft,
  LoaderCircle,
  RotateCcw,
  Search,
  ShieldCheck,
  Sparkles,
  UserRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { CitedText } from "@/components/CitedText";
import { askCopilot, getCopilotConversation } from "@/lib/api";

const STORAGE_KEY = "sreoncall.copilot.v1";
const ROLES = [
  { id: "operations", label: "Operations" },
  { id: "executive", label: "Executive" },
  { id: "engineer", label: "Engineer" },
];

function readStoredSession() {
  try {
    const value = JSON.parse(window.localStorage.getItem(STORAGE_KEY));
    if (value?.version === 1) return value;
  } catch {
    // A corrupt local preference must not block the command interface.
  }
  return { version: 1, conversationId: null, role: "operations" };
}

function promptsFor(view, incidentId) {
  if (view === "incidents" && incidentId) {
    return [
      `Explain ${incidentId} in simple language`,
      `What evidence supports ${incidentId}?`,
      `What should I review next for ${incidentId}?`,
    ];
  }
  if (view === "capabilities") {
    return [
      "Which monitoring policies are recommended and why?",
      "What monitoring coverage gap matters most?",
      "How is the agent adapting monitoring to this environment?",
    ];
  }
  return [
    "What needs my attention right now?",
    "What are the biggest operational risks?",
    "Which action should I review next?",
  ];
}

function turnsToMessages(turns) {
  return (turns || []).flatMap((turn) => [
    { id: `${turn.at}-user`, role: "user", text: turn.question },
    {
      id: `${turn.at}-assistant`,
      role: "assistant",
      headline: turn.headline,
      text: turn.answer,
      confidence: turn.confidence,
      limitations: turn.limitations || [],
      action: turn.action,
      suggestedPrompts: turn.suggestedPrompts || [],
    },
  ]);
}

function ConfidenceBadge({ value }) {
  const color = value === "high"
    ? "var(--severity-ok)"
    : value === "medium"
      ? "var(--severity-medium)"
      : "var(--severity-low)";
  return (
    <span className="rounded-full border px-2 py-0.5 font-mono text-[8px] uppercase tracking-[0.12em]" style={{ color, borderColor: `color-mix(in srgb, ${color} 28%, transparent)` }}>
      {value || "low"} confidence
    </span>
  );
}

export function CopilotWorkspace({ state, view, incidentId, onSelectIncident, onCite }) {
  const stored = useMemo(readStoredSession, []);
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState(stored.role);
  const [conversationId, setConversationId] = useState(stored.conversationId);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const scrollRef = useRef(null);

  const contextualPrompts = useMemo(() => promptsFor(view, incidentId), [view, incidentId]);
  const latestSuggestions = [...messages].reverse().find((message) => message.role === "assistant")?.suggestedPrompts;
  const suggestions = latestSuggestions?.length ? latestSuggestions : contextualPrompts;

  useEffect(() => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: 1, conversationId, role }),
    );
  }, [conversationId, role]);

  useEffect(() => {
    function onShortcut(event) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen(true);
      }
    }
    window.addEventListener("keydown", onShortcut);
    return () => window.removeEventListener("keydown", onShortcut);
  }, []);

  useEffect(() => {
    if (!conversationId) return;
    let active = true;
    getCopilotConversation(conversationId)
      .then((conversation) => {
        if (active) setMessages(turnsToMessages(conversation.turns));
      })
      .catch(() => {
        // The state file may have been reset while the browser retained its id. Starting a
        // fresh thread is safer than presenting an old local transcript as server-backed.
        if (active) setConversationId(null);
      });
    return () => { active = false; };
  }, [conversationId]);

  useEffect(() => {
    if (open) scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, pending, open]);

  const submit = useCallback(async (questionOverride) => {
    const question = String(questionOverride || input).trim();
    if (!question || pending) return;
    setOpen(true);
    setPending(true);
    setError(null);
    setInput("");
    const userMessage = { id: `local-${Date.now()}`, role: "user", text: question };
    setMessages((current) => [...current, userMessage]);

    try {
      const result = await askCopilot({
        message: question,
        conversationId,
        role,
        context: { view, incidentId: incidentId || null },
      });
      setConversationId(result.conversationId);
      setMessages((current) => [
        ...current,
        {
          id: `assistant-${Date.now()}`,
          role: "assistant",
          headline: result.headline,
          text: result.answer,
          confidence: result.confidence,
          limitations: result.limitations,
          action: result.action,
          suggestedPrompts: result.suggestedPrompts,
        },
      ]);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setPending(false);
    }
  }, [conversationId, incidentId, input, pending, role, view]);

  // Start a fresh thread. The old conversation is NOT deleted — it stays in
  // `copilotConversations` in the state file, where every turn, its citations, and its stated
  // limitations remain auditable. This only stops it being carried into the next question, for
  // when the previous thread has drifted somewhere unhelpful or a different person picks up
  // the console mid-shift.
  const startNewThread = useCallback(() => {
    setConversationId(null);
    setMessages([]);
    setError(null);
    setInput("");
  }, []);

  function handleAction(action) {
    if (!action || action.type === "none") return;
    if (action.type === "inspect_incident") onSelectIncident(action.targetId);
    if (action.type === "review_proposal") {
      const proposal = (state.proposals || []).find((item) => item.id === action.targetId);
      if (proposal?.payload?.incidentId) onSelectIncident(proposal.payload.incidentId);
    }
    setOpen(false);
  }

  function onKeyDown(event) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="copilot-dock group"
        aria-label="Open AI command workspace"
      >
        <span className="copilot-dock-icon"><Sparkles className="size-3.5" /></span>
        <span className="hidden truncate text-[11px] font-medium text-foreground sm:inline">Ask SREonCall</span>
        <span className="hidden items-center gap-1 rounded-full border border-border bg-black/20 px-1.5 py-0.5 font-mono text-[8px] text-muted-text-2 sm:flex">
          <Command className="size-2.5" /> K
        </span>
        <ArrowRight className="size-3 text-muted-text-2 transition-transform group-hover:translate-x-0.5 group-hover:text-signal" />
      </button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="w-full gap-0 border-l-border bg-[#10141c] p-0 sm:max-w-[560px]" aria-describedby={undefined}>
          <SheetHeader className="border-b border-border px-5 py-4">
            <div className="flex items-center gap-3 pr-8">
              <span className="copilot-avatar"><BrainCircuit className="size-4" /></span>
              <div className="min-w-0 flex-1">
                <SheetTitle className="text-[13px]">AI command workspace</SheetTitle>
                <p className="mt-1 flex items-center gap-1.5 text-[9px] text-muted-text-2">
                  <ShieldCheck className="size-3 text-signal" /> Grounded answers · cited evidence · approval-gated actions
                </p>
              </div>
              <button
                onClick={startNewThread}
                disabled={pending || (!messages.length && !conversationId)}
                title="Start a new thread — the current one stays saved and auditable"
                aria-label="Start a new thread"
                className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md border border-border bg-surface-2/60 px-2 py-1.5 text-[9px] text-muted-text transition-colors hover:border-signal/30 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-signal disabled:cursor-not-allowed disabled:opacity-40"
              >
                <RotateCcw className="size-3" /> New thread
              </button>
            </div>
            <div className="mt-4 flex items-center gap-1 rounded-lg border border-border bg-background/60 p-1">
              {ROLES.map((item) => (
                <button key={item.id} onClick={() => setRole(item.id)} className={`flex-1 rounded-md px-2 py-1.5 text-[9px] transition-colors ${role === item.id ? "bg-surface-2 text-foreground" : "text-muted-text-2 hover:text-foreground"}`}>
                  {item.label}
                </button>
              ))}
            </div>
          </SheetHeader>

          <div ref={scrollRef} className="copilot-thread flex-1 overflow-y-auto px-5 py-5">
            {!messages.length ? (
              <div className="flex min-h-full flex-col justify-center py-10">
                <span className="copilot-hero-icon"><Bot className="size-6" /></span>
                <h2 className="mt-5 text-xl font-medium tracking-[-0.04em] text-foreground">What do you need to understand?</h2>
                <p className="mt-2 max-w-md text-[11px] leading-5 text-muted-text">
                  Ask in plain language. Answers are generated from the current fleet state and link back to the exact evidence used.
                </p>
                <div className="mt-6 flex flex-col gap-2">
                  {contextualPrompts.map((prompt) => (
                    <button key={prompt} onClick={() => submit(prompt)} className="copilot-prompt group">
                      <Search className="size-3.5 text-muted-text-2 group-hover:text-signal" />
                      <span className="flex-1">{prompt}</span>
                      <ArrowRight className="size-3 text-muted-text-2" />
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-5">
                {messages.map((message) => message.role === "user" ? (
                  <div key={message.id} className="flex justify-end gap-2">
                    <div className="max-w-[86%] rounded-2xl rounded-tr-sm border border-border bg-surface-2 px-3.5 py-3 text-[11px] leading-5 text-foreground">{message.text}</div>
                    <span className="mt-1 grid size-6 shrink-0 place-items-center rounded-lg bg-surface-2 text-muted-text"><UserRound className="size-3.5" /></span>
                  </div>
                ) : (
                  <div key={message.id} className="flex gap-3">
                    <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg border border-signal/20 bg-signal-dim text-signal"><Sparkles className="size-3.5" /></span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-[12px] font-medium text-foreground">{message.headline}</h3>
                        <ConfidenceBadge value={message.confidence} />
                      </div>
                      <CitedText text={message.text} onCite={onCite} className="mt-2 text-[11px] leading-5 text-muted-text" />
                      {message.limitations?.length ? (
                        <div className="mt-3 rounded-lg border border-severity-low/20 bg-severity-low-bg px-3 py-2">
                          <p className="text-[8px] uppercase tracking-[0.12em] text-severity-low">Known limitations</p>
                          {message.limitations.map((limitation) => <p key={limitation} className="mt-1 text-[9px] leading-4 text-muted-text">{limitation}</p>)}
                        </div>
                      ) : null}
                      {message.action?.type && message.action.type !== "none" ? (
                        <Button onClick={() => handleAction(message.action)} variant="outline" size="sm" className="mt-3 border-signal/25 bg-signal-dim text-signal hover:bg-signal/20">
                          {message.action.label}<ArrowRight className="size-3" />
                        </Button>
                      ) : null}
                    </div>
                  </div>
                ))}
                {pending ? (
                  <div className="flex items-center gap-3 text-[10px] text-muted-text">
                    <span className="grid size-7 place-items-center rounded-lg border border-signal/20 bg-signal-dim text-signal"><LoaderCircle className="size-3.5 animate-spin" /></span>
                    Reading the live evidence trail…
                  </div>
                ) : null}
                {error ? (
                  <div className="rounded-xl border border-severity-critical/25 bg-severity-critical-bg p-3 text-[10px] leading-5 text-severity-critical">
                    {error}
                  </div>
                ) : null}
              </div>
            )}
          </div>

          <div className="border-t border-border bg-background/60 px-4 py-3">
            {messages.length && !pending ? (
              <div className="mb-2 flex gap-1.5 overflow-x-auto pb-1">
                {suggestions.slice(0, 3).map((prompt) => (
                  <button key={prompt} onClick={() => submit(prompt)} className="shrink-0 rounded-full border border-border px-2.5 py-1 text-[8px] text-muted-text transition-colors hover:border-border-strong hover:text-foreground">{prompt}</button>
                ))}
              </div>
            ) : null}
            <div className="flex items-end gap-2 rounded-xl border border-border-strong bg-surface px-3 py-2 focus-within:border-signal/40">
              <textarea value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={onKeyDown} rows={1} placeholder="Ask about risk, evidence, impact, or the next action…" className="max-h-28 min-h-7 flex-1 resize-none bg-transparent py-1 text-[11px] leading-5 text-foreground outline-none placeholder:text-muted-text-2" />
              <Button onClick={() => submit()} disabled={!input.trim() || pending} size="icon-sm" aria-label="Send question">
                {pending ? <LoaderCircle className="animate-spin" /> : <CornerDownLeft />}
              </Button>
            </div>
            <p className="mt-2 text-center text-[8px] text-muted-text-2">AI can be wrong. Operational claims link to recorded evidence; actions still require human approval.</p>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
