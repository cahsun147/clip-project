import { NextRequest, NextResponse } from "next/server";
import { YoutubeTranscript } from "youtube-transcript";
import type { TranscriptResult } from "@/types/clip";

function extractVideoId(url: string): string | null {
  try {
    const parsed = new URL(url);

    // youtu.be short links
    if (parsed.hostname === "youtu.be") {
      return parsed.pathname.slice(1) || null;
    }

    // youtube.com/watch?v=...
    if (parsed.hostname.includes("youtube.com")) {
      const v = parsed.searchParams.get("v");
      if (v) return v;

      // /shorts/VIDEO_ID or /live/VIDEO_ID
      const match = parsed.pathname.match(/^\/(shorts|live)\/([a-zA-Z0-9_-]+)/);
      if (match) return match[2];
    }

    return null;
  } catch {
    // Maybe the user pasted just the video ID
    if (/^[a-zA-Z0-9_-]{11}$/.test(url)) return url;
    return null;
  }
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const url: string = body.url;

  if (!url || typeof url !== "string") {
    return NextResponse.json<TranscriptResult>(
      { success: false, error: "URL YouTube diperlukan" },
      { status: 400 }
    );
  }

  const videoId = extractVideoId(url);

  if (!videoId) {
    return NextResponse.json<TranscriptResult>(
      { success: false, error: "Format URL YouTube tidak valid" },
      { status: 400 }
    );
  }

  try {
    const transcript = await YoutubeTranscript.fetchTranscript(videoId);

    if (!transcript || transcript.length === 0) {
      return NextResponse.json<TranscriptResult>(
        { success: false, error: "Video ini tidak memiliki subtitle/CC yang bisa ditarik. Coba video lain." },
        { status: 400 }
      );
    }

    return NextResponse.json<TranscriptResult>({
      success: true,
      videoId,
      transcript,
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Gagal mengambil transcript";

    const lower = message.toLowerCase();
    if (
      lower.includes("disabled") ||
      lower.includes("could not") ||
      lower.includes("not found") ||
      lower.includes("404") ||
      lower.includes("no transcript")
    ) {
      return NextResponse.json<TranscriptResult>(
        { success: false, error: "Video ini tidak memiliki subtitle/CC yang bisa ditarik. Coba video lain." },
        { status: 400 }
      );
    }

    return NextResponse.json<TranscriptResult>(
      { success: false, error: `Gagal mengambil transcript: ${message}` },
      { status: 500 }
    );
  }
}
