from flask import Flask, request, jsonify
from youtube_transcript_api import YouTubeTranscriptApi
import re
import random
import os

app = Flask(__name__)

def extract_video_id(url):
    match = re.search(r"(?:v=|\/)([0-9A-Za-z_-]{11}).*", url)
    return match.group(1) if match else None

def get_proxies():
    proxies = []
    try:
        # Membaca file proxies.txt di root folder
        proxy_file_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'proxies.txt')
        if not os.path.exists(proxy_file_path):
            proxy_file_path = 'proxies.txt'
            
        if os.path.exists(proxy_file_path):
            with open(proxy_file_path, 'r') as f:
                for line in f:
                    line = line.strip()
                    if not line: continue
                    parts = line.split(':')
                    # Format Webshare: IP:PORT:USER:PASS
                    if len(parts) == 4:
                        ip, port, user, pwd = parts
                        proxy_url = f"http://{user}:{pwd}@{ip}:{port}"
                        proxies.append({"http": proxy_url, "https": proxy_url})
    except Exception as e:
        print(f"Peringatan: Gagal membaca proxy ({e})")
    return proxies

@app.route('/api/transcript', methods=['POST'])
def get_transcript():
    data = request.get_json()
    url = data.get('url')
    if not url: return jsonify({"success": False, "error": "URL diperlukan"}), 400
        
    video_id = extract_video_id(url)
    if not video_id: return jsonify({"success": False, "error": "URL tidak valid"}), 400
        
    proxies_list = get_proxies()
    random.shuffle(proxies_list)
    # Tambahkan opsi 'tanpa proxy' di urutan paling akhir
    proxies_list.append(None) 
    
    transcript_list = None
    last_error = ""
    
    # Loop: Coba tembak YouTube menggunakan proxy satu per satu
    for proxy_dict in proxies_list:
        try:
            if proxy_dict:
                transcript_list = YouTubeTranscriptApi.list_transcripts(video_id, proxies=proxy_dict)
            else:
                transcript_list = YouTubeTranscriptApi.list_transcripts(video_id)
            break # Jika sukses, langsung keluar dari loop
        except Exception as e:
            last_error = str(e).lower()
            continue
            
    if not transcript_list:
        if "subtitles are disabled" in last_error or "no transcripts were found" in last_error:
            return jsonify({"success": False, "error": "Video ini benar-benar tidak memiliki subtitle."}), 400
        return jsonify({"success": False, "error": f"Semua proxy gagal menembus YouTube. Error terakhir: {last_error}"}), 500
        
    try:
        # Prioritas Bahasa: Indonesia, lalu Inggris, lalu apapun yang ada
        try: 
            transcript_obj = transcript_list.find_transcript(['id', 'en'])
        except: 
            transcript_obj = next(iter(transcript_list))
            
        transcript_data = transcript_obj.fetch()
        formatted = [{"text": i['text'], "offset": i['start'], "duration": i['duration']} for i in transcript_data]
        return jsonify({"success": True, "videoId": video_id, "transcript": formatted})
    except Exception as e:
        return jsonify({"success": False, "error": f"Gagal mengekstrak teks: {str(e)}"}), 500
