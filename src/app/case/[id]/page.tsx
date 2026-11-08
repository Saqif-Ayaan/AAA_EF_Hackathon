import type { Metadata } from "next";
import { WarRoom } from "@/components/war-room/war-room";
import { loadReplay } from "@/lib/replay";

export const metadata: Metadata = { title: "O-1A War Room" };

/**
 * /case/[id]            live: polls /api/cases/[id]/events every 500ms
 * /case/[id]?replay=1   plays replays/[id].json on a timer (demo fallback)
 *                       add &speed=2 (up to 20) to play faster
 */
export default async function CasePage(props: PageProps<"/case/[id]">) {
  const { id } = await props.params;
  const sp = await props.searchParams;
  const replay = sp.replay === "1" ? await loadReplay(id) : undefined;
  const speedParam = Number(sp.speed);
  const speed = Number.isFinite(speedParam) && speedParam > 0 ? Math.min(speedParam, 20) : 1;
  return <WarRoom caseId={id} replay={replay} speed={speed} />;
}
