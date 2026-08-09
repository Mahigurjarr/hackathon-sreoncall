// Minimal GitHub REST API client — zero dependencies, Node 24 built-in fetch.
//
// `gh` CLI is not installed in this environment, so opening a real PR (the "ownership"
// trait requires an actual PR, not a written suggestion) has to go through the raw REST
// API with a personal access token. Every call here is a plain HTTPS request; nothing is
// cached or retried silently, so a failure surfaces as a thrown Error rather than
// disappearing.
//
// This module never decides *whether* to open a PR or *what* the fix should be — it only
// knows how to talk to GitHub. That judgement lives upstream (investigator/capabilities).

"use strict";

const GITHUB_API = "https://api.github.com";

/**
 * Low-level request helper. Throws on any non-2xx response with the status and body
 * text attached, so a failed PR attempt is never swallowed.
 */
async function githubRequest(method, path, token, body) {
  const res = await fetch(`${GITHUB_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();

  if (!res.ok) {
    const err = new Error(
      `GitHub API ${method} ${path} -> ${res.status} ${res.statusText}: ${text}`
    );
    err.status = res.status;
    err.body = text;
    throw err;
  }

  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * Resolves the repo's default branch (usually `main`) to the sha to branch from.
 * Reads the default branch name off the repo itself rather than assuming `main`.
 */
async function getDefaultBranchSha(owner, repo, token) {
  const repoInfo = await githubRequest("GET", `/repos/${owner}/${repo}`, token);
  const defaultBranch = repoInfo.default_branch || "main";
  const ref = await githubRequest(
    "GET",
    `/repos/${owner}/${repo}/git/ref/heads/${defaultBranch}`,
    token
  );
  return ref.object.sha;
}

/**
 * Creates a new branch (a ref) pointing at `fromSha`.
 */
async function createBranch(owner, repo, token, branchName, fromSha) {
  return githubRequest("POST", `/repos/${owner}/${repo}/git/refs`, token, {
    ref: `refs/heads/${branchName}`,
    sha: fromSha,
  });
}

/**
 * Creates or updates a single file on `branchName`. GitHub's contents API requires the
 * current file `sha` to update an existing file — if the file already exists on that
 * branch, this fetches it first; a 404 (file doesn't exist yet) is expected and means
 * we're creating, not updating.
 */
async function putFile(owner, repo, token, branchName, path, content, message) {
  const encoded = Buffer.from(content, "utf8").toString("base64");
  let sha;

  try {
    const existing = await githubRequest(
      "GET",
      `/repos/${owner}/${repo}/contents/${encodeURI(path)}?ref=${encodeURIComponent(branchName)}`,
      token
    );
    if (existing && !Array.isArray(existing)) sha = existing.sha;
  } catch (err) {
    if (err.status !== 404) throw err;
  }

  return githubRequest("PUT", `/repos/${owner}/${repo}/contents/${encodeURI(path)}`, token, {
    message,
    content: encoded,
    branch: branchName,
    ...(sha ? { sha } : {}),
  });
}

/**
 * Opens a pull request from `head` into `base` (defaults to `main`).
 */
async function openPullRequest(owner, repo, token, { title, head, base = "main", body }) {
  return githubRequest("POST", `/repos/${owner}/${repo}/pulls`, token, {
    title,
    head,
    base,
    body,
  });
}

/**
 * Lists currently open PRs — used for verification/dedup so callers don't open a
 * duplicate PR for the same incident.
 */
async function listOpenPRs(owner, repo, token) {
  return githubRequest("GET", `/repos/${owner}/${repo}/pulls?state=open`, token);
}

/**
 * Composes the full sequence: base sha -> branch -> write each file -> open PR.
 * `files` is `[{ path, content, message? }]`; content is plain text (this function
 * base64-encodes it, callers should not).
 *
 * Returns `{ url, number }` for the created PR.
 */
async function openFixPR({ owner, repo, token, branchName, files, title, body }) {
  const baseSha = await getDefaultBranchSha(owner, repo, token);
  await createBranch(owner, repo, token, branchName, baseSha);

  for (const file of files) {
    await putFile(
      owner,
      repo,
      token,
      branchName,
      file.path,
      file.content,
      file.message || `Add ${file.path}`
    );
  }

  const pr = await openPullRequest(owner, repo, token, {
    title,
    head: branchName,
    base: "main",
    body,
  });

  return { url: pr.html_url, number: pr.number };
}

module.exports = {
  getDefaultBranchSha,
  createBranch,
  putFile,
  openPullRequest,
  listOpenPRs,
  openFixPR,
};
