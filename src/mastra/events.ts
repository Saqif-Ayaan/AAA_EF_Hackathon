/**
 * War-room event logging for the pipeline.
 *
 * Every event goes through the logEvent tool (one code path into the `events`
 * table) and logging never throws: a hiccup writing an event must not fail a
 * vetting run.
 *
 * toolEventHooks() wraps every tool call an agent makes, so tool calls and
 * results are logged automatically with a readable action line, the URL being
 * read, a short "found" result, and a progress value that creeps toward 90%.
 */
import type { ToolHooks } from "@mastra/core/tools";
import type { AgentId, AgentStatus, EventType, NewAgentEvent } from "../lib/schemas";
import { logEvent } from "./tools/log-event";

export async function emit(event: NewAgentEvent): Promise<void> {
  try {
    const execute = logEvent.execute as (input: NewAgentEvent, context: object) => Promise<unknown>;
    const result = (await execute(event, {})) as { error?: boolean; message?: string } | undefined;
    if (result?.error) console.error(`[events] rejected: ${result.message}`);
  } catch (err) {
    console.error(`[events] ${err instanceof Error ? err.message : err}`);
  }
}

type Extra = {
  status?: AgentStatus;
  currentAction?: string;
  progress?: number;
  url?: string | null;
  found?: string | null;
};

/** emit() bound to one applicant and one agent. */
export function eventLogger(applicantId: string, agentId: AgentId) {
  return (type: EventType, message: string, extra: Extra = {}) =>
    emit({
      applicantId,
      agentId,
      type,
      message,
      ...extra,
      ...(extra.progress !== undefined ? { progress: Math.max(0, Math.min(100, Math.round(extra.progress))) } : {}),
    });
}

const truncate = (s: string, max = 140) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);
const READING_TOOLS = new Set(["exaContents", "devpostFetch", "apifyLinkedIn"]);

type In = Record<string, unknown>;
type Out = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v : "");
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const num = (v: unknown) => (typeof v === "number" ? v : 0);
const first = (v: unknown): Out => (arr(v)[0] as Out) ?? {};

/** "Searching the web for …" + the URL being opened, for a tool call. */
export function describeToolCall(toolName: string, input: In): { action: string; url: string | null } {
  switch (toolName) {
    case "exaSearch": {
      const domains = arr(input.includeDomains).map(String);
      return { action: `Searching ${domains.length ? domains.join(", ") : "the web"} for "${str(input.query)}"`, url: null };
    }
    case "exaContents": {
      const urls = arr(input.urls).map(String);
      return { action: `Reading ${urls.length === 1 ? urls[0] : `${urls.length} pages`}`, url: urls[0] ?? null };
    }
    case "apifyLinkedIn":
      return {
        action: `Searching LinkedIn for "${[str(input.fullName), str(input.company)].filter(Boolean).join(" ")}"`,
        url: str(input.profileUrl) || null,
      };
    case "githubUser":
      return { action: `Looking up GitHub user ${str(input.username)}`, url: `https://github.com/${str(input.username).replace(/^.*github\.com\//, "")}` };
    case "githubRepo":
      return { action: `Checking GitHub repo ${str(input.repo)}`, url: `https://github.com/${str(input.repo).replace(/^.*github\.com\//, "")}` };
    case "openAlexAuthor":
      return { action: `Searching OpenAlex for "${str(input.name)}"`, url: null };
    case "openAlexWorks":
      return { action: `Listing OpenAlex works for author ${str(input.authorId)}`, url: `https://openalex.org/${str(input.authorId).replace(/^.*openalex\.org\//, "")}` };
    case "devpostFetch":
      return { action: `Reading Devpost page ${str(input.url)}`, url: str(input.url) || null };
    default:
      return { action: `Calling ${toolName}`, url: null };
  }
}

const n = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/** A plain-English sentence about what a tool call returned, for the agent card's list of finds. */
export function summarizeToolResult(toolName: string, output: Out): string {
  switch (toolName) {
    case "exaSearch": {
      const results = arr(output.results);
      return results.length
        ? `Found ${n(results.length, "web result")}. Top hit: "${str(first(results).title)}".`
        : "No web results for that search.";
    }
    case "exaContents": {
      const failed = arr(output.failed).length;
      return `Opened ${n(arr(output.pages).length, "page")}${failed ? `; ${n(failed, "page")} couldn't be opened` : ""}.`;
    }
    case "apifyLinkedIn": {
      if (output.source === "apify" && output.matched) return `Found the LinkedIn profile (matched by ${str(output.matchedBy)}).`;
      if (output.source === "apify") return `Couldn't match a LinkedIn profile among ${n(arr(output.candidates).length, "search result")}.`;
      return `LinkedIn couldn't be read directly, so it used ${n(arr(output.exaResults).length, "web search result")} instead.`;
    }
    case "githubUser":
      return `GitHub user ${str(output.login)} has ${n(num(output.publicRepos), "public repo")}, ${num(output.totalStarsOnOwnedRepos)} stars across the repos they own, and ${n(num(output.followers), "follower")}.`;
    case "githubRepo": {
      const user = output.user as Out | null;
      const share = user
        ? ` ${str(user.login)} ${user.isOwner ? "owns it and " : ""}made ${n(num(user.commits), "commit")} (${num(user.sharePct)}% of the total).`
        : "";
      return `The repo ${str(output.fullName)} has ${num(output.stars)} stars.${share}`;
    }
    case "openAlexAuthor": {
      const top = first(output.candidates);
      return arr(output.candidates).length
        ? `OpenAlex has ${n(num(output.totalMatches), "author")} with that name. Closest match: ${str(top.displayName)} (${n(num(top.worksCount), "paper")}, ${n(num(top.citedByCount), "citation")}).`
        : "OpenAlex has no author with that name.";
    }
    case "openAlexWorks":
      return `This author has ${n(num(output.totalWorks), "paper")} on OpenAlex; the ${arr(output.works).length} listed have ${n(num(output.citationsInList), "citation")} between them.`;
    case "devpostFetch": {
      const hackathon = output.hackathon as Out | null;
      if (hackathon?.participants) return `${str(hackathon.name)} had ${n(num(hackathon.participants), "participant")}.`;
      const winners = arr(output.projects).filter((p) => (p as Out).winner).length;
      return `Read a Devpost ${str(output.pageType)} page: ${n(arr(output.projects).length, "project")}, ${n(winners, "winner")}${output.via === "exa" ? " (found via web search)" : ""}.`;
    }
    default:
      return "Done.";
  }
}

/**
 * Hooks for agent.generate(): log a tool_call before and a tool_result after
 * every tool call. Progress climbs from `start` toward 90 with each call.
 */
export function toolEventHooks(applicantId: string, agentId: AgentId, start = 10): ToolHooks & { progress: () => number } {
  const log = eventLogger(applicantId, agentId);
  let progress = start;
  const urls = new Map<string, string | null>();
  return {
    progress: () => progress,
    beforeToolCall: async ({ toolName, input }) => {
      const { action, url } = describeToolCall(toolName, (input ?? {}) as In);
      urls.set(toolName, url);
      progress += (90 - progress) * 0.2;
      await log("tool_call", action, {
        status: READING_TOOLS.has(toolName) ? "reading" : "searching",
        currentAction: action,
        progress,
        url,
      });
    },
    afterToolCall: async ({ toolName, output, error }) => {
      const found = error
        ? `Failed: ${truncate(error instanceof Error ? error.message : String(error), 100)}`
        : truncate(summarizeToolResult(toolName, (output ?? {}) as Out), 260);
      await log("tool_result", `${toolName}: ${found}`, { found, progress, url: urls.get(toolName) ?? null });
    },
  };
}
