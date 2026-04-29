import { NextRequest, NextResponse } from "next/server";

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
    const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
    const res = await fetch(oembedUrl, { signal: AbortSignal.timeout(10_000) });

    if (!res.ok) {
      return NextResponse.json(
        { success: false, error: `YouTube oEmbed error: ${res.status}` },
        { status: 502 }
      );
    }

    const data = await res.json();

    return NextResponse.json({
      success: true,
      title: data.title || "",
      author: data.author_name || "",
      authorUrl: data.author_url || "",
      thumbnail: data.thumbnail_url || "",
      width: data.width || 0,
      height: data.height || 0,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { success: false, error: `Gagal mengambil metadata video: ${msg}` },
      { status: 500 }
    );
  }
}
