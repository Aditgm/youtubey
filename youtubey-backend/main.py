from fastapi import FastAPI, Request, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import yt_dlp
import re
from dotenv import load_dotenv
import os
import time
import google.generativeai as genai
from datetime import datetime, timedelta
import tempfile

load_dotenv()

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

import threading
import urllib.request
import time

def keep_alive():
    url = "https://youtubey.onrender.com/health"
    while True:
        try:
            time.sleep(14 * 60) 
            urllib.request.urlopen(url)
            print(f"Pinged {url} to keep server alive")
        except Exception as e:
            print(f"Keep-alive ping failed: {e}")

threading.Thread(target=keep_alive, daemon=True).start()



request_times = []
MAX_REQUESTS_PER_MINUTE = 10

def check_rate_limit():
    global request_times
    now = time.time()
    request_times = [t for t in request_times if now - t < 60]
    
    if len(request_times) >= MAX_REQUESTS_PER_MINUTE:
        return False
    
    request_times.append(now)
    return True

@app.get("/")
def read_root():
    return {"message": "Youtubey backend is running!"}

@app.get("/health")
def health_check():
    return {"status": "healthy", "message": "Youtubey backend is running!"}

class TranscriptRequest(BaseModel):
    url: str
    summary_type: str = "fast"  

def extract_video_id(url: str) -> str:
    import re
    patterns = [
        r"(?:v=|\/)([0-9A-Za-z_-]{11}).*",
        r"youtu\.be/([0-9A-Za-z_-]{11})",
    ]
    for pattern in patterns:
        match = re.search(pattern, url)
        if match:
            return match.group(1)
    if len(url) == 11 and re.match(r"^[0-9A-Za-z_-]{11}$", url):
        return url
    return ""

# Initialize Gemini API
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
if GEMINI_API_KEY:
    try:
        genai.configure(api_key=GEMINI_API_KEY)
        print("✅ Gemini API configured successfully")
    except Exception as e:
        print(f"⚠️ Warning: Failed to configure Gemini API: {e}")
else:
    print("⚠️ Warning: GEMINI_API_KEY not found in environment variables!")

def get_transcript_with_ytdlp(video_id: str) -> str:
    url = f"https://www.youtube.com/watch?v={video_id}"
    
    ydl_opts = {
        'skip_download': True,
        'writesubtitles': True,
        'writeautomaticsub': True,
        'subtitleslangs': ['en'],
        'quiet': True,
        'no_warnings': True,
    }
    
    # Securely read cookies from the environment variable (not from a file in repo)
    youtube_cookies_env = os.getenv("YOUTUBE_COOKIES")
    cookie_temp_file = None
    
    if youtube_cookies_env:
        # Create a temporary file to hold the cookies for yt-dlp
        fd, cookie_temp_file = tempfile.mkstemp(suffix=".txt")
        with os.fdopen(fd, 'w') as f:
            f.write(youtube_cookies_env)
        
        ydl_opts['cookiefile'] = cookie_temp_file
        print("Using cookies from YOUTUBE_COOKIES environment variable")
    elif os.path.exists("cookies.txt"):
        ydl_opts['cookiefile'] = "cookies.txt"
        print("Using local cookies.txt file (Warning: Do not commit to public repo)")

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
            
            # Look for English subtitles or automatic captions
            subs = info.get('requested_subtitles')
            if not subs:
                subs = info.get('automatic_captions')
                
            if not subs or 'en' not in subs:
                raise Exception("No English transcripts available for this video.")
                
            # Get the highest priority transcript URL (usually JSON3 or VTT)
            sub_info = subs['en'][0] if isinstance(subs['en'], list) else subs['en']
            
            # Download and parse
            import urllib.request
            import json
            req = urllib.request.Request(sub_info['url'])
            
            with urllib.request.urlopen(req) as response:
                content = response.read().decode('utf-8')
                
                # If json3 format
                if sub_info.get('ext') == 'json3':
                    data = json.loads(content)
                    events = data.get('events', [])
                    text_parts = []
                    for ev in events:
                        segs = ev.get('segs', [])
                        for seg in segs:
                            t = seg.get('utf8', '').strip()
                            if t and t != '\n':
                                text_parts.append(t)
                    return " ".join(text_parts)
                # If vtt format
                else: 
                    lines = content.split('\n')
                    text_parts = []
                    for line in lines:
                        if '-->' in line or line.startswith('WEBVTT') or line.startswith('Kind:') or line.startswith('Language:') or not line.strip():
                            continue
                        tag_stripped = re.sub(r'<[^>]+>', '', line).strip() # strip vtt tags
                        if tag_stripped:
                            text_parts.append(tag_stripped)
                    return " ".join(text_parts)
                    
    except Exception as e:
        raise Exception(f"Error fetching transcript content: {str(e)}")
    finally:
        # Always clean up the temporary cookie file to prevent leaks
        if cookie_temp_file and os.path.exists(cookie_temp_file):
            try:
                os.remove(cookie_temp_file)
            except Exception as cleanup_err:
                print(f"Failed to delete temp cookie file: {cleanup_err}")


@app.post("/transcript")
async def get_transcript(req: TranscriptRequest):
    video_id = extract_video_id(req.url)
    
    try:
        transcript_text = get_transcript_with_ytdlp(video_id)
        return {"transcript": transcript_text}
    except Exception as e:
        error_msg = str(e)
        if '429' in error_msg or 'Too Many Requests' in error_msg or 'Sign in to confirm you’re not a bot' in error_msg:
            return {"error": "YouTube is temporarily blocking transcript access due to too many requests from this server. Please set the YOUTUBE_COOKIES environment variable in Render."}
        return {"error": str(e)}

@app.post("/summarize")
async def summarize(req: TranscriptRequest):
    if not check_rate_limit():
        return {"error": "Rate limit exceeded. Please wait a moment before trying again."}
    
    video_id = extract_video_id(req.url)
    summary_type = req.summary_type.lower()
    
    try:
        try:
            transcript_text = get_transcript_with_ytdlp(video_id)
        except Exception as e:
            raise Exception(f"Failed to extract transcript: {str(e)}")
          
        if summary_type == "simple":
            simple_result = await fallback_summarize(transcript_text)
            if 'note' in simple_result:
                simple_result['note'] = '📝 Simple summary (no AI used). ' + simple_result['note'].replace('⚠️ AI quota exceeded. ', '')
            else:
                simple_result['note'] = '📝 Simple summary (no AI used).'
            return simple_result
        elif summary_type == "complete":
            return await complete_summarize(transcript_text)
        else:
            return await fast_summarize(transcript_text)
            
    except Exception as e:
        error_msg = str(e)
        if "quota" in error_msg.lower() or "rate limit" in error_msg.lower():
            return {"error": "API quota exceeded. Please try again later or check your API key."}
        return {"error": error_msg}

async def fallback_summarize(transcript_text):
    """Basic text summarization without AI"""
    try:
        cleaned_text = transcript_text.strip()
        if not cleaned_text:
            return {"error": "No content found in captions"}
        
        # Split into sentences and take first 10
        sentences = cleaned_text.split('.')
        sentences = [s.strip() for s in sentences if s.strip()]
        summary_sentences = sentences[:10]
        
        # Create bullet points
        bullet_points = []
        for sentence in summary_sentences:
            if len(sentence) > 10:  # Only include substantial sentences
                bullet_points.append(f"• {sentence}")
        
        # If we don't have enough bullets, create word-based ones
        if len(bullet_points) < 5:
            words = cleaned_text.split()
            chunk_size = 20
            for i in range(0, min(len(words), 200), chunk_size):
                chunk = words[i:i + chunk_size]
                bullet_points.append(f"• {' '.join(chunk)}")
        
        formatted_summary = '\n'.join(bullet_points[:15])  # Limit to 15 points
        
        return {
            "summary": formatted_summary,
            "type": "basic",
            "note": "📝 Basic text summary (no AI processing)"
        }
        
    except Exception as e:
        return {"error": f"Failed to create fallback summary: {str(e)}"}

async def fast_summarize(transcript_text):
    """Ultra-fast AI summarization for all videos"""
    try:
        cleaned_text = transcript_text.strip()
        if not cleaned_text:
            return {"error": "No content found in captions"}
        
        words = cleaned_text.split()
        if len(words) > 500:
            truncated_text = " ".join(words[:500])
            note = f"Video was long ({len(words)} words), summarized first 500 words for ultra-fast processing."
        else:
            truncated_text = cleaned_text
            note = None
        
        # Check if Gemini API is available
        if not GEMINI_API_KEY:
            return await fallback_summarize(transcript_text)
        
        try:
            prompt = f"Summarize this video transcript in 15 bullet points:\n{truncated_text}"
            model = genai.GenerativeModel("gemini-1.5-flash")
            response = model.generate_content(
                prompt,
                generation_config={
                    "temperature": 0.1,
                    "max_output_tokens": 200,
                    "top_p": 0.5
                }
            )
            
            result = {"summary": response.text, "type": "fast"}
            if note:
                result["note"] = note
                
            return result
            
        except Exception as genai_error:
            print(f"Gemini API error: {genai_error}")
            return await fallback_summarize(transcript_text)
        
    except Exception as e:
        error_msg = str(e)
        if "quota" in error_msg.lower() or "rate limit" in error_msg.lower():
            return await fallback_summarize(transcript_text)
        return {"error": f"Failed to summarize video: {error_msg}"}

async def complete_summarize(transcript_text):
    """Complete AI summarization covering the entire video"""
    try:
        cleaned_text = transcript_text.strip()
        if not cleaned_text:
            return {"error": "No content found in captions"}
        
        words = cleaned_text.split()
        total_words = len(words)
        if total_words <= 1000:
            return await fast_summarize(transcript_text)

        # Check if Gemini API is available
        if not GEMINI_API_KEY:
            return await fallback_summarize(transcript_text)

        chunk_size = 800
        chunks = []

        for i in range(0, total_words, chunk_size):
            chunk_words = words[i:i + chunk_size]
            chunks.append(" ".join(chunk_words))
        
        chunk_summaries = []
        model = genai.GenerativeModel("gemini-1.5-flash")
        
        for i, chunk in enumerate(chunks):
            try:
                prompt = f"Summarize this part of a video in 5-7 bullet points:\n{chunk}"
                response = model.generate_content(
                    prompt,
                    generation_config={
                        "temperature": 0.2,
                        "max_output_tokens": 150,
                        "top_p": 0.7
                    }
                )
                chunk_summaries.append(response.text)
            except Exception as e:
                error_msg = str(e)
                if "quota" in error_msg.lower() or "rate limit" in error_msg.lower():
                    return await fallback_summarize(transcript_text)
                chunk_summaries.append(f"Error processing section {i+1}")
        
        combined_summary = "\n\n".join(chunk_summaries)
        
        try:
            final_prompt = f"Create a comprehensive summary in 15-20 bullet points from these video sections:\n{combined_summary}"
            final_response = model.generate_content(
                final_prompt,
                generation_config={
                    "temperature": 0.3,
                    "max_output_tokens": 300,
                    "top_p": 0.8
                }
            )
        except Exception as e:
            error_msg = str(e)
            if "quota" in error_msg.lower() or "rate limit" in error_msg.lower():
                return {
                    "summary": combined_summary,
                    "type": "partial_complete",
                    "note": "⚠️ AI quota exceeded during final summary. Showing chunk summaries."
                }
            return {"error": f"Failed to create final summary: {error_msg}"}
        
        result = {
            "summary": final_response.text,
            "type": "complete",
            "note": f"Complete summary covering all {total_words} words from {len(chunks)} sections"
        }
        
        return result
        
    except Exception as e:
        error_msg = str(e)
        if "quota" in error_msg.lower() or "rate limit" in error_msg.lower():
            return await fallback_summarize(transcript_text)
        return {"error": f"Failed to create complete summary: {error_msg}"} 
