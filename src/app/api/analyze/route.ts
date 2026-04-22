import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
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

const MODELS = [
  "gemini-2.5-pro",
  "gemini-2.5-flash",
  "gemini-2.0-flash-lite",
  "gemini-2.0-flash",
];

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractRetryDelay(msg: string): number | null {
  const match = msg.match(/retryDelay["':\s]+(\d+)s/i);
  if (match) return parseInt(match[1], 10) * 1000;
  return null;
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const transcript: string = body.transcript;

  if (!transcript || typeof transcript !== "string") {
    return NextResponse.json<AnalyzeResult>(
      { success: false, error: "Transcript teks diperlukan" },
      { status: 400 }
    );
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json<AnalyzeResult>(
      { success: false, error: "GEMINI_API_KEY belum dikonfigurasi" },
      { status: 500 }
    );
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  let lastError = "";

  for (const modelName of MODELS) {
    const model = genAI.getGenerativeModel({
      model: modelName,
      generationConfig: { maxOutputTokens: 8192 },
    });

    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        console.log(`Mencoba: ${modelName} (attempt ${attempt}/2)`);
        const result = await model.generateContent(PROMPT + transcript);
        const text = result.response.text();

        const cleaned = text
          .replace(/^```(?:json)?\s*/i, "")
          .replace(/\s*```$/i, "")
          .trim();

        let clips: ClipSegment[];
        try {
          clips = JSON.parse(cleaned);
        } catch {
          console.log(`${modelName} → JSON parse gagal, respons: ${cleaned.slice(0, 200)}`);
          lastError = "Gagal mem-parse respons AI sebagai JSON";
          break; // try next model
        }

        if (!Array.isArray(clips) || clips.length === 0) {
          console.log(`${modelName} → bukan array valid`);
          lastError = "AI tidak mengembalikan segmen yang valid";
          break;
        }

        console.log(`Berhasil: ${modelName}, ${clips.length} segmen`);
        return NextResponse.json<AnalyzeResult>({ success: true, clips });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(`${modelName} attempt ${attempt} gagal:`, msg.slice(0, 300));

        const is429 = msg.includes("429") || msg.toLowerCase().includes("quota");
        const is404 = msg.includes("404") || msg.toLowerCase().includes("not found");

        if (is404) {
          console.log(`${modelName} → model tidak ditemukan, skip ke model berikutnya`);
          break; // skip to next model
        }

        if (is429 && attempt < 2) {
          const delay = extractRetryDelay(msg) ?? 45000;
          console.log(`${modelName} → quota exceeded, tunggu ${delay / 1000}s...`);
          await sleep(delay);
          continue;
        }

        lastError = msg;
        break;
      }
    }
  }

  return NextResponse.json<AnalyzeResult>(
    { success: false, error: `Semua model gagal. Error terakhir: ${lastError.slice(0, 300)}` },
    { status: 500 }
  );
}
