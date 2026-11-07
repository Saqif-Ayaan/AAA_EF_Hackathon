import type { Metadata } from "next";
import { IntakeForm } from "./intake-form";

export const metadata: Metadata = {
  title: "O-1A application",
  description: "Structured O-1A intake: tell us about your achievements and we'll verify them and build your case.",
};

export default function ApplyPage() {
  return <IntakeForm />;
}
