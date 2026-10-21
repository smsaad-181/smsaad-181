// Rewrites the <!--START_SECTION:activity--> block in README.md with recent public activity.
// Runs on GitHub Actions (Node 20+); uses GITHUB_TOKEN if present, otherwise unauthenticated.
import { readFileSync, writeFileSync } from "node:fs";

const USER = "smsaad-181";
const MAX_LINES = 10;
const START = "<!--START_SECTION:activity-->";
const END = "<!--END_SECTION:activity-->";

const headers = { Accept: "application/vnd.github+json", "User-Agent": USER };
if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

const res = await fetch(`https://api.github.com/users/${USER}/events/public?per_page=100`, { headers });
if (!res.ok) throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
const events = (await res.json()).sort((a, b) => b.created_at.localeCompare(a.created_at));

const repoLink = (name) => `[${name.split("/")[1]}](https://github.com/${name})`;
const describe = (e) => {
  switch (e.type) {
    case "PushEvent":
      return `🔨 Pushed to ${repoLink(e.repo.name)}`;
    case "CreateEvent":
      return e.payload.ref_type === "repository" ? `🆕 Created ${repoLink(e.repo.name)}` : null;
    case "PublicEvent":
      return `🌍 Made ${repoLink(e.repo.name)} public`;
    case "ReleaseEvent":
      return `🚀 Released ${e.payload.release?.tag_name ?? ""} in ${repoLink(e.repo.name)}`;
    case "PullRequestEvent":
      return `🔀 ${e.payload.action} a PR in ${repoLink(e.repo.name)}`;
    case "IssuesEvent":
      return `❗ ${e.payload.action} an issue in ${repoLink(e.repo.name)}`;
    case "WatchEvent":
      return `⭐ Starred ${repoLink(e.repo.name)}`;
    default:
      return null;
  }
};

// Keep one line per repo + action so daily pushes don't flood the list
const seen = new Set();
const lines = [];
for (const e of events) {
  if (e.repo.name === `${USER}/${USER}`) continue;
  const text = describe(e);
  if (!text) continue;
  const key = `${e.type}:${e.repo.name}`;
  if (seen.has(key)) continue;
  seen.add(key);
  lines.push(`${lines.length + 1}. ${text} <sub>· ${e.created_at.slice(0, 10)}</sub>`);
  if (lines.length === MAX_LINES) break;
}

const readme = readFileSync("README.md", "utf8");
const start = readme.indexOf(START);
const end = readme.indexOf(END);
if (start === -1 || end === -1) throw new Error("Activity markers not found in README.md");

const body = lines.length ? lines.join("\n") : "_No recent public activity._";
const updated = readme.slice(0, start + START.length) + "\n" + body + "\n" + readme.slice(end);
if (updated !== readme) {
  writeFileSync("README.md", updated);
  console.log(`Updated activity section with ${lines.length} lines`);
} else {
  console.log("Activity section already up to date");
}
