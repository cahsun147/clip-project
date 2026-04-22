from flask import Flask, request, jsonify
from youtube_transcript_api import YouTubeTranscriptApi
import re
import requests
import random
import os

app = Flask(__name__)

def extract_video_id(url):
    match = re.search(r"(?:v=|\/)([0-9A-Za-z_-]{11}).*", url)
    return match.group(1) if match else None

def parse_vtt(vtt_text):
    lines = vtt_text.split("\n")
    result = []
    timestamp_re = re.compile(r"([0-9:.]+)\s-->\s([0-9:.]+)")
    
    def parse_time(time_str):
        parts = time_str.strip().split(':')
        if len(parts) == 3:
            return int(parts[0]) * 3600 + int(parts[1]) * 60 + float(parts[2])
        elif len(parts) == 2:
            return int(parts[0]) * 60 + float(parts[1])
        return 0

    i = 0
    while i < len(lines):
        match = timestamp_re.search(lines[i])
        if match:
            start_secs = parse_time(match.group(1))
            end_secs = parse_time(match.group(2))
            
            text_parts = []
            j = i + 1
            while j < len(lines) and lines[j].strip() != "" and "-->" not in lines[j]:
                cleaned = re.sub(r"<[^>]+>", "", lines[j]).strip()
                if cleaned: text_parts.append(cleaned)
                j += 1
                
            if text_parts:
                result.append({"text": " ".join(text_parts), "offset": start_secs, "duration": end_secs - start_secs})
            i = j
        else:
            i += 1
    return result

def fetch_from_invidious(video_id):
    instances = [
        "https://inv.tux.pizza",
        "https://invidious.weblibre.org",
        "https://invidious.flokinet.to"
    ]
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "en-US,en;q=0.9,id;q=0.8"
    }
    
    last_error = ""
    for base_url in instances:
        try:
            res = requests.get(f"{base_url}/api/v1/videos/{video_id}", headers=headers, timeout=10)
            if res.status_code != 200: continue
                
            data = res.json()
            if "captions" not in data or len(data["captions"]) == 0: continue
                
            sub = next((c for c in data["captions"] if c.get("languageCode") == "id" or "Indonesian" in c.get("label", "")), None)
            if not sub:
                sub = next((c for c in data["captions"] if c.get("languageCode") == "en" or "English" in c.get("label", "")), None)
            if not sub: sub = data["captions"][0]
                
            vtt_url = sub["url"] if sub["url"].startswith("http") else f"{base_url}{sub['url']}"
            vtt_res = requests.get(vtt_url, headers=headers, timeout=10)
            if vtt_res.status_code != 200: continue
                
            parsed = parse_vtt(vtt_res.text)
            if len(parsed) > 0: return parsed
        except Exception as e:
            last_error = str(e)
            continue
            
    raise Exception(f"Semua instance Invidious mati atau diblokir. Error: {last_error}")

def get_proxies():
    proxies = []
    try:
        # Membaca file proxies.txt di root folder
        proxy_file_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'proxies.txt')
        if not os.path.exists(proxy_file_path):
            proxy_file_path = 'proxies.txt' # Fallback jika run di root
            
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
        print(f"Peringatan: Gagal membaca proxies.txt ({e})")
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
    proxies_list.append(None) # Tambahkan percobaan tanpa proxy sebagai upaya terakhir
    
    transcript_list = None
    last_err_msg = ""
    
    # Lapis 1: Coba satu per satu proxy
    for proxy_dict in proxies_list:
        try:
            if proxy_dict:
                transcript_list = YouTubeTranscriptApi.list_transcripts(video_id, proxies=proxy_dict)
            else:
                transcript_list = YouTubeTranscriptApi.list_transcripts(video_id)
            break # Sukses! Keluar dari loop proxy
        except Exception as e:
            last_err_msg = str(e).lower()
            continue
            
    try:
        if not transcript_list:
            raise Exception(f"Semua proxy gagal. Error terakhir: {last_err_msg}")
            
        try: transcript_obj = transcript_list.find_transcript(['id', 'en'])
        except: transcript_obj = next(iter(transcript_list))
            
        transcript_data = transcript_obj.fetch()
        formatted = [{"text": i['text'], "offset": i['start'], "duration": i['duration']} for i in transcript_data]
        return jsonify({"success": True, "videoId": video_id, "transcript": formatted})
    except Exception as e:
        err_msg = str(e).lower()
        # Lapis 2: Jika diblokir atau proxy habis, lari ke Invidious
        if "disabled" in err_msg or "blocking" in err_msg or "could not retrieve" in err_msg or "proxy gagal" in err_msg:
            try:
                fallback_data = fetch_from_invidious(video_id)
                return jsonify({"success": True, "videoId": video_id, "transcript": fallback_data})
            except Exception as fb_err:
                return jsonify({"success": False, "error": f"YT API diblokir & Invidious Error: {str(fb_err)}"}), 500
        else:
            return jsonify({"success": False, "error": "Video ini benar-benar tidak memiliki subtitle."}), 400
