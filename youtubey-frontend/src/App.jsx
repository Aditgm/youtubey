import React, { useState, useEffect } from 'react';
import {
  Box,
  TextField,
  Button,
  Typography,
  Paper,
  AppBar,
  Toolbar,
  Avatar,
  CircularProgress,
  List,
  ListItem,
  Divider,
  Card,
  CardContent,
  CardMedia,
  CardActionArea,
  IconButton as MuiIconButton,
  useTheme,
  ThemeProvider,
  createTheme,
  useMediaQuery,
  Link,
  Snackbar,
  Alert,
  Tooltip,
  IconButton
} from '@mui/material';
import Brightness7Icon from '@mui/icons-material/Brightness7';
import Brightness2Icon from '@mui/icons-material/Brightness2';
import '@fontsource/tektur';
import '@fontsource/libertinus-math';
import { useRef } from 'react';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { MathJax, MathJaxContext } from 'better-react-mathjax';

function YouTubeLogo({ size = 32 }) {
  return (
    <svg height={size} viewBox="0 0 48 48" width={size} style={{ marginRight: 8 }}>
      <g>
        <path fill="#FF0000" d="M44.8 13.6s-.4-3.2-1.6-4.4c-1.6-1.6-3.2-1.6-4-1.6C32 7.2 24 7.2 24 7.2h-.1s-8 0-15.2.4c-.8 0-2.4 0-4 1.6C3.2 10.4 2.8 13.6 2.8 13.6S2.4 16.8 2.4 20v3.2c0 3.2.4 6.4.4 6.4s.4 3.2 1.6 4.4c1.6 1.6 3.6 1.6 4.4 1.6 3.2.4 13.2.4 13.2.4s8 0 15.2-.4c.8 0 2.4 0 4-1.6 1.2-1.2 1.6-4.4 1.6-4.4s.4-3.2.4-6.4V20c0-3.2-.4-6.4-.4-6.4z"/>
        <path fill="#FFF" d="M19.2 29.6V16.8l12.8 6.4-12.8 6.4z"/>
      </g>
    </svg>
  );
}

function extractYouTubeId(url) {
  const regExp = /(?:youtube\.com\/(?:[^\/\n\s]+\/\S+\/|(?:v|e(?:mbed)?|shorts)\/|.*[?&]v=)|youtu\.be\/)([\w-]{11})/;
  const match = url.match(regExp);
  return match ? match[1] : null;
}

function App() {
  const [url, setUrl] = useState('');
  const [summary, setSummary] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [videoTitle, setVideoTitle] = useState('');
  const [titleLoading, setTitleLoading] = useState(false);
  const [titleError, setTitleError] = useState('');
  const [mode, setMode] = useState(() => {
    return localStorage.getItem('youtubey-theme-mode') || 'dark';
  });
  const [suggestions, setSuggestions] = useState([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [suggestionsError, setSuggestionsError] = useState('');
  const [summaryClicked, setSummaryClicked] = useState(false);
  const [summaryType, setSummaryType] = useState('fast');
  const [summaryNote, setSummaryNote] = useState('');
  const [snackbarOpen, setSnackbarOpen] = useState(false);
  const [snackbarMsg, setSnackbarMsg] = useState('');
  const urlInputRef = useRef(null);

  useEffect(() => {
    localStorage.setItem('youtubey-theme-mode', mode);
  }, [mode]);

  const videoId = extractYouTubeId(url);
  const thumbnailUrl = videoId ? `https://img.youtube.com/vi/${videoId}/hqdefault.jpg` : null;
  const videoUrl = videoId ? `https://www.youtube.com/watch?v=${videoId}` : null;

  useEffect(() => {
    if (!videoId) {
      setVideoTitle('');
      setTitleError('');
      setTitleLoading(false);
      return;
    }
    setTitleLoading(true);
    setTitleError('');
    setVideoTitle('');
    const apiKey = import.meta.env.VITE_YOUTUBE_API_KEY;
    if (!apiKey) {
      setTitleError('No YouTube API key found.');
      setTitleLoading(false);
      return;
    }
    fetch(`https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${videoId}&key=${apiKey}`)
      .then(res => res.json())
      .then(data => {
        if (data.items && data.items.length > 0) {
          setVideoTitle(data.items[0].snippet.title);
        } else {
          setTitleError('Video not found or API quota exceeded.');
        }
        setTitleLoading(false);
      })
      .catch(() => {
        setTitleError('Failed to fetch video title.');
        setTitleLoading(false);
      });
  }, [videoId]);

  useEffect(() => {
    if (!videoId || !videoTitle) {
      setSuggestions([]);
      setSuggestionsError('');
      setSuggestionsLoading(false);
      return;
    }
    setSuggestionsLoading(true);
    setSuggestionsError('');
    setSuggestions([]);
    const apiKey = import.meta.env.VITE_YOUTUBE_API_KEY;
    if (!apiKey) {
      setSuggestionsError('No YouTube API key found.');
      setSuggestionsLoading(false);
      return;
    }

    const fetchHybridSuggestions = async () => {
      try {
        const videoDetailsResponse = await fetch(
          `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&id=${videoId}&key=${apiKey}`
        );
        const videoDetails = await videoDetailsResponse.json();

        if (!videoDetails.items || videoDetails.items.length === 0) {
          setSuggestionsError('Video details not found.');
          setSuggestionsLoading(false);
          return;
        }

        const video = videoDetails.items[0];
        const categoryId = video.snippet.categoryId;
        const channelId = video.snippet.channelId;
        const title = video.snippet.title;

        const keywords = title
          .toLowerCase()
          .split(/\s+/)
          .filter(word => word.length > 3)
          .slice(0, 3)
          .join(' ');

        const [categorySuggestions, channelSuggestions, keywordSuggestions] = await Promise.all([
          fetch(`https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=6&videoCategoryId=${categoryId}&order=viewCount&key=${apiKey}`).then(r => r.json()),
          fetch(`https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=6&channelId=${channelId}&order=viewCount&key=${apiKey}`).then(r => r.json()),
          fetch(`https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=6&q=${encodeURIComponent(keywords)}&order=relevance&key=${apiKey}`).then(r => r.json())
        ]);

        const allSuggestions = [
          ...(categorySuggestions.items || []),
          ...(channelSuggestions.items || []),
          ...(keywordSuggestions.items || [])
        ];

        const uniqueSuggestions = allSuggestions
          .filter((item, index, self) =>
            item.id.videoId !== videoId &&
            self.findIndex(s => s.id.videoId === item.id.videoId) === index
          )
          .slice(0, 12);

        setSuggestions(uniqueSuggestions);
        setSuggestionsLoading(false);
      } catch (error) {
        console.error('Error fetching suggestions:', error);
        setSuggestionsError('Failed to fetch suggestions.');
        setSuggestionsLoading(false);
      }
    };

    fetchHybridSuggestions();
  }, [videoId, videoTitle]);

  const handleSummarize = async () => {
    setError('');
    setSummary([]);
    setSummaryClicked(true);
    setSummaryNote('');
    
    if (!url.trim()) {
      setError('Please enter a YouTube URL.');
      return;
    }
    
    setLoading(true);
    
    try {
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:8000';
      const response = await fetch(`${apiUrl}/summarize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, summary_type: summaryType }),
      });
      const result = await response.json();
      
      if (result.summary) {
        const points = result.summary
          .split(/\n|•|\d+\./)
          .map(s => s.trim())
          .filter(Boolean);
        setSummary(points);
        if (result.note) {
          setSummaryNote(result.note);
        }
      } else if (result.error) {
        setError(result.error);
      } else {
        setError('Unexpected response from server.');
      }
    } catch (e) {
      setError('Failed to fetch summary.');
    }
    
    setLoading(false);
  };

  const handleSuggestionClick = (videoId) => {
    setUrl(`https://www.youtube.com/watch?v=${videoId}`);
    setTimeout(() => {
      handleSummarize();
    }, 1000);
  };

  const handleCopySummary = () => {
    if (summary.length > 0) {
      navigator.clipboard.writeText(summary.join('\n'));
      setSnackbarMsg('Summary copied!');
      setSnackbarOpen(true);
    }
  };

  const handleSnackbarClose = (event, reason) => {
    if (reason === 'clickaway') return;
    setSnackbarOpen(false);
  };

  const theme = createTheme({
    palette: {
      mode,
      ...(mode === 'dark'
        ? {
            background: { default: '#141414', paper: '#181818' },
            text: { primary: '#fff' },
            primary: { main: '#E50914' },
          }
        : {
            background: { default: '#f5f6fa', paper: '#fff' },
            text: { primary: '#181818' },
            primary: { main: '#E50914' },
          }),
    },
  });

  return (
    <ThemeProvider theme={theme}>
      <Box sx={{
        minHeight: '100vh',
        width: '100vw',
        bgcolor: 'background.default',
        position: 'relative',
      }}>
        {}
        <AppBar position="static" color="default" elevation={0} sx={{ bgcolor: 'background.paper', borderBottom: mode === 'dark' ? '1px solid #222' : '1px solid #eee' }}>
          <Toolbar sx={{ pl: 2 }}>
            <Avatar src="https://i.ibb.co/TxvZLh4Z/image-youtubey.png" alt="YouTubey Logo" sx={{ width: 40, height: 40, mr: 1, bgcolor: 'transparent' }} />
            <Typography variant="h5" color="primary" fontWeight={900} sx={{ letterSpacing: 2, fontFamily: 'Tektur, sans-serif', fontSize: '2rem' }}>
              Youtubey
            </Typography>
          </Toolbar>
        </AppBar>
        
        {}
        <Box display="flex" alignItems="center" justifyContent="center" minHeight="calc(100vh - 64px)">
          <Paper
            elevation={8}
            sx={{
              p: 4,
              bgcolor: 'background.paper',
              borderRadius: 5,
              boxShadow: mode === 'dark' ? '0 8px 32px 0 rgba(229, 9, 20, 0.15)' : '0 8px 32px 0 rgba(31, 38, 135, 0.08)',
              minWidth: { xs: '99vw', sm: 620 },
              maxWidth: { xs: '100vw', sm: 930, md: 1130 },
              width: '100%',
              color: 'text.primary',
            }}
          >
            <Box display="flex" alignItems="center" justifyContent="center" mb={2}>
              <YouTubeLogo size={40} />
              <Typography variant="h5" fontWeight={700} color="primary" sx={{ fontFamily: 'Libertinus Math, serif', ml: 1 }}>
                YouTube Summary
              </Typography>
            </Box>
            <Typography variant="subtitle1" align="center" gutterBottom sx={{ color: 'text.primary', opacity: 0.85 }}>
              Paste a YouTube link to get a smart summary!
            </Typography>

            {}
            <Box display="flex" justifyContent="center" mb={2}>
              <Box sx={{ display: 'flex', bgcolor: mode === 'dark' ? '#232323' : '#f5f6fa', borderRadius: 2, p: 0.5 }}>
                <Button
                  variant={summaryType === 'fast' ? 'contained' : 'text'}
                  onClick={() => setSummaryType('fast')}
                  sx={{
                    borderRadius: 1.5,
                    textTransform: 'none',
                    fontWeight: 600,
                    minWidth: 100,
                    color: summaryType === 'fast' ? '#fff' : 'text.primary',
                    bgcolor: summaryType === 'fast' ? 'primary.main' : 'transparent',
                    '&:hover': {
                      bgcolor: summaryType === 'fast' ? 'primary.dark' : 'rgba(0,0,0,0.04)',
                    }
                  }}
                >
                  ⚡ Fast
                </Button>
                <Button
                  variant={summaryType === 'complete' ? 'contained' : 'text'}
                  onClick={() => setSummaryType('complete')}
                  sx={{
                    borderRadius: 1.5,
                    textTransform: 'none',
                    fontWeight: 600,
                    minWidth: 100,
                    color: summaryType === 'complete' ? '#fff' : 'text.primary',
                    bgcolor: summaryType === 'complete' ? 'primary.main' : 'transparent',
                    '&:hover': {
                      bgcolor: summaryType === 'complete' ? 'primary.dark' : 'rgba(0,0,0,0.04)',
                    }
                  }}
                >
                  📋 Complete
                </Button>
                <Button
                  variant={summaryType === 'simple' ? 'contained' : 'text'}
                  onClick={() => setSummaryType('simple')}
                  sx={{
                    borderRadius: 1.5,
                    textTransform: 'none',
                    fontWeight: 600,
                    minWidth: 100,
                    color: summaryType === 'simple' ? '#fff' : 'text.primary',
                    bgcolor: summaryType === 'simple' ? 'primary.main' : 'transparent',
                    '&:hover': {
                      bgcolor: summaryType === 'simple' ? 'primary.dark' : 'rgba(0,0,0,0.04)',
                    }
                  }}
                >
                  📝 Simple
                </Button>
              </Box>
            </Box>
            {}
            <Typography variant="body2" align="center" sx={{ color: 'text.secondary', mb: 2, fontStyle: 'italic' }}>
              {summaryType === 'fast'
                ? '⚡ Quick summary (first 500 words) - 2-3 seconds'
                : summaryType === 'complete'
                  ? '📋 Complete summary (entire video) - 10-30 seconds'
                  : '📝 Simple summary (no AI, just first 10 sentences) - instant'}
            </Typography>

            {}
            <Box display="flex" flexDirection={{ xs: 'column', sm: 'row' }} gap={2} mt={2} mb={5}>
              <TextField
                ref={urlInputRef}
                label="YouTube URL"
                variant="filled"
                fullWidth
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                disabled={loading}
                autoFocus
                sx={{
                  bgcolor: mode === 'dark' ? '#232323' : '#f5f6fa',
                  borderRadius: 3,
                  input: { color: 'text.primary', fontWeight: 500 },
                  label: { color: mode === 'dark' ? '#aaa' : '#888' },
                  '& .MuiFilledInput-root': {
                    borderRadius: 3,
                    backgroundColor: mode === 'dark' ? '#232323' : '#f5f6fa',
                  },
                }}
                InputLabelProps={{ style: { color: mode === 'dark' ? '#aaa' : '#888' } }}
              />
              <Button
                variant="contained"
                color="primary"
                onClick={handleSummarize}
                disabled={loading}
                sx={{
                  minWidth: { xs: '100%', sm: 120 },
                  borderRadius: 999,
                  fontWeight: 700,
                  fontSize: { xs: '1rem', sm: '1.1rem' },
                  boxShadow: mode === 'dark' ? '0 2px 8px 0 rgba(229, 9, 20, 0.15)' : '0 2px 8px 0 rgba(31, 38, 135, 0.08)',
                  textTransform: 'none',
                  py: { xs: 1.5, sm: 1.2 },
                }}
              >
                {loading ? <CircularProgress size={24} sx={{ color: '#fff' }} /> : 'Summarize'}
              </Button>
            </Box>

            {}
            {error && (
              <Box mt={4} mb={4} display="flex" justifyContent="center">
                <Paper elevation={3} sx={{
                  p: { xs: 2, sm: 4 },
                  bgcolor: mode === 'dark' ? '#2a1a1a' : '#fff5f5',
                  borderRadius: 4,
                  minWidth: { xs: '90vw', sm: 500 },
                  maxWidth: 800,
                  mx: 'auto',
                  border: '1px solid',
                  borderColor: 'error.main',
                }}>
                  <Box display="flex" alignItems="center" gap={2}>
                    <span style={{ fontSize: 32, color: '#d32f2f' }}>⚠️</span>
                    <Box>
                      <Typography variant="h6" sx={{ color: 'error.main', fontWeight: 700, mb: 1 }}>
                        Summary Unavailable
                      </Typography>
                      <Typography variant="body1" sx={{ color: 'text.primary', opacity: 0.9 }}>
                        {error.includes('No transcripts') && 'This video has no available transcripts. Try a different video.'}
                        {error.includes('private') && 'This video is private or restricted. Try a public video.'}
                        {error.includes('quota') && 'API quota exceeded. Please try again later.'}
                        {error.includes('Failed to fetch') && 'Network error. Please check your connection and try again.'}
                        {!error.includes('No transcripts') && !error.includes('private') && !error.includes('quota') && !error.includes('Failed to fetch') && error}
                      </Typography>
                      <Typography variant="body2" sx={{ color: 'text.secondary', mt: 1, fontStyle: 'italic' }}>
                        Tip: Try videos with English captions or subtitles for better results.
                      </Typography>
                    </Box>
                  </Box>
                </Paper>
              </Box>
            )}

            {}
            <Box
              sx={{
                boxShadow: mode === 'dark' ? '0 0 0 2px #E50914, 0 8px 32px 0 rgba(229, 9, 20, 0.10)' : '0 0 0 2px #E50914, 0 8px 32px 0 rgba(31, 38, 135, 0.05)',
                borderRadius: 4,
                mb: 4,
                p: 2,
                background: mode === 'dark' ? '#181818' : '#fff',
                minHeight: 400,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexDirection: 'column',
              }}
            >
              {videoId ? (
                <Box mb={1} display="flex" flexDirection="column" alignItems="center" justifyContent="center" width="100%">
                  {titleLoading ? (
                    <CircularProgress size={24} sx={{ color: 'primary.main', mb: 2 }} />
                  ) : videoTitle ? (
                    <Typography variant="subtitle1" sx={{ color: 'text.primary', fontWeight: 600, mb: 1, textAlign: 'center' }}>
                      {videoTitle}
                    </Typography>
                  ) : titleError ? (
                    <Typography variant="body2" sx={{ color: 'primary.main', mb: 1, textAlign: 'center' }}>{titleError}</Typography>
                  ) : null}
                  
                  <Box sx={{ width: '100%', maxWidth: 800, height: 360, position: 'relative' }}>
                    <iframe
                      width="100%"
                      height="360"
                      style={{ borderRadius: 12, background: '#000' }}
                      src={`https://www.youtube.com/embed/${videoId}`}
                      title="YouTube video player"
                      frameBorder="0"
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                      allowFullScreen
                    />
                  </Box>
                  
                  <Link href={videoUrl} target="_blank" rel="noopener" underline="hover" sx={{ color: 'primary.main', fontWeight: 600, mt: 1, fontSize: '1.05rem' }}>
                    {videoUrl}
                  </Link>
                </Box>
              ) : (
                <Typography variant="h6" sx={{ color: 'text.secondary', opacity: 0.7, textAlign: 'center', fontWeight: 500 }}>
                  Video to be played
                </Typography>
              )}
            </Box>

            {/* Summary Section */}
            {summaryClicked && (
              <>
                <Divider sx={{ my: 5 }} />
                <Box sx={{ mb: 4, width: '100%', display: 'flex', justifyContent: 'center' }}>
                  <Paper elevation={3} sx={{
                    p: { xs: 2, sm: 4 },
                    bgcolor: mode === 'dark' ? '#232323' : '#f9f9f9',
                    borderRadius: 4,
                    minWidth: { xs: '90vw', sm: 500 },
                    maxWidth: 800,
                    mx: 'auto',
                  }}>
                    <Box mb={2} display="flex" alignItems="center" gap={1}>
                      <Typography variant="h5" sx={{ color: 'primary.main', fontWeight: 800 }}>
                        Summary {summaryType === 'fast' ? '⚡' : '📋'}
                      </Typography>
                      <MuiIconButton size="small" onClick={handleCopySummary} sx={{ color: 'primary.main' }}>
                        <ContentCopyIcon fontSize="small" />
                      </MuiIconButton>
                    </Box>
                    
                    {summaryNote && (
                      <Box mb={2} sx={{
                        bgcolor: mode === 'dark' ? '#1a1a1a' : '#f0f8ff',
                        p: 1.5,
                        borderRadius: 2,
                        border: '1px solid',
                        borderColor: mode === 'dark' ? '#333' : '#e3f2fd'
                      }}>
                        <Typography variant="body2" sx={{
                          color: 'text.secondary',
                          fontStyle: 'italic',
                          fontSize: '0.9rem'
                        }}>
                          ℹ️ {summaryNote}
                        </Typography>
                      </Box>
                    )}
                    
                    <MathJaxContext>
                      <List sx={{
                        pl: 0,
                        listStyle: 'none',
                        bgcolor: mode === 'dark' ? '#232323' : '#f5f5f7',
                        borderRadius: 3,
                        boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
                        py: 1,
                      }}>
                        {summary.map((point, idx) => {
                          const cleanPoint = point.replace(/^\s*\*\s*/, '');
                          return (
                            <ListItem
                              key={idx}
                              sx={{
                                display: 'flex',
                                alignItems: 'flex-start',
                                gap: 1.5,
                                pl: 0,
                                color: 'text.primary',
                                fontSize: { xs: '0.9rem', sm: '0.98rem' },
                                opacity: 0.98,
                                mb: 0.1,
                                lineHeight: 1.4,
                                fontWeight: 500,
                                border: 'none',
                                background: 'none',
                                borderRadius: 2,
                                px: { xs: 1, sm: 1.2 },
                                py: { xs: 0.5, sm: 0.7 },
                                '&:hover': {
                                  background: mode === 'dark' ? '#292929' : '#ececec',
                                },
                              }}
                              disableGutters
                            >
                              <span style={{
                                display: 'inline-block',
                                width: 8,
                                height: 8,
                                minWidth: 8,
                                minHeight: 8,
                                marginTop: 7,
                                marginRight: 14,
                                borderRadius: '50%',
                                background: mode === 'dark' ? '#E50914' : '#E50914',
                              }} aria-hidden="true"></span>
                              <MathJax inline dynamic>{cleanPoint}</MathJax>
                            </ListItem>
                          );
                        })}
                      </List>
                    </MathJaxContext>
                  </Paper>
                </Box>
              </>
            )}

            {/* Suggestions Section */}
            <Divider sx={{ my: 5 }} />
            <Box sx={{ mt: 2, mb: 2, borderRadius: 3, boxShadow: '0 2px 8px rgba(0,0,0,0.04)', p: 2 }}>
              {videoId && (
                <Box>
                  <Typography variant="h6" sx={{ color: 'primary.main', fontWeight: 700, mb: 1 }}>
                    Suggestions
                  </Typography>
                  {suggestionsLoading ? (
                    <CircularProgress size={24} sx={{ color: 'primary.main', my: 2 }} />
                  ) : suggestionsError ? (
                    <Typography variant="body2" sx={{ color: 'primary.main', mb: 1 }}>{suggestionsError}</Typography>
                  ) : suggestions.length > 0 ? (
                    <Box>
                      <Box sx={{ display: 'flex', overflowX: 'auto', gap: 2, py: 1, maxWidth: 930, mx: 'auto', justifyContent: 'center' }}>
                        {suggestions.map((item) => (
                          <Card key={item.id.videoId} sx={{ 
                            minWidth: 180, 
                            maxWidth: 200, 
                            bgcolor: 'background.default', 
                            color: 'text.primary', 
                            borderRadius: 3, 
                            boxShadow: 2,
                            '&:hover': {
                              boxShadow: '0 4px 12px 0 rgba(0,0,0,0.15)',
                            }
                          }}>
                            <CardActionArea onClick={() => handleSuggestionClick(item.id.videoId)}>
                              <CardMedia
                                component="img"
                                height="100"
                                image={item.snippet.thumbnails.medium.url}
                                alt={item.snippet.title}
                                sx={{ borderTopLeftRadius: 12, borderTopRightRadius: 12 }}
                              />
                              <CardContent sx={{ p: 1.2 }}>
                                <Typography variant="subtitle2" sx={{ fontWeight: 600, fontSize: '0.95rem', mb: 0.5, color: 'text.primary' }} noWrap>
                                  {item.snippet.title}
                                </Typography>
                                <Typography variant="caption" sx={{ color: 'text.secondary' }} noWrap>
                                  {item.snippet.channelTitle}
                                </Typography>
                              </CardContent>
                            </CardActionArea>
                          </Card>
                        ))}
                      </Box>
                    </Box>
                  ) : (
                    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', py: 3, opacity: 0.7 }}>
                      <span style={{ fontSize: 38, color: '#aaa', marginBottom: 8 }}>💡</span>
                      <Typography variant="body1" sx={{ color: 'text.secondary', fontWeight: 500 }}>
                        No suggestions found for this video.
                      </Typography>
                    </Box>
                  )}
                </Box>
              )}
            </Box>
          </Paper>
        </Box>

        {}
        <Tooltip title={mode === 'dark' ? 'Light mode' : 'Dark mode'}>
          <IconButton
            onClick={() => setMode(mode === 'dark' ? 'light' : 'dark')}
            sx={{
              position: 'fixed',
              bottom: 32,
              right: 32,
              bgcolor: mode === 'dark' ? '#fff' : '#181818',
              color: mode === 'dark' ? '#E50914' : '#fff',
              boxShadow: '0 2px 8px rgba(0,0,0,0.18)',
              width: 56,
              height: 56,
              zIndex: 2000,
              '&:hover': { 
                bgcolor: mode === 'dark' ? '#ffe0e0' : '#222',
              }
            }}
          >
            {mode === 'dark' ? <Brightness7Icon fontSize="large" /> : <Brightness2Icon fontSize="large" />}
          </IconButton>
        </Tooltip>

        {}
        <Snackbar
          open={snackbarOpen}
          autoHideDuration={2000}
          onClose={handleSnackbarClose}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        >
          <Alert onClose={handleSnackbarClose} severity="success" sx={{ width: '100%' }}>
            {snackbarMsg}
          </Alert>
        </Snackbar>
      </Box>
    </ThemeProvider>
  );
}

export default App;
