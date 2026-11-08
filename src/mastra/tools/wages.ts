/**
 * PART 3: prevailing-wage benchmark, from a preloaded table (no live API).
 *
 * src/data/wage-benchmarks.json holds DOL OFLC prevailing wages (Levels 1–4,
 * wage year July 2026 – June 2027) for common tech/science occupations in the
 * main US tech metros, extracted from the official OFLC_Wages_2026-27.zip.
 * The AAO compared salary against Level 4 in FEB142024_01D8101, so Level 4 is
 * the benchmark.
 *
 * Code only, no LLM: the `wages` investigator calls benchmarkSalary() directly.
 */
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import table from "../../data/wage-benchmarks.json";

type Levels = { level1: number; level2: number; level3: number; level4: number };
type Table = {
  source: string;
  sourceUrl: string;
  wageYear: string;
  occupations: Record<string, string>;
  areas: Record<string, { name: string; wages: Record<string, Levels> }>;
};
const WAGES = table as Table;

/** Job-title keywords → SOC code, most specific first. A heuristic: the note says which rule matched. */
const TITLE_RULES: [RegExp, string][] = [
  [/\b(ceo|chief executive|founder|co-?founder|president)\b/i, "11-1011"],
  [/\b(cto|chief technology|vp,? (of )?engineering|head of engineering|director of engineering|engineering manager|it manager)\b/i, "11-3021"],
  [/\b(research scientist|ai researcher|ml researcher|research engineer|computer scientist)\b/i, "15-1221"],
  [/\b(data scientist)\b/i, "15-2051"],
  [/\b(statistician)\b/i, "15-2041"],
  [/\b(security|infosec)\b/i, "15-1212"],
  [/\b(hardware|asic|fpga|chip|silicon|rtl)\b/i, "17-2061"],
  [/\b(electronics engineer)\b/i, "17-2072"],
  [/\b(electrical engineer)\b/i, "17-2071"],
  [/\b(mechanical engineer)\b/i, "17-2141"],
  [/\b(aerospace)\b/i, "17-2011"],
  [/\b(biomedical|bioengineer)\b/i, "17-2031"],
  [/\b(physicist)\b/i, "19-2012"],
  [/\b(medical scientist)\b/i, "19-1042"],
  [/\b(quant|financial analyst|investment analyst)\b/i, "13-2051"],
  [/\b(qa|quality assurance|test engineer)\b/i, "15-1253"],
  [/\b(software|developer|swe|programmer|machine learning|ml engineer|ai engineer|full[- ]?stack|backend|frontend|engineer)\b/i, "15-1252"],
];

/** City names that sit in a metro whose name doesn't contain them. */
const CITY_ALIASES: Record<string, string> = {
  "palo alto": "San Jose",
  "mountain view": "San Jose",
  sunnyvale: "San Jose",
  cupertino: "San Jose",
  "santa clara": "San Jose",
  "los gatos": "San Jose",
  "menlo park": "San Francisco",
  "redwood city": "San Francisco",
  "san mateo": "San Francisco",
  berkeley: "San Francisco",
  "south san francisco": "San Francisco",
  "bay area": "San Francisco",
  sf: "San Francisco",
  nyc: "New York",
  manhattan: "New York",
  brooklyn: "New York",
  "jersey city": "New York",
  cambridge: "Boston",
  somerville: "Boston",
  bellevue: "Seattle",
  redmond: "Seattle",
  kirkland: "Seattle",
  "santa monica": "Los Angeles",
  irvine: "Los Angeles",
  pasadena: "Los Angeles",
  arlington: "Washington",
  "washington dc": "Washington",
  "washington, dc": "Washington",
  boulder: "Denver",
  "chapel hill": "Durham",
};

export function socForTitle(title: string): { socCode: string; rule: string } | null {
  for (const [re, soc] of TITLE_RULES) {
    const m = title.match(re);
    if (m) return { socCode: soc, rule: `title contains "${m[0]}"` };
  }
  return null;
}

export function areaForLocation(location: string): { areaCode: string; name: string } | null {
  const loc = location.toLowerCase();
  const alias = Object.entries(CITY_ALIASES)
    .sort((a, b) => b[0].length - a[0].length)
    .find(([city]) => new RegExp(`\\b${city.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(loc))?.[1];
  let best: { areaCode: string; name: string; at: number } | null = null;
  for (const [code, area] of Object.entries(WAGES.areas)) {
    if (alias) {
      if (area.name.startsWith(alias)) return { areaCode: code, name: area.name };
      continue;
    }
    // "Seattle, Washington" names two metros' cities; the one mentioned first wins.
    const cities = area.name.split(",")[0].split("-").map((c) => c.trim().toLowerCase());
    for (const c of cities) {
      const at = c.length > 3 ? loc.indexOf(c) : -1;
      if (at >= 0 && (!best || at < best.at)) best = { areaCode: code, name: area.name, at };
    }
  }
  return best ? { areaCode: best.areaCode, name: best.name } : null;
}

const STATES: Record<string, string> = {
  california: "CA", washington: "WA", "new york": "NY", "new jersey": "NJ", massachusetts: "MA", texas: "TX",
  illinois: "IL", colorado: "CO", georgia: "GA", florida: "FL", pennsylvania: "PA", "north carolina": "NC",
  oregon: "OR", minnesota: "MN", utah: "UT", arizona: "AZ", michigan: "MI", virginia: "VA", maryland: "MD",
};

/** "California" / "CA" / "Remote, CA" → the preloaded metros in that state. Used when only a state is known. */
export function areasInState(location: string): { state: string; areas: { areaCode: string; name: string }[] } | null {
  const loc = location.trim().toLowerCase();
  const fromName = Object.entries(STATES).find(([name]) => new RegExp(`\\b${name}\\b`).test(loc))?.[1];
  const fromAbbr = location.match(/\b([A-Z]{2})\b/)?.[1];
  const state = fromName ?? (fromAbbr && Object.values(STATES).includes(fromAbbr) ? fromAbbr : null);
  if (!state) return null;
  const areas = Object.entries(WAGES.areas)
    .filter(([, a]) => (a.name.split(", ")[1] ?? "").split("-").includes(state))
    .map(([areaCode, a]) => ({ areaCode, name: a.name }));
  return areas.length ? { state, areas } : null;
}

export type WageBenchmark = {
  socCode: string;
  occupation: string;
  areaCode: string;
  areaName: string;
  levels: Levels;
  salary: number | null;
  /** Highest level the salary reaches: 0 = below Level 1. */
  levelReached: number | null;
  /** salary / Level 4, e.g. 0.85. */
  ratioToLevel4: number | null;
  wageYear: string;
  source: string;
  sourceUrl: string;
  matchNotes: string[];
};

/** Look up the OFLC Level 1–4 wages for an occupation in an area, and place a salary against them. */
export function benchmarkSalary(input: {
  socCode?: string | null;
  jobTitle?: string | null;
  areaCode?: string | null;
  location?: string | null;
  salary?: number | null;
}): WageBenchmark | { error: string } {
  const notes: string[] = [];
  let soc = input.socCode?.trim() || null;
  if (soc && !WAGES.occupations[soc]) return { error: `SOC ${soc} is not in the preloaded table (${Object.keys(WAGES.occupations).length} occupations)` };
  if (!soc && input.jobTitle) {
    const m = socForTitle(input.jobTitle);
    if (m) {
      soc = m.socCode;
      notes.push(`Occupation ${m.socCode} (${WAGES.occupations[m.socCode]}) chosen because the ${m.rule}.`);
    }
  }
  if (!soc) return { error: `Couldn't map job title "${input.jobTitle ?? ""}" to an occupation in the preloaded table` };

  let area = input.areaCode && WAGES.areas[input.areaCode] ? { areaCode: input.areaCode, name: WAGES.areas[input.areaCode].name } : null;
  if (!area && input.location) {
    area = areaForLocation(input.location);
    if (area) notes.push(`Area "${area.name}" matched from location "${input.location}".`);
  }
  if (!area && input.location) {
    // Only a state is known. Lax: benchmark against the LOWEST Level 4 among its metros, so "below Level 4"
    // holds wherever in the state the job is.
    const inState = areasInState(input.location);
    const withWage = inState?.areas.filter((a) => WAGES.areas[a.areaCode].wages[soc!]) ?? [];
    if (inState && withWage.length) {
      const lowest = withWage.reduce((lo, a) => (WAGES.areas[a.areaCode].wages[soc!].level4 < WAGES.areas[lo.areaCode].wages[soc!].level4 ? a : lo));
      const highest = Math.max(...withWage.map((a) => WAGES.areas[a.areaCode].wages[soc!].level4));
      area = lowest;
      notes.push(
        `Only the state (${inState.state}) is known, so this uses the lowest Level 4 among its ${withWage.length} preloaded metros (${lowest.name}); Level 4 there ranges up to $${highest.toLocaleString("en-US")}.`,
      );
    }
  }
  if (!area) return { error: `Couldn't map location "${input.location ?? ""}" to one of the ${Object.keys(WAGES.areas).length} preloaded metro areas or their states` };

  const levels = WAGES.areas[area.areaCode].wages[soc];
  if (!levels) return { error: `No OFLC wage for ${soc} in ${area.name}` };

  const salary = typeof input.salary === "number" && input.salary > 0 ? input.salary : null;
  const order = [levels.level1, levels.level2, levels.level3, levels.level4];
  return {
    socCode: soc,
    occupation: WAGES.occupations[soc],
    areaCode: area.areaCode,
    areaName: area.name,
    levels,
    salary,
    levelReached: salary === null ? null : order.filter((v) => salary >= v).length,
    ratioToLevel4: salary === null ? null : Math.round((salary / levels.level4) * 100) / 100,
    wageYear: WAGES.wageYear,
    source: WAGES.source,
    sourceUrl: WAGES.sourceUrl,
    matchNotes: notes,
  };
}

export const wageBenchmark = createTool({
  id: "wageBenchmark",
  description:
    "DOL OFLC prevailing wages (Levels 1-4, annual USD) for an occupation in a US metro area, from a preloaded table. " +
    "Pass a SOC code or a job title, an area code or a location, and optionally a salary to place it against the levels. " +
    "Level 4 is the benchmark the AAO used.",
  inputSchema: z.object({
    socCode: z.string().optional().describe('SOC code, e.g. "15-1252" (Software Developers)'),
    jobTitle: z.string().optional().describe('Job title, used when no SOC code is given, e.g. "Senior ML Engineer"'),
    areaCode: z.string().optional().describe('OFLC area code, e.g. "41940" (San Jose)'),
    location: z.string().optional().describe('City/metro, e.g. "Palo Alto, CA"'),
    salary: z.number().optional().describe("Annual compensation in USD"),
  }),
  execute: async (input) => {
    const result = benchmarkSalary(input);
    if ("error" in result) throw new Error(result.error);
    return result;
  },
});
