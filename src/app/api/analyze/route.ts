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

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: "gemini-2.0-flash",
      generationConfig: { maxOutputTokens: 8192 },
    });

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
    return NextResponse.json<AnalyzeResult>(
      { success: false, error: `Analisis gagal: ${msg.slice(0, 300)}` },
      { status: 500 }
    );
  }
}
