from flask import Flask, request, jsonify
import re
import os

app = Flask(__name__)

def extract_video_id(url):
    match = re.search(r"(?:v=|\/)([0-9A-Za-z_-]{11}).*", url)
    return match.group(1) if match else None

@app.route('/api/transcript', methods=['POST'])
def get_transcript():
    data = request.get_json()
    url = data.get('url')
    if not url:
        return jsonify({"success": False, "error": "URL diperlukan"}), 400
    
    video_id = extract_video_id(url)
    if not video_id:
        return jsonify({"success": False, "error": "URL tidak valid"}), 400

    try:
        from youtube_transcript_api import YouTubeTranscriptApi
        ytt_api = YouTubeTranscriptApi()
        
        # Coba bahasa Indonesia dulu, fallback ke English
        try:
            raw = ytt_api.fetch(video_id, languages=['id']).to_raw_data()
        except Exception:
            raw = ytt_api.fetch(video_id, languages=['en']).to_raw_data()

        formatted = [
            {"text": i['text'], "offset": i['start'], "duration": i['duration']}
            for i in raw
        ]
        return jsonify({"success": True, "videoId": video_id, "transcript": formatted})

    except Exception as e:
        err = str(e)
        if "subtitles are disabled" in err.lower() or "no transcripts" in err.lower():
            return jsonify({"success": False, "error": "Video ini tidak memiliki subtitle/transcript."}), 400
        # Kemungkinan besar IP blocked di Vercel
        return jsonify({
            "success": False, 
            "error": "Gagal mengambil transcript. Kemungkinan IP Vercel diblokir YouTube. Gunakan flow GitHub Actions.",
            "detail": err[:200]
        }), 500
