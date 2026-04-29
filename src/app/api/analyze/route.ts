import { NextRequest, NextResponse } from "next/server";
import type { AnalyzeResult, ClipSegment } from "@/types/clip";

const PROMPT = `You are a viral content strategist. You will be provided with a YouTube transcript where each line starts with a timestamp in brackets, like this: [120.5] Here is the text.

Find exactly 10 engaging segments that would make great YouTube Shorts (30-60 seconds each).

CRITICAL RULES:
Your 'start_time' and 'end_time' MUST be extracted directly from the [timestamp] brackets present in the text at the beginning and end of your chosen segment.
Do not guess or make up the timestamps.

Return ONLY a valid JSON array — no markdown, no code fences, no extra text. Each element must match this schema exactly:
{
  "id": "unique-id-string",
  "title": "Short catchy title",
  "hook": "The compelling opening sentence",
  "reason": "Why this clip will go viral",
  "start_time": 120.5,
  "end_time": 165.0
}

Transcript:
`;

export async function POST(request: NextRequest) {
  const body = await request.json();
  const transcript: string = body.transcript;

  if (!transcript || typeof transcript !== "string") {
    return NextResponse.json<AnalyzeResult>(
      { success: false, error: "Transcript teks diperlukan" },
      { status: 400 }
    );
  }

  const ollamaBaseUrl = process.env.OLLAMA_BASE_URL;
  const ollamaModel = process.env.OLLAMA_MODEL || "gemini-3-flash-preview:cloud";

  if (!ollamaBaseUrl) {
    return NextResponse.json<AnalyzeResult>(
      { success: false, error: "OLLAMA_BASE_URL belum dikonfigurasi di .env.local" },
      { status: 500 }
    );
  }

  const MAX_RETRIES = 3;
  let lastError = "";

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(`${ollamaBaseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: ollamaModel,
          messages: [
            {
              role: "user",
              content: PROMPT + transcript,
            },
          ],
          stream: false,
        }),
      });

      if (!response.ok) {
        const errText = await response.text().catch(() => "");
        throw new Error(`Ollama API error ${response.status}: ${errText.slice(0, 200)}`);
      }

      const data = await response.json();
      const text: string = data?.message?.content ?? "";

      if (!text) {
        throw new Error("Ollama mengembalikan respons kosong");
      }

      const cleaned = text
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/i, "")
        .trim();

      let clips: ClipSegment[];
      try {
        clips = JSON.parse(cleaned);
      } catch {
        return NextResponse.json<AnalyzeResult>(
          { success: false, error: "Gagal mem-parse respons AI sebagai JSON" },
          { status: 502 }
        );
      }

      if (!Array.isArray(clips) || clips.length === 0) {
        return NextResponse.json<AnalyzeResult>(
          { success: false, error: "AI tidak mengembalikan segmen yang valid" },
          { status: 502 }
        );
      }

      return NextResponse.json<AnalyzeResult>({ success: true, clips });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      lastError = msg;

      // Jika connection error, retry dengan backoff
      if (msg.includes("ECONNREFUSED") || msg.includes("fetch failed") || msg.includes("ETIMEDOUT")) {
        const delay = Math.pow(2, attempt) * 2000;
        console.warn(`[analyze] Ollama connection error attempt ${attempt + 1}, retry in ${delay}ms...`);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }

      // Error lain, langsung gagal
      return NextResponse.json<AnalyzeResult>(
        { success: false, error: `Analisis gagal: ${msg.slice(0, 300)}` },
        { status: 500 }
      );
    }
  }

  return NextResponse.json<AnalyzeResult>(
    { success: false, error: `Ollama tidak dapat dijangkau setelah ${MAX_RETRIES} percobaan. Pastikan Ollama berjalan di ${ollamaBaseUrl}. Detail: ${lastError.slice(0, 200)}` },
    { status: 502 }
  );
}
