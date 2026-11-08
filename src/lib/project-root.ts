/**
 * `mastra dev` runs its server from src/mastra/public (and builds into
 * .mastra/output), so relative paths like "file:local.db" or ".cache/" would
 * land in the wrong folder there. These helpers resolve them against the
 * project root instead, so the Next app, `npm run try` and the Mastra
 * playground all share the same files.
 */
import { existsSync } from "node:fs";
import path from "node:path";

let root: string | undefined;

/** The nearest folder with a package.json, ignoring the generated one inside .mastra/. */
export function projectRoot(): string {
  if (root) return root;
  const parts = path.resolve(/*turbopackIgnore: true*/ process.cwd()).split(path.sep);
  const dotMastra = parts.lastIndexOf(".mastra");
  let dir = dotMastra > 0 ? parts.slice(0, dotMastra).join(path.sep) : parts.join(path.sep);
  while (!existsSync(path.join(dir, "package.json"))) {
    const parent = path.dirname(dir);
    if (parent === dir) return (root = process.cwd());
    dir = parent;
  }
  return (root = dir);
}

/** "file:local.db" → "file:<project root>/local.db". Other URLs pass through unchanged. */
export function resolveFileUrl(url: string): string {
  if (!url.startsWith("file:")) return url;
  const file = url.slice("file:".length);
  if (file.startsWith("/") || path.isAbsolute(file)) return url;
  return `file:${path.join(/*turbopackIgnore: true*/ projectRoot(), file).split(path.sep).join("/")}`;
}
