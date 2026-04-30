import { NextRequest, NextResponse } from "next/server";
import type { TriggerActionResult } from "@/types/clip";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const videoUrl: string = body.videoUrl;
    const startTime: number = body.startTime;
    const endTime: number = body.endTime;
    const title: string = body.title;

    // 1. Validasi Input Tipe Data
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

    // 2. Validasi Logika Waktu (Mencegah error di yt-dlp)
    if (startTime >= endTime) {
      return NextResponse.json<TriggerActionResult>(
        { success: false, error: "startTime harus lebih kecil dari endTime" },
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

    // 3. Validasi Server Environment
    if (!owner || !repo || !pat) {
      console.error("🚨 [TRIGGER] Konfigurasi gagal: GITHUB_OWNER, GITHUB_REPO, atau GITHUB_PAT kosong di .env.local!");
      return NextResponse.json<TriggerActionResult>(
        { success: false, error: "Server belum dikonfigurasi dengan benar (Missing Env Vars)" },
        { status: 500 }
      );
    }

    const jobId = crypto.randomUUID();
    console.log(`🚀 [TRIGGER] Mengirim tugas pemotongan ke GitHub Actions... [Job ID: ${jobId}]`);

    // 4. Eksekusi ke GitHub API
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
          event_type: "cut-video", // Sudah sesuai dengan file YAML
          client_payload: {
            video_url: videoUrl,
            start_time: startTime,
            end_time: endTime,
            title,
            job_id: jobId,
          },
        }),
      }
    );

    // 5. Handler Tangkapan Error dari GitHub
    if (!ghRes.ok) {
      const errBody = await ghRes.text();
      console.error(`🚨 [TRIGGER] GitHub API menolak request (Status: ${ghRes.status}):`, errBody);
      return NextResponse.json<TriggerActionResult>(
        { success: false, error: `GitHub API error (${ghRes.status}): ${errBody.slice(0, 300)}` },
        { status: 502 }
      );
    }

    console.log(`✅ [TRIGGER] Sukses dikirim! GitHub Actions sedang berjalan. [Job ID: ${jobId}]`);
    return NextResponse.json<TriggerActionResult>({ success: true });

  } catch (err: unknown) {
    // 6. Handler Fatal Error (misal: gagal parsing JSON)
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`🚨 [TRIGGER] Terjadi kesalahan sistem:`, msg);
    return NextResponse.json<TriggerActionResult>(
      { success: false, error: `Gagal memproses request lokal: ${msg}` },
      { status: 500 }
    );
  }
}