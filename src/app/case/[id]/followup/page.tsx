import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getApplicant } from "@/lib/case-data";
import { FollowupChat } from "./followup-chat";

export const metadata: Metadata = {
  title: "Follow-up questions",
  description: "Answer the questions our verification raised about your O-1A application.",
};

export default async function FollowupPage(props: PageProps<"/case/[id]/followup">) {
  const { id } = await props.params;
  const applicant = await getApplicant(id);
  if (!applicant) notFound();
  return <FollowupChat applicantId={applicant.id} applicantName={applicant.name} />;
}
