import { getTranscript } from 'youtube-transcript';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  try {
    const { url } = req.body || {};
    if (!url) {
      res.status(400).json({ error: 'Missing url' });
      return;
    }
    const match = url.match(/(?:youtube\.com\/(?:[^\/\n\s]+\/\S+\/|(?:v|e(?:mbed)?|shorts)\/|.*[?&]v=)|youtu\.be\/)([\w-]{11})/);
    const videoId = match ? match[1] : url;
    if (!videoId) {
      res.status(400).json({ error: 'Invalid YouTube URL' });
      return;
    }
    const transcriptArr = await getTranscript(videoId);
    const transcriptText = transcriptArr.map(line => line.text).join(' ');
    res.status(200).json({ transcript: transcriptText });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to fetch transcript' });
  }
} 
