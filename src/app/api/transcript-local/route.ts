import { NextRequest, NextResponse } from "next/server";

const FLASK_URL = process.env.FLASK_URL || "http://127.0.0.1:5001";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const url: string = body.url;

  if (!url || typeof url !== "string") {
    return NextResponse.json(
      { success: false, error: "URL YouTube diperlukan" },
      { status: 400 }
    );
  }

  try {
    const flaskRes = await fetch(`${FLASK_URL}/api/transcript`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
      signal: AbortSignal.timeout(120_000),
    });

    const data = await flaskRes.json();

    if (!data.success) {
      return NextResponse.json(
        { success: false, error: data.error || "Gagal mengambil transcript dari Flask lokal" },
        { status: flaskRes.status }
      );
    }

    return NextResponse.json({
      success: true,
      videoId: data.videoId,
      transcript: data.transcript,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("ECONNREFUSED") || msg.includes("fetch failed")) {
      return NextResponse.json(
        {
          success: false,
          error: "Flask server tidak berjalan. Jalankan: python api/transcript.py (pastikan Flask aktif di port 5001)",
        },
        { status: 502 }
      );
    }
    return NextResponse.json(
      { success: false, error: `Gagal menghubungi Flask lokal: ${msg}` },
      { status: 500 }
    );
  }
}
