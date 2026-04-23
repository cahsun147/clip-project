from flask import Flask, request, jsonify
import re
import os
import random

app = Flask(__name__)

def extract_video_id(url):
    match = re.search(r"(?:v=|\/)([0-9A-Za-z_-]{11}).*", url)
    return match.group(1) if match else None

def get_proxy_configs():
    """Baca proxies.txt dan konversi ke daftar GenericProxyConfig"""
    from youtube_transcript_api.proxies import GenericProxyConfig
    configs = []
    try:
        proxy_file_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'proxies.txt')
        if not os.path.exists(proxy_file_path):
            proxy_file_path = 'proxies.txt'

        if os.path.exists(proxy_file_path):
            with open(proxy_file_path, 'r') as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    parts = line.split(':')
                    # Format Webshare: IP:PORT:USER:PASS
                    if len(parts) == 4:
                        ip, port, user, pwd = parts
                        proxy_url = f"http://{user}:{pwd}@{ip}:{port}"
                        configs.append(GenericProxyConfig(
                            http_url=proxy_url,
                            https_url=proxy_url,
                        ))
    except Exception as e:
        print(f"Peringatan: Gagal membaca proxy ({e})")
    return configs

@app.route('/api/transcript', methods=['POST'])
def get_transcript():
    data = request.get_json()
    url = data.get('url')
    if not url:
        return jsonify({"success": False, "error": "URL diperlukan"}), 400

    video_id = extract_video_id(url)
    if not video_id:
        return jsonify({"success": False, "error": "URL tidak valid"}), 400

    from youtube_transcript_api import YouTubeTranscriptApi

    proxy_configs = get_proxy_configs()
    random.shuffle(proxy_configs)
    # Tambahkan None = tanpa proxy di urutan terakhir
    proxy_configs.append(None)

    transcript_data = None
    last_error = ""

    # LOOP PROXY: list + find_transcript + fetch SEMUA di dalam try
    for proxy_config in proxy_configs:
        try:
            if proxy_config:
                ytt_api = YouTubeTranscriptApi(proxy_config=proxy_config)
            else:
                ytt_api = YouTubeTranscriptApi()

            # Tahap 1: List subtitle yang tersedia
            transcript_list = ytt_api.list(video_id)

            # Tahap 2: Pilih bahasa (ID > EN > apapun)
            try:
                transcript_obj = transcript_list.find_transcript(['id', 'en'])
            except Exception:
                transcript_obj = next(iter(transcript_list))

            # Tahap 3: Download teks (rawan 429 / IpBlocked)
            fetched = transcript_obj.fetch()
            transcript_data = fetched.to_raw_data()

            # Sukses! Keluar dari loop
            break
        except Exception as e:
            last_error = str(e)
            continue

    if not transcript_data:
        err_lower = last_error.lower()
        if "subtitles are disabled" in err_lower or "no transcripts" in err_lower:
            return jsonify({"success": False, "error": "Video ini tidak memiliki subtitle/transcript."}), 400
        return jsonify({
            "success": False,
            "error": f"Semua proxy gagal. Error terakhir: {last_error[:200]}",
        }), 500

    try:
        formatted = [
            {"text": i['text'], "offset": i['start'], "duration": i['duration']}
            for i in transcript_data
        ]
        return jsonify({"success": True, "videoId": video_id, "transcript": formatted})
    except Exception as e:
        return jsonify({"success": False, "error": f"Gagal memformat teks: {str(e)}"}), 500
