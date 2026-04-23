import { NextRequest, NextResponse } from "next/server";
import { inflateRawSync } from "node:zlib";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const requestId = searchParams.get("requestId");

  if (!requestId) {
    return NextResponse.json(
      { success: false, error: "requestId diperlukan" },
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

  const headers = {
    Accept: "application/vnd.github.v3+json",
    Authorization: `Bearer ${pat}`,
  };

  try {
    // Step 1: Find the workflow run for this request_id
    const runsRes = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/actions/runs?event=repository_dispatch&per_page=5`,
      { headers }
    );

    if (!runsRes.ok) {
      return NextResponse.json(
        { success: false, status: "error", error: `GitHub API error (${runsRes.status})` },
        { status: 502 }
      );
    }

    const runsData = await runsRes.json();
    const runs = runsData.workflow_runs as Array<{
      id: number;
      status: string;
      conclusion: string | null;
      name: string;
      display_title: string;
    }>;

    // Find the "Fetch Transcript" run that matches our request
    const transcriptRun = runs.find(
      (r) => r.name === "Fetch Transcript"
    );

    if (!transcriptRun) {
      return NextResponse.json({ success: true, status: "pending" });
    }

    // Step 2: Check if run is still in progress
    if (
      transcriptRun.status === "queued" ||
      transcriptRun.status === "in_progress"
    ) {
      return NextResponse.json({ success: true, status: "running" });
    }

    // Step 3: If failed, return error
    if (transcriptRun.conclusion === "failure") {
      return NextResponse.json({
        success: false,
        status: "failed",
        error: "GitHub Actions workflow gagal menjalankan transcript fetch",
      });
    }

    // Step 4: Run completed — download artifact
    const artifactsRes = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/actions/runs/${transcriptRun.id}/artifacts`,
      { headers }
    );

    if (!artifactsRes.ok) {
      return NextResponse.json({
        success: false,
        status: "error",
        error: "Gagal mengambil daftar artifact",
      });
    }

    const artifactsData = await artifactsRes.json();
    const artifact = artifactsData.artifacts?.find(
      (a: { name: string }) => a.name === `transcript-${requestId}`
    );

    if (!artifact) {
      // Fallback: try the generic name (in case request_id wasn't passed)
      const fallbackArtifact = artifactsData.artifacts?.find(
        (a: { name: string }) => a.name.startsWith("transcript-")
      );

      if (!fallbackArtifact) {
        return NextResponse.json({
          success: false,
          status: "error",
          error: "Artifact transcript tidak ditemukan",
        });
      }

      return await downloadAndParseArtifact(fallbackArtifact.archive_download_url, headers);
    }

    return await downloadAndParseArtifact(artifact.archive_download_url, headers);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { success: false, status: "error", error: `Gagal: ${msg}` },
      { status: 500 }
    );
  }
}

async function downloadAndParseArtifact(
  downloadUrl: string,
  headers: Record<string, string>
) {
  // Download the zip artifact
  const zipRes = await fetch(downloadUrl, { headers });
  if (!zipRes.ok) {
    return NextResponse.json({
      success: false,
      status: "error",
      error: `Gagal download artifact (${zipRes.status})`,
    });
  }

  const zipBuffer = Buffer.from(await zipRes.arrayBuffer());

  // Parse zip to find transcript.json — use simple zip parsing
  try {
    const fileName = "transcript.json";

    // Search for local file header signature (PK\x03\x04)
    let jsonContent: string | null = null;
    let offset = 0;
    const buf = zipBuffer;

    while (offset < buf.length - 30) {
      // Check for local file header signature
      if (buf[offset] === 0x50 && buf[offset + 1] === 0x4b && buf[offset + 2] === 0x03 && buf[offset + 3] === 0x04) {
        const nameLen = buf.readUInt16LE(offset + 26);
        const extraLen = buf.readUInt16LE(offset + 28);
        const compMethod = buf.readUInt16LE(offset + 8);
        const compSize = buf.readUInt32LE(offset + 18);
        const uncompSize = buf.readUInt32LE(offset + 22);
        const nameStart = offset + 30;
        const entryName = buf.subarray(nameStart, nameStart + nameLen).toString("utf8");

        if (entryName === fileName && uncompSize > 0) {
          const dataStart = nameStart + nameLen + extraLen;
          const compressedData = buf.subarray(dataStart, dataStart + compSize);

          if (compMethod === 0) {
            // Stored (no compression)
            jsonContent = compressedData.toString("utf8");
          } else if (compMethod === 8) {
            // Deflate compression
            const decompressed = inflateRawSync(compressedData);
            jsonContent = decompressed.toString("utf8");
          }
          break;
        }

        // Skip to next entry
        offset = nameStart + nameLen + extraLen + compSize;
      } else {
        offset++;
      }
    }

    if (!jsonContent) {
      return NextResponse.json({
        success: false,
        status: "error",
        error: "transcript.json tidak ditemukan di dalam artifact zip",
      });
    }

    const transcriptData = JSON.parse(jsonContent);

    if (!transcriptData.success) {
      return NextResponse.json({
        success: false,
        status: "error",
        error: transcriptData.error || "Transcript fetch gagal di GitHub Actions",
      });
    }

    return NextResponse.json({
      success: true,
      status: "done",
      videoId: transcriptData.videoId,
      transcript: transcriptData.transcript,
    });
  } catch (parseErr) {
    return NextResponse.json({
      success: false,
      status: "error",
      error: `Gagal memparse artifact: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`,
    });
  }
}
