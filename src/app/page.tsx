"use client";

import { useState } from "react";
import type { ClipSegment, TranscriptLine, VideoMeta } from "@/types/clip";

type Step = "idle" | "fetching" | "analyzing" | "done" | "error";

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function Home() {
  const [url, setUrl] = useState("");
  const [step, setStep] = useState<Step>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [clips, setClips] = useState<ClipSegment[]>([]);
  const [transcript, setTranscript] = useState<TranscriptLine[] | null>(null);
  const [triggeringId, setTriggeringId] = useState<string | null>(null);
  const [triggeredIds, setTriggeredIds] = useState<Set<string>>(new Set());
  const [notification, setNotification] = useState("");
  const [videoMeta, setVideoMeta] = useState<VideoMeta | null>(null);

  async function handleCutClip(clip: ClipSegment) {
    setTriggeringId(clip.id);
    try {
      const res = await fetch("/api/trigger-action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          videoUrl: url.trim(),
          startTime: clip.start_time,
          endTime: clip.end_time,
          title: clip.title,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setTriggeredIds((prev) => new Set(prev).add(clip.id));
        setNotification("Sinyal terkirim! Video sedang dipotong di server");
        setTimeout(() => setNotification(""), 4000);
      } else {
        alert("Gagal: " + data.error);
      }
    } catch {
      alert("Gagal menghubungi server");
    } finally {
      setTriggeringId(null);
    }
  }

  async function handleAnalyze() {
    if (!url.trim()) return;

    setStep("fetching");
    setErrorMsg("");
    setClips([]);
    setTranscript(null);

    try {
      // 1. Ambil transcript via Flask lokal
      const tRes = await fetch("/api/transcript-local", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });

      const tData = await tRes.json();

      if (!tData.success) {
        setStep("error");
        setErrorMsg(tData.error);
        return;
      }

      const transcriptData: TranscriptLine[] = tData.transcript;

      setTranscript(transcriptData);
      setStep("analyzing");

      // 2. Analyze with Gemini
      const formattedTranscript = transcriptData
        .map((l: TranscriptLine) => `[${l.offset}] ${l.text}`)
        .join("\n");

      const aRes = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript: formattedTranscript }),
      });

      const aData = await aRes.json();

      if (!aData.success) {
        setStep("error");
        setErrorMsg(aData.error);
        return;
      }

      setClips(aData.clips);
      setStep("done");
    } catch (err: unknown) {
      setStep("error");
      setErrorMsg(err instanceof Error ? err.message : "Terjadi kesalahan");
    }
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-200 flex flex-col items-center px-4 py-16">
      {/* Header */}
      <h1 className="text-4xl font-bold tracking-tight mb-2">
        <span className="text-cyan-400">CLIP</span> Project
      </h1>
      <p className="text-gray-500 mb-10 text-center max-w-md">
        Temukan momen viral dari video YouTube dan ubah jadi Shorts.
      </p>

      {/* Input */}
      <div className="w-full max-w-xl flex gap-3">
        <input
          type="text"
          placeholder="Paste URL YouTube di sini..."
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleAnalyze()}
          disabled={step === "fetching" || step === "analyzing"}
          className="flex-1 rounded-lg border border-gray-800 bg-gray-900/60 backdrop-blur-sm px-4 py-3 text-sm text-gray-200 placeholder-gray-600 outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/30 transition disabled:opacity-50"
        />
        <button
          onClick={handleAnalyze}
          disabled={step === "fetching" || step === "analyzing" || !url.trim()}
          className="rounded-lg bg-cyan-600 px-6 py-3 text-sm font-semibold text-white hover:bg-cyan-500 transition disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {step === "fetching"
            ? "Mengambil..."
            : step === "analyzing"
              ? "Menganalisis..."
              : "Cari Clip"}
        </button>
      </div>

      {/* Loading */}
      {(step === "fetching" || step === "analyzing") && (
        <div className="mt-10 flex items-center gap-3 text-cyan-400">
          <svg
            className="animate-spin h-5 w-5"
            viewBox="0 0 24 24"
            fill="none"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
            />
          </svg>
          <span className="text-sm">
            {step === "fetching"
              ? "Mengambil transcript via Flask lokal..."
              : "Gemini sedang menganalisis segmen viral..."}
          </span>
        </div>
      )}

      {/* Error */}
      {step === "error" && errorMsg && (
        <div className="mt-10 w-full max-w-xl rounded-lg border border-red-500/30 bg-red-500/10 backdrop-blur-sm px-5 py-4 text-sm text-red-400">
          {errorMsg}
        </div>
      )}

      {/* Transcript preview */}
      {transcript && step !== "fetching" && (
        <details className="mt-8 w-full max-w-3xl">
          <summary className="cursor-pointer text-sm text-gray-500 hover:text-gray-400 transition">
            Lihat transcript ({transcript.length} baris)
          </summary>
          <p className="mt-2 text-xs text-gray-600 max-h-40 overflow-y-auto whitespace-pre-wrap leading-relaxed">
            {transcript.map((l) => l.text).join(" ")}
          </p>
        </details>
      )}

      {/* Notification */}
      {notification && (
        <div className="fixed top-6 right-6 z-50 rounded-lg border border-green-500/30 bg-green-500/10 backdrop-blur-sm px-5 py-3 text-sm text-green-400 shadow-lg animate-pulse">
          {notification}
        </div>
      )}

      {/* Video Info Header */}
      {step === "done" && videoMeta && (
        <div className="mt-10 w-full max-w-3xl rounded-xl border border-gray-800 bg-gray-900/50 backdrop-blur-sm p-5 flex gap-4 items-start">
          {videoMeta.thumbnail && (
            <img
              src={videoMeta.thumbnail}
              alt={videoMeta.title}
              className="w-32 h-auto rounded-lg object-cover shrink-0"
            />
          )}
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-gray-200 line-clamp-2">
              {videoMeta.title}
            </h2>
            <a
              href={videoMeta.authorUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-cyan-400 hover:underline mt-1 block"
            >
              {videoMeta.author}
            </a>
          </div>
        </div>
      )}

      {/* Clip Cards */}
      {step === "done" && clips.length > 0 && (
        <div className="mt-6 w-full max-w-3xl">
          <h2 className="text-lg font-semibold mb-4 text-gray-300">
            {clips.length} Segmen Viral Ditemukan
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {clips.map((clip, i) => (
              <div
                key={clip.id}
                className="rounded-xl border border-gray-800 bg-gray-900/50 backdrop-blur-sm p-5 transition hover:border-cyan-500/40"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-mono text-cyan-400">
                    #{i + 1}
                  </span>
                  <div className="flex items-center gap-2">
                    {clip.viral_rating && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-cyan-300">
                        {clip.viral_rating}
                      </span>
                    )}
                    {clip.trending_score && (
                      <span className={`text-xs font-bold ${clip.trending_score >= 8 ? "text-green-400" : clip.trending_score >= 5 ? "text-yellow-400" : "text-gray-500"}`}>
                        {clip.trending_score}/10
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-gray-500">
                    {formatDuration(clip.start_time)} →{" "}
                    {formatDuration(clip.end_time)}{" "}
                    <span className="text-gray-600">
                      ({clip.end_time - clip.start_time}s)
                    </span>
                  </span>
                </div>
                <h3 className="font-semibold text-gray-200 mb-1">
                  {clip.title}
                </h3>
                <p className="text-sm text-gray-400 italic mb-2">
                  &ldquo;{clip.hook}&rdquo;
                </p>
                <p className="text-xs text-gray-600 mb-4">{clip.reason}</p>
                <button
                  onClick={() => handleCutClip(clip)}
                  disabled={triggeringId === clip.id || triggeredIds.has(clip.id)}
                  className={`w-full rounded-lg border py-2 text-sm font-medium transition ${triggeredIds.has(clip.id) ? "border-green-500/30 bg-green-500/10 text-green-400" : "border-cyan-500/30 bg-cyan-500/10 text-cyan-400 hover:bg-cyan-500/20"} disabled:opacity-40 disabled:cursor-not-allowed`}
                >
                  {triggeredIds.has(clip.id)
                    ? "✓ Sinyal Terkirim"
                    : triggeringId === clip.id
                      ? "Mengirim..."
                      : "Cut This Clip"}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
