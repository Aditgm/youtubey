import fetch from 'node-fetch';
import { getTranscript } from 'youtube-transcript';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent';

function extractVideoId(url) {
  const match = url.match(/(?:youtube\.com\/(?:[^\/\n\s]+\/\S+\/|(?:v|e(?:mbed)?|shorts)\/|.*[?&]v=)|youtu\.be\/)([\w-]{11})/);
  return match ? match[1] : url;
}

function fallbackSummary(transcriptText) {
  const cleaned = transcriptText.trim();
  if (!cleaned) return { error: 'No content found in captions' };
  const sentences = cleaned.split('.');
  const summarySentences = sentences.slice(0, 10);
  const basicSummary = summarySentences.join('. ') + '.';
  const words = basicSummary.split(' ');
  let bulletPoints = [], current = [];
  for (const word of words) {
    current.push(word);
    if (current.length >= 15) {
      bulletPoints.push(current.join(' '));
      current = [];
    }
  }
  if (current.length) bulletPoints.push(current.join(' '));
  return {
    summary: bulletPoints.map(pt => `• ${pt}`).join('\n'),
    type: 'fallback',
    note: '📝 Simple summary (no AI used).'
  };
}

async function geminiSummarize(text, type) {
  if (!GEMINI_API_KEY) return { error: 'No Gemini API key set.' };
  let prompt = '';
  if (type === 'fast') {
    prompt = `Summarize the following YouTube transcript in concise bullet points. Use LaTeX for any math. Limit to 8 points.\n\nTranscript:\n${text}`;
  } else {
    prompt = `Summarize the following YouTube transcript in detailed bullet points. Use LaTeX for any math. Cover all main ideas.\n\nTranscript:\n${text}`;
  }
  const body = {
    contents: [{ parts: [{ text: prompt }] }]
  };
  const url = `${GEMINI_API_URL}?key=${GEMINI_API_KEY}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!resp.ok) return { error: 'Gemini API error' };
  const data = await resp.json();
  const summary = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  return { summary };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  try {
    const { url, summary_type = 'fast' } = req.body || {};
    if (!url) {
      res.status(400).json({ error: 'Missing url' });
      return;
    }
    const videoId = extractVideoId(url);
    if (!videoId) {
      res.status(400).json({ error: 'Invalid YouTube URL' });
      return;
    }
    const transcriptArr = await getTranscript(videoId);
    const transcriptText = transcriptArr.map(line => line.text).join(' ');
    if (summary_type === 'simple') {
      const simple = fallbackSummary(transcriptText);
      res.status(200).json(simple);
      return;
    }
    if (summary_type === 'fast') {
      const first500 = transcriptText.split(' ').slice(0, 500).join(' ');
      const result = await geminiSummarize(first500, 'fast');
      res.status(200).json(result);
      return;
    }
    let chunks = [];
    const words = transcriptText.split(' ');
    for (let i = 0; i < words.length; i += 1000) {
      chunks.push(words.slice(i, i + 1000).join(' '));
    }
    let allSummaries = [];
    for (const chunk of chunks) {
      const result = await geminiSummarize(chunk, 'complete');
      if (result.summary) allSummaries.push(result.summary);
    }
    res.status(200).json({ summary: allSummaries.join('\n') });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to summarize' });
  }
} 
