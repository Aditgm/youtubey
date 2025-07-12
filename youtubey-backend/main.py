from fastapi import FastAPI, Request, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from youtube_transcript_api import YouTubeTranscriptApi
import re
from rpunct import RestorePuncts
from dotenv import load_dotenv
import os
import google.generativeai as genai
import time
from datetime import datetime, timedelta

load_dotenv()

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

request_times = []
MAX_REQUESTS_PER_MINUTE = 10

def check_rate_limit():
    """Check if we're within rate limits"""
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
rpunct = RestorePuncts()
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
if GEMINI_API_KEY:
    genai.configure(api_key=GEMINI_API_KEY)
else:
    print("⚠️ Warning: GEMINI_API_KEY not found in environment variables!")

@app.post("/transcript")
async def get_transcript(req: TranscriptRequest):
    video_id = extract_video_id(req.url)
    try:
        try:
            transcript = YouTubeTranscriptApi.get_transcript(video_id, languages=['en'])
        except Exception:
            transcript_list = YouTubeTranscriptApi.list_transcripts(video_id)
            first_transcript = next(iter(transcript_list), None)
            if first_transcript is None:
                raise Exception('No transcripts available for this video.')
            transcript = first_transcript.fetch()
        transcript_text = " ".join([line['text'] for line in transcript])
        punctuated = rpunct.punctuate(transcript_text)
        return {"transcript": punctuated}
    except Exception as e:
        return {"error": str(e)}

@app.post("/summarize")
async def summarize(req: TranscriptRequest):
    if not check_rate_limit():
        return {"error": "Rate limit exceeded. Please wait a moment before trying again."}
    
    video_id = extract_video_id(req.url)
    summary_type = req.summary_type.lower()
    
    try:
        try:
            transcript = YouTubeTranscriptApi.get_transcript(video_id, languages=['en'])
        except Exception:
            try:
                transcript_list = YouTubeTranscriptApi.list_transcripts(video_id)
                transcript = None
                for t in transcript_list:
                    if t.language_code == 'en':
                        transcript = t.fetch()
                        break
                if transcript is None:
                    first_transcript = next(iter(transcript_list), None)
                    if first_transcript is None:
                        raise Exception('No captions or transcripts available for this video.')
                    transcript = first_transcript.fetch()
            except Exception:
                try:
                    transcript = YouTubeTranscriptApi.get_transcript(video_id, languages=['en'])
                except Exception:
                    transcript_list = YouTubeTranscriptApi.list_transcripts(video_id)
                    first_transcript = next(iter(transcript_list), None)
                    if first_transcript is None:
                        raise Exception('No captions or transcripts available for this video.')
                    transcript = first_transcript.fetch()
        
        # Handle both dictionary and object formats
        if isinstance(transcript[0], dict):
            # Dictionary format
            transcript_text = " ".join([line['text'] for line in transcript])
        else:
            # Object format - access text attribute
            transcript_text = " ".join([line.text for line in transcript])
          
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
    """Fallback summarization when AI quota is exceeded"""
    try:
        cleaned_text = transcript_text.strip()
        if not cleaned_text:
            return {"error": "No content found in captions"}
        sentences = cleaned_text.split('.')
        summary_sentences = sentences[:10]
        basic_summary = '. '.join(summary_sentences) + '.'
        words = basic_summary.split()
        bullet_points = []
        current_point = []
        
        for word in words:
            current_point.append(word)
            if len(current_point) >= 15: 
                bullet_points.append(' '.join(current_point))
                current_point = []
        
        if current_point:
            bullet_points.append(' '.join(current_point))
        formatted_summary = '\n'.join([f"• {point}" for point in bullet_points])
        
        return {
            "summary": formatted_summary,
            "type": "fallback",
            "note": "⚠️ AI quota exceeded. This is a basic text summary without AI processing."
        }
        
    except Exception as e:
        return {"error": f"Failed to create fallback summary: {str(e)}"}

async def fast_summarize(transcript_text):
    """Ultra-fast single-call summarization for all videos"""
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
        prompt = f"Summarize in 15 bullet points:\n{truncated_text}"
        model = genai.GenerativeModel("gemini-1.5-flash")
        response = model.generate_content(
            prompt,
            generation_config={
                "temperature": 0.1,
                "max_output_tokens": 100,
                "top_p": 0.5
            }
        )
        
        result = {"summary": response.text, "type": "fast"}
        if note:
            result["note"] = note
            
        return result
        
    except Exception as e:
        error_msg = str(e)
        if "quota" in error_msg.lower() or "rate limit" in error_msg.lower():
            return await fallback_summarize(transcript_text)
        return {"error": f"Failed to summarize video: {error_msg}"}

async def complete_summarize(transcript_text):
    """Complete summarization covering the entire video"""
    try:
        cleaned_text = transcript_text.strip()
        if not cleaned_text:
            return {"error": "No content found in captions"}
        
        words = cleaned_text.split()
        total_words = len(words)
        if total_words <= 1000:
            return await fast_summarize(transcript_text)

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
