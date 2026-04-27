"""
Local Transcript Server — jalankan di komputer lokal (IP rumahan, tidak diblokir YouTube).
Endpoint: POST http://localhost:5001/api/transcript
Body: {"url": "https://www.youtube.com/watch?v=..."}
Response: {"success": true, "videoId": "...", "transcript": [...]}

Cara menjalankan:
  pip install flask youtube-transcript-api
  python scripts/local-transcript.py
"""

from flask import Flask, request, jsonify
from flask_cors import CORS
import re

app = Flask(__name__)
CORS(app)  # Izinkan request dari Vercel/dev server


def extract_video_id(url):
    match = re.search(r"(?:v=|\/)([0-9A-Za-z_-]{11}).*", url)
    return match.group(1) if match else None


@app.route("/api/transcript", methods=["POST"])
def get_transcript():
    data = request.get_json()
    url = data.get("url")
    if not url:
        return jsonify({"success": False, "error": "URL diperlukan"}), 400

    video_id = extract_video_id(url)
    if not video_id:
        return jsonify({"success": False, "error": "URL tidak valid"}), 400

    from youtube_transcript_api import YouTubeTranscriptApi

    try:
        ytt_api = YouTubeTranscriptApi()
        transcript_list = ytt_api.list(video_id)
        try:
            transcript_obj = transcript_list.find_transcript(["id", "en"])
        except Exception:
            transcript_obj = next(iter(transcript_list))
        raw = transcript_obj.fetch().to_raw_data()
        formatted = [
            {"text": i["text"], "offset": i["start"], "duration": i["duration"]}
            for i in raw
        ]
        return jsonify({"success": True, "videoId": video_id, "transcript": formatted})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


if __name__ == "__main__":
    print("=" * 50)
    print("  Local Transcript Server")
    print("  Running on http://localhost:5001")
    print("  Press Ctrl+C to stop")
    print("=" * 50)
    app.run(host="0.0.0.0", port=5001, debug=False)
