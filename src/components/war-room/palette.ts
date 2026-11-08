/**
 * Accent palettes for the war room, remembered per browser. Uses
 * useSyncExternalStore so the server renders the default and the client
 * switches to the saved palette right after hydration (no mismatch).
 */
import { useSyncExternalStore } from "react";

export const PALETTES = [
  { id: "ion", label: "Ion", accent: "#3df5ff", accent2: "#9b8cff" },
  { id: "acid", label: "Acid", accent: "#24fa7a", accent2: "#d7ff3a" },
  { id: "plasma", label: "Plasma", accent: "#c77dff", accent2: "#ff5fd2" },
  { id: "flare", label: "Flare", accent: "#ff7a45", accent2: "#ffd23f" },
] as const;

export type Palette = (typeof PALETTES)[number];
export type PaletteId = Palette["id"];

const KEY = "o1-war-room-palette";
const DEFAULT: PaletteId = "ion";
const listeners = new Set<() => void>();
let memory: PaletteId | null = null; // used when storage is blocked

const isPaletteId = (v: unknown): v is PaletteId => PALETTES.some((p) => p.id === v);

function read(): PaletteId {
  if (memory) return memory;
  try {
    const v = window.localStorage.getItem(KEY);
    return isPaletteId(v) ? v : DEFAULT;
  } catch {
    return DEFAULT;
  }
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) cb();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}

export function setPalette(id: PaletteId) {
  memory = id;
  try {
    window.localStorage.setItem(KEY, id);
  } catch {
    // private mode / blocked storage: the in-memory value still works for this tab
  }
  listeners.forEach((l) => l());
}

export function usePalette(): Palette {
  const id = useSyncExternalStore(subscribe, read, () => DEFAULT);
  return PALETTES.find((p) => p.id === id) ?? PALETTES[0];
}
