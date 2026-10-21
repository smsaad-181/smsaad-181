// Generates stats, top-languages and streak SVG cards into ./cards from the GitHub GraphQL API.
// Runs on GitHub Actions (Node 20+) with GITHUB_TOKEN.
import { mkdirSync, writeFileSync } from "node:fs";

const USER = process.env.CARDS_USER || "smsaad-181";
const TOKEN = process.env.GITHUB_TOKEN;
if (!TOKEN) throw new Error("GITHUB_TOKEN is required");

const C = { bg: "#0D1117", border: "#C792EA", title: "#C792EA", text: "#FFFFFF", muted: "#9AA5CE", fire: "#FF5874" };
const FONT = "'Segoe UI', Ubuntu, Sans-Serif";

async function gql(query, variables = {}) {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json", "User-Agent": USER },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (!res.ok || json.errors) throw new Error(`GraphQL error: ${JSON.stringify(json.errors ?? json)}`);
  return json.data;
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const fmt = (n) => n.toLocaleString("en-US");
const fmtDate = (d) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

// ---- Fetch data ----
const { user } = await gql(
  `query($login: String!) {
    user(login: $login) {
      name login createdAt
      followers { totalCount }
      pullRequests { totalCount }
      issues { totalCount }
      repositories(ownerAffiliations: OWNER, isFork: false, first: 100) {
        totalCount
        nodes {
          stargazerCount
          languages(first: 10, orderBy: { field: SIZE, direction: DESC }) { edges { size node { name color } } }
        }
      }
    }
  }`,
  { login: USER },
);

// Contributions are returned per year at most, so query every year since the account was created
const firstYear = new Date(user.createdAt).getUTCFullYear();
const thisYear = new Date().getUTCFullYear();
let totalCommits = 0;
let totalContributions = 0;
const days = [];
for (let y = firstYear; y <= thisYear; y++) {
  const { user: u } = await gql(
    `query($login: String!, $from: DateTime!, $to: DateTime!) {
      user(login: $login) {
        contributionsCollection(from: $from, to: $to) {
          totalCommitContributions
          restrictedContributionsCount
          contributionCalendar { totalContributions weeks { contributionDays { date contributionCount } } }
        }
      }
    }`,
    { login: USER, from: `${y}-01-01T00:00:00Z`, to: `${y}-12-31T23:59:59Z` },
  );
  const cc = u.contributionsCollection;
  totalCommits += cc.totalCommitContributions + cc.restrictedContributionsCount;
  totalContributions += cc.contributionCalendar.totalContributions;
  for (const w of cc.contributionCalendar.weeks) days.push(...w.contributionDays);
}

const today = new Date().toISOString().slice(0, 10);
const calendar = days.filter((d) => d.date <= today).sort((a, b) => a.date.localeCompare(b.date));

// ---- Streaks ----
let longest = { len: 0, start: null, end: null };
let run = { len: 0, start: null };
for (const d of calendar) {
  if (d.contributionCount > 0) {
    if (run.len === 0) run.start = d.date;
    run.len++;
    if (run.len > longest.len) longest = { len: run.len, start: run.start, end: d.date };
  } else {
    run = { len: 0, start: null };
  }
}
// Current streak: today may still be empty without breaking it
let current = { len: 0, start: null, end: null };
let i = calendar.length - 1;
if (i >= 0 && calendar[i].contributionCount === 0) i--;
for (; i >= 0 && calendar[i].contributionCount > 0; i--) {
  current.len++;
  current.start = calendar[i].date;
  current.end ??= calendar[i].date;
}
const firstDay = calendar.find((d) => d.contributionCount > 0)?.date ?? calendar[0]?.date ?? today;

// ---- Languages ----
const langs = new Map();
for (const repo of user.repositories.nodes) {
  for (const { size, node } of repo.languages.edges) {
    const l = langs.get(node.name) ?? { size: 0, color: node.color ?? "#888" };
    l.size += size;
    langs.set(node.name, l);
  }
}
const langTotal = [...langs.values()].reduce((s, l) => s + l.size, 0) || 1;
const topLangs = [...langs.entries()].sort((a, b) => b[1].size - a[1].size).slice(0, 6);
const stars = user.repositories.nodes.reduce((s, r) => s + r.stargazerCount, 0);

// ---- SVG builders ----
const frame = (w, h, title, body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(title)}">
  <style>
    .t { font: 600 18px ${FONT}; fill: ${C.title}; }
    .l { font: 600 14px ${FONT}; fill: ${C.text}; }
    .v { font: 700 14px ${FONT}; fill: ${C.text}; }
    .s { font: 400 12px ${FONT}; fill: ${C.muted}; }
    .big { font: 700 28px ${FONT}; fill: ${C.text}; }
  </style>
  <rect x="0.5" y="0.5" rx="4.5" width="${w - 1}" height="${h - 1}" fill="${C.bg}" stroke="${C.border}"/>
  ${title ? `<text x="25" y="35" class="t">${esc(title)}</text>` : ""}
  ${body}
</svg>
`;

function statsCard() {
  const rows = [
    ["⭐", "Total Stars", stars],
    ["📝", "Total Commits", totalCommits],
    ["🔀", "Total PRs", user.pullRequests.totalCount],
    ["❗", "Total Issues", user.issues.totalCount],
    ["📦", "Public Repos", user.repositories.totalCount],
    ["👥", "Followers", user.followers.totalCount],
  ];
  const body = rows
    .map(([icon, label, value], i) => {
      const y = 70 + i * 26;
      return `<text x="25" y="${y}" class="l">${icon}  ${label}:</text><text x="355" y="${y}" class="v" text-anchor="end">${fmt(value)}</text>`;
    })
    .join("\n  ");
  return frame(380, 225, `${user.name || user.login}'s GitHub Stats`, body);
}

function langsCard() {
  const barW = 330;
  let x = 25;
  const bar = topLangs
    .map(([, l]) => {
      const w = (l.size / langTotal) * barW;
      const seg = `<rect x="${x.toFixed(2)}" y="55" width="${w.toFixed(2)}" height="8" fill="${l.color}"/>`;
      x += w;
      return seg;
    })
    .join("");
  const items = topLangs
    .map(([name, l], i) => {
      const cx = i % 2 === 0 ? 25 : 200;
      const y = 95 + Math.floor(i / 2) * 28;
      return `<circle cx="${cx + 5}" cy="${y - 4}" r="5" fill="${l.color}"/><text x="${cx + 16}" y="${y}" class="l">${esc(name)} <tspan class="s">${((l.size / langTotal) * 100).toFixed(1)}%</tspan></text>`;
    })
    .join("\n  ");
  return frame(380, 225, "Most Used Languages", `<clipPath id="r"><rect x="25" y="55" width="${barW}" height="8" rx="4"/></clipPath><g clip-path="url(#r)">${bar}</g>\n  ${items}`);
}

function streakCard() {
  const range = (s) => (s.len ? `${fmtDate(s.start)} - ${fmtDate(s.end)}` : "No streak");
  const col = (cx, value, label, sub, color = C.text) =>
    `<text x="${cx}" y="86" class="big" text-anchor="middle" fill="${color}" style="fill:${color}">${fmt(value)}</text>
  <text x="${cx}" y="128" class="l" text-anchor="middle" style="fill:${C.title}">${label}</text>
  <text x="${cx}" y="150" class="s" text-anchor="middle">${sub}</text>`;
  const body = `<line x1="165" y1="30" x2="165" y2="165" stroke="${C.muted}" stroke-opacity="0.3"/>
  <line x1="330" y1="30" x2="330" y2="165" stroke="${C.muted}" stroke-opacity="0.3"/>
  ${col(82, totalContributions, "Total Contributions", `${fmtDate(firstDay)} - Present`)}
  <circle cx="247" cy="76" r="34" fill="none" stroke="${C.border}" stroke-width="5"/>
  <text x="247" y="40" text-anchor="middle" font-size="18" style="paint-order:stroke" stroke="${C.bg}" stroke-width="6">🔥</text>
  ${col(247, current.len, "Current Streak", range(current))}
  ${col(412, longest.len, "Longest Streak", range(longest))}`;
  return frame(495, 195, "", body);
}

mkdirSync("cards", { recursive: true });
writeFileSync("cards/stats.svg", statsCard());
writeFileSync("cards/top-langs.svg", langsCard());
writeFileSync("cards/streak.svg", streakCard());
console.log(`commits=${totalCommits} contributions=${totalContributions} streak=${current.len} longest=${longest.len} langs=${topLangs.length}`);
