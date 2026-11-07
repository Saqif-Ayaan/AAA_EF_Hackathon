/**
 * Run one Mastra tool from the command line and print its raw result.
 *
 *   npm run try                                   list the tools with examples
 *   npm run try <tool> <input> [key=value ...]
 *
 * <input> is a plain value for the tool's main field (query, username, url...),
 * or a JSON object with all the fields. key=value sets any other field: values
 * are parsed as JSON when they can be (numbers, true/false), and list fields
 * accept comma-separated values. Keys come from .env.local, then .env.
 */
import type { z } from "zod";
import type { ToolName } from "../src/mastra/tools";

const MAIN_FIELD: Record<ToolName, string> = {
  exaSearch: "query",
  exaContents: "urls",
  apifyLinkedIn: "profileUrl",
  githubUser: "username",
  githubRepo: "repo",
  openAlexAuthor: "name",
  openAlexWorks: "authorId",
  devpostFetch: "url",
  logEvent: "applicantId",
};

const EXAMPLES: Record<ToolName, string> = {
  exaSearch: `npm run try exaSearch "Andrej Karpathy" numResults=3 includeDomains=devpost.com,github.com`,
  exaContents: `npm run try exaContents https://karpathy.ai`,
  apifyLinkedIn: `npm run try apifyLinkedIn https://www.linkedin.com/in/<handle> forceRefresh=true`,
  githubUser: `npm run try githubUser torvalds`,
  githubRepo: `npm run try githubRepo karpathy/nanoGPT username=karpathy`,
  openAlexAuthor: `npm run try openAlexAuthor "Andrej Karpathy" limit=3`,
  openAlexWorks: `npm run try openAlexWorks A5009290031 limit=5`,
  devpostFetch: `npm run try devpostFetch https://devpost.com/software/dockerc`,
  logEvent: `npm run try logEvent <applicantId> agentId=github type=status status=searching message="Checking repos"`,
};

/** The schema type under optional()/default()/nullable() wrappers. */
function baseType(field: z.ZodType | undefined): string | undefined {
  let def = (field as { _zod?: { def: { type: string; innerType?: z.ZodType } } } | undefined)?._zod?.def;
  while (def && ["optional", "default", "nullable", "prefault"].includes(def.type) && def.innerType) {
    def = (def.innerType as unknown as { _zod: { def: typeof def } })._zod.def;
  }
  return def?.type;
}

function coerce(field: z.ZodType | undefined, raw: string): unknown {
  const type = baseType(field);
  if (type === "string" || type === "enum") return raw;
  if (type === "array" && !raw.trim().startsWith("[")) return raw.split(",").map((s) => s.trim()).filter(Boolean);
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

async function main() {
  for (const file of [".env.local", ".env"]) {
    try {
      process.loadEnvFile(file); // never overrides a var that's already set, so .env.local wins
    } catch {
      // file missing
    }
  }
  // Imported after the env is loaded (some modules read it at import time).
  const { tools } = await import("../src/mastra/tools");

  const [name, input, ...rest] = process.argv.slice(2);
  if (!name || !(name in tools)) {
    if (name) console.error(`Unknown tool "${name}".\n`);
    console.error("Usage: npm run try <tool> <input> [key=value ...]\n\nTools:");
    for (const [key, t] of Object.entries(tools)) {
      console.error(`  ${key.padEnd(15)} ${t.description.split(". ")[0].replace(/\.$/, "")}.`);
      console.error(`  ${"".padEnd(15)} e.g. ${EXAMPLES[key as ToolName]}\n`);
    }
    process.exitCode = name ? 1 : 0;
    return;
  }

  const toolName = name as ToolName;
  const tool = tools[toolName];
  const shape = (tool.inputSchema as unknown as z.ZodObject).shape as Record<string, z.ZodType>;

  let args: Record<string, unknown> = {};
  if (input?.trim().startsWith("{")) args = JSON.parse(input);
  else if (input !== undefined) args[MAIN_FIELD[toolName]] = coerce(shape[MAIN_FIELD[toolName]], input);
  for (const pair of rest) {
    const eq = pair.indexOf("=");
    if (eq < 1) throw new Error(`Expected key=value, got "${pair}"`);
    const key = pair.slice(0, eq);
    args[key] = coerce(shape[key], pair.slice(eq + 1));
  }

  console.error(`→ ${toolName} ${JSON.stringify(args)}`);
  const started = Date.now();
  const execute = tool.execute as (input: unknown, context: object) => Promise<unknown>;
  const result = await execute(args, {});
  const secs = ((Date.now() - started) / 1000).toFixed(1);

  console.log(JSON.stringify(result, null, 2));
  if (result && typeof result === "object" && (result as { error?: unknown }).error === true) {
    console.error(`✗ ${toolName} returned a validation error (${secs}s)`);
    process.exitCode = 1;
    return;
  }
  console.error(`✓ ${toolName} (${secs}s)`);
}

main().catch((err) => {
  console.error(`✗ ${err instanceof Error ? err.message : err}`);
  process.exitCode = 1;
});
