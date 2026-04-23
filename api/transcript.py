from flask import Flask, request, jsonify
import re
import os
import random

app = Flask(__name__)

def extract_video_id(url):
    match = re.search(r"(?:v=|\/)([0-9A-Za-z_-]{11}).*", url)
    return match.group(1) if match else None

def get_webshare_credentials():
    """Baca kredensial Webshare dari proxies.txt (IP:PORT:USER:PASS)"""
    username = os.environ.get('WEBSHARE_PROXY_USERNAME')
    password = os.environ.get('WEBSHARE_PROXY_PASSWORD')
    if username and password:
        return username, password

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
                    if len(parts) == 4:
                        return parts[2], parts[3]  # user, pwd
    except Exception:
        pass
    return None, None

def get_datacenter_proxy_configs():
    """Baca proxies.txt dan konversi ke daftar GenericProxyConfig (fallback)"""
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

def fetch_with_api(ytt_api, video_id):
    """Helper: list → find_transcript → fetch → to_raw_data"""
    transcript_list = ytt_api.list(video_id)
    try:
        transcript_obj = transcript_list.find_transcript(['id', 'en'])
    except Exception:
        transcript_obj = next(iter(transcript_list))
    return transcript_obj.fetch().to_raw_data()

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

    transcript_data = None
    last_error = ""

    # === Lapis 1: WebshareProxyConfig (Residential Rotating) ===
    ws_user, ws_pwd = get_webshare_credentials()
    if ws_user and ws_pwd:
        try:
            from youtube_transcript_api.proxies import WebshareProxyConfig
            ytt_api = YouTubeTranscriptApi(
                proxy_config=WebshareProxyConfig(
                    proxy_username=ws_user,
                    proxy_password=ws_pwd,
                )
            )
            transcript_data = fetch_with_api(ytt_api, video_id)
        except Exception as e:
            last_error = f"[Residential] {str(e)}"
            print(f"WebshareProxyConfig gagal: {e}")

    # === Lapis 2: GenericProxyConfig loop (Datacenter proxies) ===
    if not transcript_data:
        dc_configs = get_datacenter_proxy_configs()
        random.shuffle(dc_configs)
        for proxy_config in dc_configs:
            try:
                ytt_api = YouTubeTranscriptApi(proxy_config=proxy_config)
                transcript_data = fetch_with_api(ytt_api, video_id)
                break
            except Exception as e:
                last_error = f"[Datacenter] {str(e)}"
                continue

    # === Lapis 3: Tanpa proxy ===
    if not transcript_data:
        try:
            ytt_api = YouTubeTranscriptApi()
            transcript_data = fetch_with_api(ytt_api, video_id)
        except Exception as e:
            last_error = f"[No Proxy] {str(e)}"

    if not transcript_data:
        err_lower = last_error.lower()
        if "subtitles are disabled" in err_lower or "no transcripts" in err_lower:
            return jsonify({"success": False, "error": "Video ini tidak memiliki subtitle/transcript."}), 400
        return jsonify({
            "success": False,
            "error": f"Semua metode gagal. Error terakhir: {last_error[:300]}",
        }), 500

    try:
        formatted = [
            {"text": i['text'], "offset": i['start'], "duration": i['duration']}
            for i in transcript_data
        ]
        return jsonify({"success": True, "videoId": video_id, "transcript": formatted})
    except Exception as e:
        return jsonify({"success": False, "error": f"Gagal memformat teks: {str(e)}"}), 500
