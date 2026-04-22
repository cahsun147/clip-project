import { NextRequest, NextResponse } from "next/server";
import type { TriggerActionResult } from "@/types/clip";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const videoUrl: string = body.videoUrl;
  const startTime: number = body.startTime;
  const endTime: number = body.endTime;
  const title: string = body.title;

  if (!videoUrl || typeof videoUrl !== "string") {
    return NextResponse.json<TriggerActionResult>(
      { success: false, error: "videoUrl diperlukan" },
      { status: 400 }
    );
  }

  if (typeof startTime !== "number" || typeof endTime !== "number") {
    return NextResponse.json<TriggerActionResult>(
      { success: false, error: "startTime dan endTime harus berupa angka" },
      { status: 400 }
    );
  }

  if (!title || typeof title !== "string") {
    return NextResponse.json<TriggerActionResult>(
      { success: false, error: "title diperlukan" },
      { status: 400 }
    );
  }

  const owner = process.env.GITHUB_OWNER;
  const repo = process.env.GITHUB_REPO;
  const pat = process.env.GITHUB_PAT;

  if (!owner || !repo || !pat) {
    return NextResponse.json<TriggerActionResult>(
      { success: false, error: "GITHUB_OWNER, GITHUB_REPO, dan GITHUB_PAT belum dikonfigurasi" },
      { status: 500 }
    );
  }

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
          event_type: "cut_video",
          client_payload: {
            video_url: videoUrl,
            start_time: startTime,
            end_time: endTime,
            title,
          },
        }),
      }
    );

    if (!ghRes.ok) {
      const errBody = await ghRes.text();
      return NextResponse.json<TriggerActionResult>(
        { success: false, error: `GitHub API error (${ghRes.status}): ${errBody.slice(0, 300)}` },
        { status: 502 }
      );
    }

    return NextResponse.json<TriggerActionResult>({ success: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json<TriggerActionResult>(
      { success: false, error: `Gagal menghubungi GitHub: ${msg}` },
      { status: 500 }
    );
  }
}
