/**
 * Every tool the source agents use. Registered on the Mastra instance (so they
 * show up in `npx mastra dev`) and used by `npm run try <tool> <input>`.
 */
import { apifyLinkedIn } from "./apify-linkedin";
import { devpostFetch } from "./devpost";
import { exaContents, exaSearch } from "./exa";
import { githubRepo, githubUser } from "./github";
import { logEvent } from "./log-event";
import { openAlexAuthor, openAlexWorks } from "./openalex";

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
  openAlexAuthor,
  openAlexWorks,
};
