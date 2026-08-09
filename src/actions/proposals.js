// Draft-then-approve proposals — the same shape reference/sreoncall uses for
// propose_ticket/propose_change/etc: an agent never writes live directly. It records a
// proposal (human-readable `summary` + machine-replayable `payload`) that something
// explicit has to approve, and only then does a separate step actually touch GitHub.
//
// This module makes no judgement about whether a fix is worth proposing or good enough
// to PR — that reasoning belongs upstream (investigator/capabilities). This is just the
// state machine: draft -> approved -> applied (or apply_failed, never silently stuck).

"use strict";

const { update } = require("../store/state");
const { openFixPR } = require("./github");

/**
 * Records a new proposal with status 'draft'. `kind` is e.g. 'github_pr'. `summary` is
 * prose for a human/judge to read; `payload` is the exact data needed to replay the
 * action later (never re-derived from summary).
 */
function draftProposal({ kind, summary, payload }) {
  let created;
  update((state) => {
    if (!Array.isArray(state.proposals)) state.proposals = [];
    created = {
      id: `P${state.proposals.length + 1}`,
      kind,
      summary,
      payload,
      status: "draft",
      createdAt: new Date().toISOString(),
    };
    state.proposals.push(created);
  });
  return created;
}

/**
 * Flips a proposal to 'approved' — the explicit decision (human, or orchestrating
 * logic) to proceed. Does not touch GitHub or any other external system itself.
 */
function approveProposal(id) {
  let approved;
  update((state) => {
    const proposal = (state.proposals || []).find((p) => p.id === id);
    if (!proposal) throw new Error(`No proposal found with id '${id}'`);
    proposal.status = "approved";
    proposal.approvedAt = new Date().toISOString();
    approved = proposal;
  });
  return approved;
}

/**
 * Applies an approved 'github_pr' proposal by actually opening the PR. Payload shape:
 * `{ branchName, files: [{path, content}], title, body }`.
 *
 * On success: status -> 'applied', PR url/number stored on the proposal.
 * On failure: status -> 'apply_failed', error message stored — never left stuck as
 * 'approved' with no record of what happened.
 */
async function applyGithubPrProposal(proposal, { owner, repo, token }) {
  if (proposal.kind !== "github_pr") {
    throw new Error(`applyGithubPrProposal expects kind 'github_pr', got '${proposal.kind}'`);
  }
  if (proposal.status !== "approved") {
    throw new Error(
      `Proposal '${proposal.id}' must be 'approved' before applying (status: '${proposal.status}')`
    );
  }

  const { branchName, files, title, body } = proposal.payload;

  try {
    const result = await openFixPR({ owner, repo, token, branchName, files, title, body });
    update((state) => {
      const p = (state.proposals || []).find((x) => x.id === proposal.id);
      if (p) {
        p.status = "applied";
        p.appliedAt = new Date().toISOString();
        p.result = result;
      }
    });
    return result;
  } catch (err) {
    update((state) => {
      const p = (state.proposals || []).find((x) => x.id === proposal.id);
      if (p) {
        p.status = "apply_failed";
        p.error = err.message;
      }
    });
    throw err;
  }
}

module.exports = { draftProposal, approveProposal, applyGithubPrProposal };
