/**
 * POST /api/cv  (multipart form-data, field "file" = a PDF)
 * Extracts the CV's text on the server so it can be stored as applicant.cvText.
 */
import { PDFParse } from "pdf-parse";

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_CHARS = 50_000; // keeps agent prompts a sane size

export type CvExtractResponse = { text: string; pages: number; truncated: boolean };

export async function POST(request: Request) {
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");

  if (!(file instanceof File)) {
    return Response.json({ error: "Attach a PDF file" }, { status: 400 });
  }
  if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
    return Response.json({ error: "The CV must be a PDF" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return Response.json({ error: "The PDF is larger than 10 MB" }, { status: 413 });
  }

  const parser = new PDFParse({ data: new Uint8Array(await file.arrayBuffer()) });
  try {
    const result = await parser.getText({ pageJoiner: "" }); // no "-- 1 of 3 --" page markers
    const fullText = result.text.trim();
    if (!fullText) {
      return Response.json(
        { error: "No text found in that PDF (is it a scanned image?)" },
        { status: 422 },
      );
    }
    const body: CvExtractResponse = {
      text: fullText.slice(0, MAX_CHARS),
      pages: result.total,
      truncated: fullText.length > MAX_CHARS,
    };
    return Response.json(body);
  } catch (error) {
    console.error("CV extraction failed:", error);
    return Response.json({ error: "Couldn't read that PDF" }, { status: 422 });
  } finally {
    await parser.destroy();
  }
}
