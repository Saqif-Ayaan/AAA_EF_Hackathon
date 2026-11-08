/**
 * Every tool the source agents use. Registered on the Mastra instance (so they
 * show up in `npx mastra dev`) and used by `npm run try <tool> <input>`.
 */
import { apifyLinkedIn } from "./apify-linkedin";
import { devpostFetch } from "./devpost";
import { exaContents, exaSearch } from "./exa";
import { githubRepo, githubUser } from "./github";
import { logEvent } from "./log-event";
import { openAlexAuthor, openAlexWork, openAlexWorks } from "./openalex";
import { npmDownloads, pypiDownloads } from "./packages";
import { patentCitations } from "./patents";
import { wageBenchmark } from "./wages";

export const tools = {
  exaSearch,
  exaContents,
  apifyLinkedIn,
  githubUser,
  githubRepo,
  openAlexAuthor,
  openAlexWorks,
  devpostFetch,
  logEvent,
  // PART 3 investigate mode
  openAlexWork,
  patentCitations,
  npmDownloads,
  pypiDownloads,
  wageBenchmark,
};

export type ToolName = keyof typeof tools;

export {
  apifyLinkedIn,
  devpostFetch,
  exaContents,
  exaSearch,
  githubRepo,
  githubUser,
  logEvent,
  npmDownloads,
  openAlexAuthor,
  openAlexWork,
  openAlexWorks,
  patentCitations,
  pypiDownloads,
  wageBenchmark,
};
