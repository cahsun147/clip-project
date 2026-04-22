from flask import Flask, request, jsonify
from youtube_transcript_api import YouTubeTranscriptApi
import re

app = Flask(__name__)

def extract_video_id(url):
    # Regex untuk mengambil 11 karakter ID video dari berbagai format URL YouTube
    match = re.search(r"(?:v=|\/)([0-9A-Za-z_-]{11}).*", url)
    return match.group(1) if match else None

@app.route('/api/transcript', methods=['POST'])
def get_transcript():
    data = request.get_json()
    url = data.get('url')
    
    if not url:
        return jsonify({"success": False, "error": "URL YouTube diperlukan"}), 400
        
    video_id = extract_video_id(url)
    if not video_id:
        return jsonify({"success": False, "error": "Format URL YouTube tidak valid"}), 400
        
    try:
        # Mengambil transkrip (prioritas bahasa Indonesia, fallback ke Inggris)
        transcript_list = YouTubeTranscriptApi.get_transcript(video_id, languages=['id', 'en'])
        
        formatted_transcript = []
        for item in transcript_list:
            formatted_transcript.append({
                "text": item['text'],
                "offset": item['start'],      # Sudah dalam detik (float)
                "duration": item['duration']  # Sudah dalam detik (float)
            })
            
        return jsonify({
            "success": True,
            "videoId": video_id,
            "transcript": formatted_transcript
        })
    except Exception as e:
        error_msg = str(e)
        if "No transcripts were found" in error_msg or "Subtitles are disabled" in error_msg:
            return jsonify({"success": False, "error": "Video ini tidak memiliki subtitle (termasuk auto-generated)."}), 400
        return jsonify({"success": False, "error": f"Gagal mengambil transkrip: {error_msg}"}), 500
