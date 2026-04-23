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

  const match = url.match(/(?:v=|\/)([0-9A-Za-z_-]{11}).*/);
  const videoId = match?.[1];

  if (!videoId) {
    return NextResponse.json(
      { success: false, error: "Format URL YouTube tidak valid" },
      { status: 400 }
    );
  }

  const owner = process.env.GITHUB_OWNER;
  const repo = process.env.GITHUB_REPO;
  const pat = process.env.GITHUB_PAT;

  if (!owner || !repo || !pat) {
    return NextResponse.json(
      { success: false, error: "GITHUB_OWNER, GITHUB_REPO, dan GITHUB_PAT belum dikonfigurasi" },
      { status: 500 }
    );
  }

  const requestId = crypto.randomUUID();

  try {
    const ghRes = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/dispatches`,
      {
        method: "POST",
        headers: {
          Accept: "application/vnd.github.v3+json",
          Authorization: `Bearer ${pat}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          event_type: "fetch_transcript",
          client_payload: {
            video_id: videoId,
            request_id: requestId,
          },
        }),
      }
    );

    if (!ghRes.ok) {
      const errBody = await ghRes.text();
      return NextResponse.json(
        { success: false, error: `GitHub API error (${ghRes.status}): ${errBody.slice(0, 300)}` },
        { status: 502 }
      );
    }

    return NextResponse.json({ success: true, requestId, videoId });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { success: false, error: `Gagal menghubungi GitHub: ${msg}` },
      { status: 500 }
    );
  }
}
