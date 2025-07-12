export default function handler(req, res) {
  res.status(200).json({ status: 'healthy', message: 'Youtubey backend (Node.js Vercel Function) is running!' });
} 
