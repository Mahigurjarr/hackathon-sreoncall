import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { ChevronRight, GitPullRequest, Check, X, MessageSquare, Loader2, ExternalLink, AlertTriangle } from "lucide-react";
import { CitedText } from "@/components/CitedText";
import { approveProposal, reviseProposal, rejectProposal } from "@/lib/api";

// Ownership, as a surface rather than a claim.
//
// Everything shown here was authored by the agent unprompted — it investigated, concluded,
// then decided on its own whether the conclusion warranted a change to the SRE-as-code repo
// and wrote that change in full (src/actions/remediation.js). Nothing on this panel asks a
// human to originate anything.
//
// The three buttons are a review gate on the single action that leaves this machine, not a
// "generate" trigger: Approve opens a real PR, Push back hands an objection to the agent so
// it re-authors the fix ITSELF, Reject closes it out with a reason. "Push back" is the
// malleability affordance — the reviewer argues, the model rewrites, and the disagreement is
// kept in the proposal's revision history rather than overwritten.
//
// Progressive disclosure is the layout rule: the decision and the two-line summary are always
// visible; the files, the PR body, and the revision trail are collapsed until asked for.

const STATUS_STYLE = {
  draft: { label: "FIX READY", cls: "border-signal/40 bg-signal-dim text-signal" },
  revised: { label: "REVISED", cls: "border-signal/40 bg-signal-dim text-signal" },
  approved: { label: "APPROVING…", cls: "border-severity-medium/40 bg-severity-medium-bg text-severity-medium" },
  applied: { label: "PR OPEN", cls: "border-severity-ok/40 bg-severity-ok-bg text-severity-ok" },
  rejected: { label: "REJECTED", cls: "border-border bg-surface-2 text-muted-text" },
  withdrawn: { label: "WITHDRAWN", cls: "border-border bg-surface-2 text-muted-text" },
  apply_failed: { label: "PR FAILED", cls: "border-severity-critical/40 bg-severity-critical-bg text-severity-critical" },
};

function Disclosure({ title, count, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-t border-border">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 py-2.5 text-left t-label font-medium text-muted-text transition-colors hover:text-foreground"
      >
        <motion.span animate={{ rotate: open ? 90 : 0 }} transition={{ duration: 0.15 }}>
          <ChevronRight className="size-3.5" />
        </motion.span>
        {title}
        {count !== undefined && <span className="font-mono text-muted-text-2">({count})</span>}
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="pb-3">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ActionButton({ onClick, disabled, pending, icon: Icon, children, variant = "ghost" }) {
  const styles = {
    primary: "bg-signal text-signal-foreground hover:bg-signal/90 disabled:bg-signal/40",
    ghost: "border border-border-strong text-foreground hover:bg-surface-2 disabled:opacity-40",
    danger: "border border-severity-critical/40 text-severity-critical hover:bg-severity-critical-bg disabled:opacity-40",
  };
  return (
    <button
      onClick={onClick}
      disabled={disabled || pending}
      className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 t-label font-medium transition-colors disabled:cursor-not-allowed ${styles[variant]}`}
    >
      {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Icon className="size-3.5" />}
      {children}
    </button>
  );
}

export function OwnershipPanel({ incident, proposals, github, onCite, onChanged }) {
  const [pending, setPending] = useState(null); // 'approve' | 'revise' | 'reject'
  const [error, setError] = useState(null);
  const [feedback, setFeedback] = useState("");
  const [showFeedback, setShowFeedback] = useState(false);

  const remediation = incident.remediation;
  // Normally the proposal drafted for this incident. When this incident was recognised as a
  // recurrence, it has no proposal of its own — resolve the one it was pointed at instead, so
  // the shared fix stays reviewable from here rather than only from the original incident.
  const proposal =
    proposals.find((p) => p.payload?.incidentId === incident.id) ||
    (remediation?.kind === "reused" ? proposals.find((p) => p.id === remediation.proposalId) : null) ||
    null;

  // Ordered next steps come from the RCA's own "Recommended next steps" section — tied to
  // this investigation, not a generic runbook (see sentinel/daemon.js extractResolutionSteps).
  const steps = Array.isArray(incident.resolution) ? incident.resolution : [];

  async function run(action, fn) {
    setPending(action);
    setError(null);
    try {
      await fn();
      if (action === "revise") {
        setFeedback("");
        setShowFeedback(false);
      }
      await onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setPending(null);
    }
  }

  const actionable = proposal && ["draft", "revised", "apply_failed"].includes(proposal.status);
  const status = proposal ? STATUS_STYLE[proposal.status] || STATUS_STYLE.draft : null;

  return (
    <div className="flex flex-col gap-3 p-4">
      {/* --- The headline decision: what the agent wants to do about this, in one glance --- */}
      <div className="rounded-lg border border-border bg-surface p-3.5">
        <div className="flex items-center gap-2">
          <GitPullRequest className="size-4 text-muted-text" />
          <span className="t-label font-medium tracking-wide text-muted-text">THE AGENT'S MOVE</span>
          {status && (
            <span className={`ml-auto rounded border px-1.5 py-0.5 font-mono t-micro font-medium ${status.cls}`}>
              {status.label}
            </span>
          )}
        </div>

        {!remediation && (
          <p className="mt-2 t-body text-muted-text">
            The agent hasn't finished deciding on this incident yet. It drafts a fix on its own
            immediately after concluding — nothing to click.
          </p>
        )}

        {remediation?.kind === "no_code_fix" && (
          <div className="mt-2">
            <p className="t-body font-medium text-foreground">
              Deliberately proposing no code change.
            </p>
            <CitedText text={remediation.reason} onCite={onCite} className="mt-1 text-muted-text" />
          </div>
        )}

        {remediation?.kind === "reused" && (
          <div className="mt-2">
            <p className="t-body font-medium text-foreground">
              Already covered — reusing the fix from {remediation.fromIncident}.
            </p>
            <p className="mt-1 t-body text-muted-text">{remediation.note}</p>
            <p className="mt-1.5 t-label text-muted-text-2">
              No second PR was authored for the same cause, and no model call was spent
              re-deriving one.
            </p>
          </div>
        )}

        {remediation?.kind === "draft_failed" && (
          <p className="mt-2 flex items-start gap-2 t-body text-severity-critical">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            Drafting a fix failed: {remediation.error}
          </p>
        )}

        {proposal && (
          <>
            <p className="mt-2 t-display leading-snug text-foreground">{proposal.summary}</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 t-label text-muted-text-2">
              <span className="font-mono">{proposal.payload.branchName}</span>
              <span>·</span>
              <span>{proposal.payload.files.length} file{proposal.payload.files.length === 1 ? "" : "s"}</span>
              {proposal.payload.citedEvidence?.length > 0 && (
                <>
                  <span>·</span>
                  <span>{proposal.payload.citedEvidence.length} citations</span>
                </>
              )}
            </div>

            {proposal.status === "applied" && proposal.result?.url && (
              <a
                href={proposal.result.url}
                target="_blank"
                rel="noreferrer"
                className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-severity-ok-bg px-3 py-1.5 t-label font-medium text-severity-ok transition-colors hover:bg-severity-ok/20"
              >
                <ExternalLink className="size-3.5" />
                PR #{proposal.result.number} is open on {github?.repo}
              </a>
            )}

            {proposal.status === "withdrawn" && (
              <p className="mt-2 t-body text-muted-text">
                Withdrawn after review: {proposal.withdrawnReason}
              </p>
            )}

            {proposal.status === "rejected" && (
              <p className="mt-2 t-body text-muted-text">
                Rejected: {proposal.rejectionReason}
              </p>
            )}

            {/* --- Review gate. Only reachable while the draft is still live. --- */}
            {actionable && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <ActionButton
                  variant="primary"
                  icon={Check}
                  pending={pending === "approve"}
                  disabled={Boolean(pending) || !github?.configured}
                  onClick={() => run("approve", () => approveProposal(proposal.id))}
                >
                  {proposal.status === "apply_failed" ? "Retry opening PR" : "Approve & open PR"}
                </ActionButton>
                <ActionButton
                  icon={MessageSquare}
                  disabled={Boolean(pending)}
                  onClick={() => setShowFeedback((s) => !s)}
                >
                  Push back
                </ActionButton>
                <ActionButton
                  variant="danger"
                  icon={X}
                  pending={pending === "reject"}
                  disabled={Boolean(pending)}
                  onClick={() => run("reject", () => rejectProposal(proposal.id, "Rejected from the dashboard"))}
                >
                  Reject
                </ActionButton>
                {!github?.configured && (
                  <span className="t-label text-severity-medium">
                    GITHUB_REPO / GITHUB_TOKEN not set in .env — approving would fail
                  </span>
                )}
              </div>
            )}

            <AnimatePresence>
              {showFeedback && actionable && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden"
                >
                  <div className="mt-3">
                    <textarea
                      value={feedback}
                      onChange={(e) => setFeedback(e.target.value)}
                      rows={3}
                      placeholder="Tell the agent what's wrong with this fix. It re-reasons over your objection and rewrites the change itself."
                      className="w-full resize-y rounded-md border border-border bg-surface-2 p-2.5 t-body text-foreground placeholder:text-muted-text-2 focus:border-signal/50 focus:outline-none"
                    />
                    <div className="mt-2 flex items-center gap-2">
                      <ActionButton
                        variant="primary"
                        icon={MessageSquare}
                        pending={pending === "revise"}
                        disabled={!feedback.trim() || Boolean(pending)}
                        onClick={() => run("revise", () => reviseProposal(proposal.id, feedback))}
                      >
                        Send back to the agent
                      </ActionButton>
                      {pending === "revise" && (
                        <span className="t-label text-muted-text">
                          re-authoring the fix — this is a full model call, give it a moment
                        </span>
                      )}
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {error && (
              <p className="mt-2 flex items-start gap-1.5 t-label text-severity-critical">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                {error}
              </p>
            )}
          </>
        )}
      </div>

      {/* --- Ordered next steps for THIS incident --- */}
      {steps.length > 0 && (
        <div className="rounded-lg border border-border bg-surface px-3.5">
          <Disclosure title="Ordered next steps" count={steps.length} defaultOpen>
            <ol className="flex flex-col gap-2">
              {steps.map((s, i) => (
                <li key={i} className="flex gap-2.5">
                  <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full bg-surface-2 font-mono t-micro text-muted-text">
                    {i + 1}
                  </span>
                  <CitedText text={s} onCite={onCite} />
                </li>
              ))}
            </ol>
          </Disclosure>
        </div>
      )}

      {/* --- Everything below is detail on demand, collapsed by default --- */}
      {proposal && (
        <div className="rounded-lg border border-border bg-surface px-3.5">
          <Disclosure title="Files this PR changes" count={proposal.payload.files.length}>
            <div className="flex flex-col gap-3">
              {proposal.payload.files.map((f) => (
                <div key={f.path}>
                  <p className="mb-1 font-mono t-label text-signal">{f.path}</p>
                  <pre className="max-h-64 overflow-auto rounded-md border border-border bg-surface-2 p-2.5 font-mono t-label leading-relaxed text-foreground">
                    {f.content}
                  </pre>
                </div>
              ))}
            </div>
          </Disclosure>

          <Disclosure title="PR description">
            <CitedText text={proposal.payload.body} onCite={onCite} className="text-muted-text" />
          </Disclosure>

          {proposal.revisions?.length > 0 && (
            <Disclosure title="Pushback history" count={proposal.revisions.length}>
              <ol className="flex flex-col gap-3">
                {proposal.revisions.map((r, i) => (
                  <li key={i} className="border-l-2 border-border-strong pl-3">
                    <p className="t-micro font-medium tracking-wide text-muted-text-2">
                      REVIEWER · {new Date(r.at).toLocaleString()}
                    </p>
                    <p className="mt-0.5 t-body text-foreground">{r.feedback}</p>
                    <p className="mt-1 t-label text-muted-text">
                      Superseded: “{r.previous.summary}”
                    </p>
                  </li>
                ))}
              </ol>
            </Disclosure>
          )}
        </div>
      )}
    </div>
  );
}
