export interface TranscriptLine {
  text: string;
  offset: number;
  duration: number;
}

export interface TranscriptResponse {
  success: true;
  videoId: string;
  transcript: TranscriptLine[];
}

export interface TranscriptError {
  success: false;
  error: string;
}

export type TranscriptResult = TranscriptResponse | TranscriptError;

export interface ClipSegment {
  id: string;
  title: string;
  hook: string;
  reason: string;
  start_time: number;
  end_time: number;
}

export interface AnalyzeResponse {
  success: true;
  clips: ClipSegment[];
}

export interface AnalyzeError {
  success: false;
  error: string;
}

export type AnalyzeResult = AnalyzeResponse | AnalyzeError;

export interface TriggerActionResponse {
  success: true;
}

export interface TriggerActionError {
  success: false;
  error: string;
}

export type TriggerActionResult = TriggerActionResponse | TriggerActionError;
