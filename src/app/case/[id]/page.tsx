import type { Metadata } from "next";
import { WarRoom } from "@/components/war-room/war-room";

export const metadata: Metadata = { title: "O-1A War Room" };

export default async function CasePage(props: PageProps<"/case/[id]">) {
  const { id } = await props.params;
  return <WarRoom caseId={id} />;
}
