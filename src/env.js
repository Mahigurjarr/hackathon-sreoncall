// Loads .env into process.env for host runs. Zero dependencies (CONTRACTS.md: the backend
// installs nothing from npm), and deliberately non-destructive — a variable already present
// in the real environment always wins, so `docker compose`'s env_file and any explicit
// `VAR=x node ...` override stay authoritative and this file is a no-op inside the container.
//
// Nothing here ever logs a value. The only secrets in this system (OPENAI_API_KEY,
// GITHUB_TOKEN) pass through this function, and .env is gitignored precisely so they never
// reach the public repo — printing one here would undo that in the daemon's own stdout.

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ENV_PATH = path.join(__dirname, "..", ".env");

function loadEnv(file = ENV_PATH) {
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return {}; // no .env (e.g. in Docker) is normal, not an error
    throw err;
  }

  const loaded = {};
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;

    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();

    // Strip one matching pair of surrounding quotes, if present.
    if (value.length >= 2 && (value[0] === '"' || value[0] === "'") && value[value.length - 1] === value[0]) {
      value = value.slice(1, -1);
    }

    if (!key) continue;
    loaded[key] = value;
    if (process.env[key] === undefined) process.env[key] = value;
  }
  return loaded;
}

module.exports = { loadEnv, ENV_PATH };
