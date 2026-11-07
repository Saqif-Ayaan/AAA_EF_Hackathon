/**
 * GitHub REST API: a user's profile + repos, and one repo's stars + contributors.
 * Works without a token (60 requests/hour); set GITHUB_TOKEN for 5,000/hour.
 */
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { fetchJson, HttpError } from "./http";

const API = "https://api.github.com";

async function gh<T>(path: string, signal?: AbortSignal): Promise<T> {
  const token = process.env.GITHUB_TOKEN?.trim();
  try {
    return await fetchJson<T>(`${API}${path}`, {
      signal,
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "o1-intake-agent",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) throw new Error(`GitHub: not found (${path})`);
    if (err instanceof HttpError && (err.status === 403 || err.status === 429)) {
      const reset = Number(err.headers.get("x-ratelimit-reset"));
      const when = reset ? ` until ${new Date(reset * 1000).toLocaleTimeString()}` : "";
      throw new Error(`GitHub rate limit hit${when}. ${token ? "" : "Set GITHUB_TOKEN to raise it. "}(${err.message})`);
    }
    throw err;
  }
}

/** "octocat", "@octocat" or "https://github.com/octocat" → "octocat". */
function parseUsername(input: string): string {
  const m = input.trim().match(/^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/?#]+)/i);
  return (m ? m[1] : input.trim()).replace(/^@/, "");
}

/** "owner/repo" or any github.com/owner/repo/... URL → { owner, repo }. */
function parseRepo(input: string): { owner: string; repo: string } {
  const m = input
    .trim()
    .match(/^(?:(?:https?:\/\/)?(?:www\.)?github\.com\/)?([^/\s]+)\/([^/\s?#]+)/i);
  if (!m) throw new Error(`Expected "owner/repo" or a github.com repo URL, got "${input}"`);
  return { owner: m[1], repo: m[2].replace(/\.git$/i, "") };
}

type GhUser = {
  login: string;
  name: string | null;
  company: string | null;
  bio: string | null;
  blog: string | null;
  location: string | null;
  twitter_username: string | null;
  followers: number;
  following: number;
  public_repos: number;
  created_at: string;
  html_url: string;
};

type GhRepo = {
  full_name: string;
  html_url: string;
  description: string | null;
  fork: boolean;
  owner: { login: string; type: string };
  parent?: { full_name: string };
  stargazers_count: number;
  forks_count: number;
  subscribers_count?: number;
  open_issues_count: number;
  language: string | null;
  topics?: string[];
  license: { spdx_id: string } | null;
  homepage: string | null;
  archived: boolean;
  created_at: string;
  pushed_at: string;
};

const RepoSummary = z.object({
  fullName: z.string(),
  description: z.string().nullable(),
  stars: z.number(),
  forks: z.number(),
  language: z.string().nullable(),
  isFork: z.boolean(),
  pushedAt: z.string(),
  url: z.string(),
});

export const githubUser = createTool({
  id: "githubUser",
  description:
    "Look up a GitHub user: profile (name, company, bio, followers), public orgs, total stars on repos they own, " +
    "and their top repos by stars.",
  inputSchema: z.object({
    username: z.string().trim().min(1).describe('GitHub username or profile URL, e.g. "octocat"'),
  }),
  outputSchema: z.object({
    login: z.string(),
    name: z.string().nullable(),
    company: z.string().nullable(),
    bio: z.string().nullable(),
    blog: z.string().nullable(),
    location: z.string().nullable(),
    twitter: z.string().nullable(),
    followers: z.number(),
    following: z.number(),
    publicRepos: z.number(),
    createdAt: z.string(),
    url: z.string(),
    orgs: z.array(z.string()),
    totalStarsOnOwnedRepos: z.number(),
    topRepos: z.array(RepoSummary),
  }),
  execute: async ({ username }, { abortSignal }) => {
    const login = parseUsername(username);
    const user = await gh<GhUser>(`/users/${encodeURIComponent(login)}`, abortSignal);

    // Up to 300 owned repos (3 pages) is plenty for ranking by stars.
    const repos: GhRepo[] = [];
    for (let page = 1; page <= 3; page++) {
      const batch = await gh<GhRepo[]>(
        `/users/${encodeURIComponent(user.login)}/repos?type=owner&sort=pushed&per_page=100&page=${page}`,
        abortSignal,
      );
      repos.push(...batch);
      if (batch.length < 100) break;
    }
    const orgs = await gh<{ login: string }[]>(`/users/${encodeURIComponent(user.login)}/orgs`, abortSignal);

    const owned = repos.filter((r) => !r.fork);
    return {
      login: user.login,
      name: user.name,
      company: user.company,
      bio: user.bio,
      blog: user.blog || null,
      location: user.location,
      twitter: user.twitter_username,
      followers: user.followers,
      following: user.following,
      publicRepos: user.public_repos,
      createdAt: user.created_at,
      url: user.html_url,
      orgs: orgs.map((o) => o.login),
      totalStarsOnOwnedRepos: owned.reduce((sum, r) => sum + r.stargazers_count, 0),
      topRepos: [...repos]
        .sort((a, b) => b.stargazers_count - a.stargazers_count)
        .slice(0, 10)
        .map((r) => ({
          fullName: r.full_name,
          description: r.description,
          stars: r.stargazers_count,
          forks: r.forks_count,
          language: r.language,
          isFork: r.fork,
          pushedAt: r.pushed_at,
          url: r.html_url,
        })),
    };
  },
});

export const githubRepo = createTool({
  id: "githubRepo",
  description:
    "Look up a GitHub repo: owner, stars, forks, topics, and top contributors by commit count. " +
    "Pass username to see whether that person owns the repo and their share of commits.",
  inputSchema: z.object({
    repo: z.string().trim().min(1).describe('"owner/repo" or a github.com repo URL'),
    username: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe("Applicant's GitHub username, to report their ownership and commit share"),
  }),
  outputSchema: z.object({
    fullName: z.string(),
    url: z.string(),
    description: z.string().nullable(),
    owner: z.object({ login: z.string(), type: z.string() }),
    isFork: z.boolean(),
    forkedFrom: z.string().nullable(),
    stars: z.number(),
    forks: z.number(),
    watchers: z.number().nullable(),
    openIssues: z.number(),
    language: z.string().nullable(),
    topics: z.array(z.string()),
    license: z.string().nullable(),
    homepage: z.string().nullable(),
    archived: z.boolean(),
    createdAt: z.string(),
    pushedAt: z.string(),
    contributorsListed: z.number().describe("Contributors returned (max 100)"),
    totalCommitsListed: z.number(),
    topContributors: z.array(z.object({ login: z.string(), commits: z.number(), sharePct: z.number() })),
    user: z
      .object({
        login: z.string(),
        isOwner: z.boolean(),
        commits: z.number(),
        sharePct: z.number(),
        rank: z.number().nullable(),
      })
      .nullable(),
  }),
  execute: async ({ repo, username }, { abortSignal }) => {
    const { owner, repo: name } = parseRepo(repo);
    const path = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
    const r = await gh<GhRepo>(path, abortSignal);

    // Commit counts on the default branch. Empty repos return 204 (no body); huge ones can 403.
    let contributors: { login?: string; contributions: number; type?: string }[] = [];
    try {
      contributors = (await gh<typeof contributors | null>(`${path}/contributors?per_page=100`, abortSignal)) ?? [];
    } catch (err) {
      if (!(err instanceof SyntaxError) && !String(err).includes("too large")) throw err;
    }
    contributors = contributors.filter((c) => c.login && c.type !== "Bot");
    const total = contributors.reduce((sum, c) => sum + c.contributions, 0);
    const pct = (n: number) => (total ? Math.round((n / total) * 1000) / 10 : 0);

    let user = null;
    if (username) {
      const login = parseUsername(username).toLowerCase();
      const idx = contributors.findIndex((c) => c.login!.toLowerCase() === login);
      const commits = idx >= 0 ? contributors[idx].contributions : 0;
      user = {
        login: parseUsername(username),
        isOwner: r.owner.login.toLowerCase() === login,
        commits,
        sharePct: pct(commits),
        rank: idx >= 0 ? idx + 1 : null,
      };
    }

    return {
      fullName: r.full_name,
      url: r.html_url,
      description: r.description,
      owner: { login: r.owner.login, type: r.owner.type },
      isFork: r.fork,
      forkedFrom: r.parent?.full_name ?? null,
      stars: r.stargazers_count,
      forks: r.forks_count,
      watchers: r.subscribers_count ?? null,
      openIssues: r.open_issues_count,
      language: r.language,
      topics: r.topics ?? [],
      license: r.license?.spdx_id ?? null,
      homepage: r.homepage || null,
      archived: r.archived,
      createdAt: r.created_at,
      pushedAt: r.pushed_at,
      contributorsListed: contributors.length,
      totalCommitsListed: total,
      topContributors: contributors.slice(0, 10).map((c) => ({
        login: c.login!,
        commits: c.contributions,
        sharePct: pct(c.contributions),
      })),
      user,
    };
  },
});
