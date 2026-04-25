import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { ArrowLeft, Mic, MicOff, Send, VolumeX, FileText, Camera, Monitor, ShieldAlert } from 'lucide-react';
import { useInterview } from '../context/interview-context';
import { detectPhoneInFrame, generateSpeech } from '../lib/api';
import { Button } from '../components/ui/button';
import { Textarea } from '../components/ui/textarea';
import { Badge } from '../components/ui/badge';
import { Card, CardContent } from '../components/ui/card';
import { cn } from '../lib/utils';

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const STARTING_MERIT = 100;
const PENALTY = {
  tabSwitch: 15,
  focusLoss: 10,
  noFace: 10,
  lookAway: 8,
  phoneDetected: 25,
  cameraStopped: 30,
  screenStopped: 30,
};
const VIOLATION_COOLDOWN_MS = 12000;
const PROCTORING_CHECK_INTERVAL_MS = 2000;
const LOOK_AWAY_STREAK_THRESHOLD = 3;
const CONTINUOUS_VIOLATION_WINDOW_MS = 5000;
const FACE_WIDTH_MIN_RATIO = 0.12;
const FACE_HEIGHT_MIN_RATIO = 0.12;
const FACE_CENTER_X_MIN = 0.2;
const FACE_CENTER_X_MAX = 0.8;
const FACE_CENTER_Y_MIN = 0.18;
const FACE_CENTER_Y_MAX = 0.72;

export function InterviewPage() {
  const navigate = useNavigate();
  const { state, submitCandidateMessage } = useInterview();
  const [draft, setDraft] = useState('');
  const [interimTranscript, setInterimTranscript] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isPushToTalkHeld, setIsPushToTalkHeld] = useState(false);
  const [error, setError] = useState('');
  const [inputStatus, setInputStatus] = useState(SpeechRecognition ? 'Mic ready' : 'Mic unavailable (use Chrome/Edge)');
  const [merit, setMerit] = useState(STARTING_MERIT);
  const [violations, setViolations] = useState([]);
  const [proctoringReady, setProctoringReady] = useState(false);
  const [proctoringError, setProctoringError] = useState('');
  const [interviewFailed, setInterviewFailed] = useState(false);
  const [faceBox, setFaceBox] = useState(null);
  const [isFaceDetected, setIsFaceDetected] = useState(false);

  const recognitionRef = useRef(null);
  const audioRef = useRef(null);
  const openingMessageKeyRef = useRef('');
  const messagesEndRef = useRef(null);
  const cameraStreamRef = useRef(null);
  const screenStreamRef = useRef(null);
  const cameraVideoRef = useRef(null);
  const monitorIntervalRef = useRef(null);
  const faceDetectorRef = useRef(null);
  const captureCanvasRef = useRef(null);
  const lastViolationRef = useRef({});
  const phoneCheckInFlightRef = useRef(false);
  const isSpacePressedRef = useRef(false);
  const faceSignalRef = useRef({ lookAwayStreak: 0 });
  const noFaceSinceRef = useRef(null);
  const phoneDetectedSinceRef = useRef(null);

  const messages = useDeferredValue(state.messages);
  const retrievedContext = useDeferredValue(state.retrievedContext);
  const isComputerVisionMode = state.interviewMode === 'computer_vision';

  const orbMode = useMemo(() => {
    if (isListening) return 'listening';
    if (isSpeaking) return 'speaking';
    if (isThinking) return 'thinking';
    return 'idle';
  }, [isListening, isSpeaking, isThinking]);

  const registerViolation = useCallback((type, reason) => {
    const now = Date.now();
    const lastAt = lastViolationRef.current[type] ?? 0;
    if (now - lastAt < VIOLATION_COOLDOWN_MS) return;
    lastViolationRef.current[type] = now;
    const penalty = PENALTY[type] ?? 5;
    setViolations((current) => [
      {
        id: crypto.randomUUID(),
        reason,
        penalty,
        at: new Date().toISOString(),
      },
      ...current,
    ].slice(0, 8));
    setMerit((current) => {
      const next = Math.max(0, current - penalty);
      if (next === 0) {
        setInterviewFailed(true);
        setError('Merit reached 0. Candidate failed due to proctoring violations.');
      }
      return next;
    });
  }, []);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (!SpeechRecognition) return;
    const recognition = new SpeechRecognition();
    recognition.lang = 'en-US';
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onstart = () => { setIsListening(true); setInputStatus('Listening...'); setError(''); };
    recognition.onresult = (event) => {
      let interim = ''; let finalText = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const t = event.results[i][0].transcript.trim();
        if (!t) continue;
        if (event.results[i].isFinal) finalText += t + ' ';
        else interim += t + ' ';
      }
      setInterimTranscript(interim.trim());
      if (finalText.trim()) setDraft((current) => (current + ' ' + finalText.trim()).trim());
    };
    recognition.onerror = (e) => { setIsListening(false); setInputStatus(`Mic error: ${e.error}`); };
    recognition.onend = () => { setIsListening(false); setInputStatus('Mic ready'); };
    recognitionRef.current = recognition;
    return () => { recognition.stop(); recognitionRef.current = null; };
  }, []);

  const stopPlayback = useCallback(() => {
    if (!audioRef.current) return;
    audioRef.current.pause();
    audioRef.current.currentTime = 0;
    audioRef.current = null;
    setIsSpeaking(false);
  }, []);

  const speakReply = useCallback(async (text, phase) => {
    try {
      stopPlayback();
      const speech = await generateSpeech({ text, phase, voice: state.defaultVoice });
      const audio = new Audio(`data:${speech.mime_type};base64,${speech.audio_base64}`);
      audioRef.current = audio;
      audio.onplay = () => setIsSpeaking(true);
      audio.onended = () => { if (audioRef.current === audio) audioRef.current = null; setIsSpeaking(false); };
      audio.onerror = () => { setIsSpeaking(false); setError('Voice playback failed.'); };
      await audio.play();
    } catch (e) { 
      setIsSpeaking(false); 
      setError(e.message); 
    }
  }, [state.defaultVoice, stopPlayback]);

  useEffect(() => {
    if (!['voice', 'computer_vision'].includes(state.interviewMode) || !state.sessionId || !state.openingMessage) return;
    const currentKey = state.sessionId + ':' + state.openingMessage;
    if (openingMessageKeyRef.current === currentKey) return;
    openingMessageKeyRef.current = currentKey;
    void speakReply(state.openingMessage, state.phase);
  }, [speakReply, state.interviewMode, state.openingMessage, state.phase, state.sessionId]);

  useEffect(() => { return () => { stopPlayback(); recognitionRef.current?.stop(); }; }, [stopPlayback]);

  useEffect(() => {
    if (!isComputerVisionMode || !recognitionRef.current || !SpeechRecognition) return;

    function handleKeyDown(event) {
      if (event.code !== 'Space' || event.repeat || event.ctrlKey || event.altKey || event.metaKey) return;
      event.preventDefault();
      if (isSpacePressedRef.current) return;
      isSpacePressedRef.current = true;
      if (!isListening) {
        try {
          recognitionRef.current.start();
          setIsPushToTalkHeld(true);
        } catch {
          // Ignore repeated start race conditions.
        }
      }
    }

    function handleKeyUp(event) {
      if (event.code !== 'Space') return;
      event.preventDefault();
      isSpacePressedRef.current = false;
      if (isListening) {
        recognitionRef.current.stop();
      }
      setIsPushToTalkHeld(false);
    }

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [isComputerVisionMode, isListening]);

  const stopProctoring = useCallback(() => {
    if (monitorIntervalRef.current) {
      clearInterval(monitorIntervalRef.current);
      monitorIntervalRef.current = null;
    }
    if (cameraStreamRef.current) {
      cameraStreamRef.current.getTracks().forEach((track) => track.stop());
      cameraStreamRef.current = null;
    }
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach((track) => track.stop());
      screenStreamRef.current = null;
    }
    if (cameraVideoRef.current) {
      cameraVideoRef.current.srcObject = null;
    }
    faceSignalRef.current = { lookAwayStreak: 0 };
    noFaceSinceRef.current = null;
    phoneDetectedSinceRef.current = null;
    setIsFaceDetected(false);
    setFaceBox(null);
    setProctoringReady(false);
  }, []);

  const detectPhoneFromCurrentFrame = useCallback(async () => {
    const video = cameraVideoRef.current;
    const canvas = captureCanvasRef.current;
    if (!video || !canvas || video.videoWidth === 0 || video.videoHeight === 0) return false;
    if (phoneCheckInFlightRef.current) return false;

    phoneCheckInFlightRef.current = true;
    try {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) return false;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.7));
      if (!blob) return false;

      const result = await detectPhoneInFrame(blob);
      return Boolean(result.phone_detected);
    } catch {
      // Ignore transient detection request failures.
      return false;
    } finally {
      phoneCheckInFlightRef.current = false;
    }
  }, []);

  const startProctoring = useCallback(async () => {
    if (!isComputerVisionMode) return;
    setProctoringError('');
    try {
      const [cameraStream, screenStream] = await Promise.all([
        navigator.mediaDevices.getUserMedia({ video: true }),
        navigator.mediaDevices.getDisplayMedia({ video: true, audio: false }),
      ]);

      cameraStreamRef.current = cameraStream;
      screenStreamRef.current = screenStream;

      if (cameraVideoRef.current) {
        cameraVideoRef.current.srcObject = cameraStream;
        await cameraVideoRef.current.play();
      }

      cameraStream.getVideoTracks().forEach((track) => {
        track.onended = () => registerViolation('cameraStopped', 'Camera stream stopped');
      });
      screenStream.getVideoTracks().forEach((track) => {
        track.onended = () => registerViolation('screenStopped', 'Screen share stopped');
      });

      if ('FaceDetector' in window) {
        faceDetectorRef.current = new window.FaceDetector({ fastMode: true, maxDetectedFaces: 1 });
      } else {
        setProctoringError('FaceDetector API not available. Use Chrome/Edge for better face tracking.');
      }

      monitorIntervalRef.current = setInterval(async () => {
        const now = Date.now();
        if (document.hidden) {
          registerViolation('tabSwitch', 'Tab switched or page hidden');
          return;
        }
        if (!document.hasFocus()) {
          registerViolation('focusLoss', 'Window focus lost');
          return;
        }
        if (faceDetectorRef.current && cameraVideoRef.current) {
          try {
            const faces = await faceDetectorRef.current.detect(cameraVideoRef.current);
            if (!faces?.length) {
              setIsFaceDetected(false);
              setFaceBox(null);
              if (!noFaceSinceRef.current) {
                noFaceSinceRef.current = now;
              }
              if (now - noFaceSinceRef.current >= CONTINUOUS_VIOLATION_WINDOW_MS) {
                registerViolation('noFace', 'Face not visible continuously for 5 seconds');
                noFaceSinceRef.current = now;
              }
              faceSignalRef.current.lookAwayStreak = 0;
            } else {
              noFaceSinceRef.current = null;
              const face = faces[0];
              const box = face?.boundingBox;
              const videoEl = cameraVideoRef.current;
              const frameWidth = videoEl.videoWidth || 0;
              const frameHeight = videoEl.videoHeight || 0;
              const isBoxUsable = Boolean(box && frameWidth > 0 && frameHeight > 0 && box.width > 0 && box.height > 0);

              if (isBoxUsable) {
                const centerX = (box.x + box.width / 2) / frameWidth;
                const centerY = (box.y + box.height / 2) / frameHeight;
                const widthRatio = box.width / frameWidth;
                const heightRatio = box.height / frameHeight;
                setIsFaceDetected(true);
                setFaceBox({
                  left: `${(box.x / frameWidth) * 100}%`,
                  top: `${(box.y / frameHeight) * 100}%`,
                  width: `${(box.width / frameWidth) * 100}%`,
                  height: `${(box.height / frameHeight) * 100}%`,
                });
                const looksAway =
                  widthRatio < FACE_WIDTH_MIN_RATIO ||
                  heightRatio < FACE_HEIGHT_MIN_RATIO ||
                  centerX < FACE_CENTER_X_MIN ||
                  centerX > FACE_CENTER_X_MAX ||
                  centerY < FACE_CENTER_Y_MIN ||
                  centerY > FACE_CENTER_Y_MAX;

                if (looksAway) {
                  faceSignalRef.current.lookAwayStreak += 1;
                  if (faceSignalRef.current.lookAwayStreak >= LOOK_AWAY_STREAK_THRESHOLD) {
                    registerViolation('lookAway', 'Head/eyes moved away from screen for repeated checks');
                    faceSignalRef.current.lookAwayStreak = 0;
                  }
                } else {
                  faceSignalRef.current.lookAwayStreak = 0;
                }
              } else {
                // If bounding box is unavailable, avoid noisy penalties from incomplete detector frames.
                setIsFaceDetected(true);
                setFaceBox(null);
                faceSignalRef.current.lookAwayStreak = 0;
              }
            }
          } catch {
            // Ignore occasional frame-read failures.
          }
        }
        const phoneDetected = await detectPhoneFromCurrentFrame();
        if (phoneDetected) {
          if (!phoneDetectedSinceRef.current) {
            phoneDetectedSinceRef.current = now;
          }
          if (now - phoneDetectedSinceRef.current >= CONTINUOUS_VIOLATION_WINDOW_MS) {
            registerViolation('phoneDetected', 'Phone detected continuously for 5 seconds');
            phoneDetectedSinceRef.current = now;
          }
        } else {
          phoneDetectedSinceRef.current = null;
        }
      }, PROCTORING_CHECK_INTERVAL_MS);

      setProctoringReady(true);
    } catch {
      setProctoringError('Camera and screen share are required for Computer Vision mode.');
      setProctoringReady(false);
    }
  }, [detectPhoneFromCurrentFrame, isComputerVisionMode, registerViolation]);

  useEffect(() => {
    if (!isComputerVisionMode) {
      stopProctoring();
      return;
    }
    void startProctoring();
    return () => stopProctoring();
  }, [isComputerVisionMode, startProctoring, stopProctoring]);

  if (!state.sessionId) return <Navigate to="/setup/cv" replace />;

  function toggleMic() {
    if (!recognitionRef.current) return;
    if (isListening) recognitionRef.current.stop();
    else recognitionRef.current.start();
  }

  async function handleSubmit(event) {
    event.preventDefault();
    const message = draft.trim();
    if (!message || interviewFailed) return;
    if (isComputerVisionMode && !proctoringReady) {
      setError('Start camera and screen share before sending answers.');
      return;
    }
    setError(''); setIsThinking(true); setInterimTranscript(''); stopPlayback();
    try {
      const payload = await submitCandidateMessage(message);
      setDraft('');
      if (['voice', 'computer_vision'].includes(state.interviewMode)) {
        await speakReply(payload.answer, payload.phase);
      }
    } catch (e) { 
      setError(e.message); 
    } finally { 
      setIsThinking(false); 
    }
  }

  function handleResetMeritForTesting() {
    setMerit(STARTING_MERIT);
    setInterviewFailed(false);
    setError('');
    setViolations([]);
  }

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-10">
        <div className="container mx-auto px-4 py-3 flex items-center justify-between max-w-7xl">
          <Button variant="ghost" size="sm" onClick={() => navigate('/setup/mode')} className="gap-2">
            <ArrowLeft className="w-4 h-4" />
            Leave Room
          </Button>
          <div className="flex items-center gap-2">
            <Badge variant="outline">{state.roleName} • {state.phase}</Badge>
            <Badge>
              {state.interviewMode === 'voice'
                ? 'Voice'
                : state.interviewMode === 'computer_vision'
                  ? 'Computer Vision'
                  : 'Chat'}
            </Badge>
            {isComputerVisionMode && (
              <>
                <Badge variant={merit > 35 ? 'outline' : 'destructive'}>Merit {merit}/100</Badge>
                <Button size="sm" variant="outline" onClick={handleResetMeritForTesting}>
                  Reset Merit
                </Button>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1">
        <div className="container mx-auto px-4 py-6 max-w-7xl">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 lg:items-start">
            {/* Chat Section */}
            <div className="lg:col-span-2 flex flex-col border rounded-lg bg-card shadow-sm">
              {/* Voice Status Bar */}
              {state.interviewMode === 'voice' && (
                <div className="p-4 border-b bg-muted/30">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className={cn(
                        "w-2 h-2 rounded-full transition-colors",
                        orbMode === 'listening' && "bg-green-500 animate-pulse",
                        orbMode === 'speaking' && "bg-blue-500 animate-pulse",
                        orbMode === 'thinking' && "bg-yellow-500 animate-pulse",
                        orbMode === 'idle' && "bg-muted-foreground"
                      )} />
                      <span className="text-sm text-muted-foreground">
                        {isListening ? 'Listening...' : isSpeaking ? 'Agent speaking...' : isThinking ? 'Thinking...' : inputStatus}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      {isSpeaking && (
                        <Button variant="ghost" size="sm" onClick={stopPlayback}>
                          <VolumeX className="w-4 h-4" />
                        </Button>
                      )}
                      <Button
                        variant={isListening ? "default" : "outline"}
                        size="sm"
                        onClick={toggleMic}
                        disabled={!SpeechRecognition}
                        className="gap-2"
                      >
                        {isListening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                        {isListening ? 'Mute' : 'Mic'}
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              {isComputerVisionMode && (
                <div className="p-4 border-b bg-muted/30 space-y-3 sticky top-16 z-10">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <ShieldAlert className="w-4 h-4" />
                      <span className="text-sm font-medium">Computer Vision Proctoring</span>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => void startProctoring()}>
                      Recheck Permissions
                    </Button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="rounded-md border bg-background p-3 text-xs flex items-center gap-2">
                      <Camera className="w-4 h-4" />
                      Camera: {cameraStreamRef.current ? 'Connected' : 'Disconnected'}
                    </div>
                    <div className="rounded-md border bg-background p-3 text-xs flex items-center gap-2">
                      <Monitor className="w-4 h-4" />
                      Screen Share: {screenStreamRef.current ? 'Connected' : 'Disconnected'}
                    </div>
                  </div>
                  <div className="rounded-md border bg-background p-2">
                    <p className="text-xs text-muted-foreground mb-2">Camera Preview</p>
                    <div className="relative w-full max-w-sm">
                      <video
                        ref={cameraVideoRef}
                        className="w-full h-56 rounded object-cover bg-black/70"
                        muted
                        playsInline
                      />
                      {faceBox ? (
                        <div
                          className={cn(
                            'absolute border-2 rounded-sm pointer-events-none transition-colors',
                            isFaceDetected ? 'border-emerald-400' : 'border-destructive'
                          )}
                          style={faceBox}
                        />
                      ) : null}
                    </div>
                    <p className={cn('text-xs mt-2', isFaceDetected ? 'text-emerald-600' : 'text-destructive')}>
                      {isFaceDetected ? 'Face detected' : 'Face not detected'}
                    </p>
                  </div>
                  <div className="rounded-md border bg-background p-3 text-xs space-y-1">
                    <p>
                      Push-to-talk: hold <span className="font-semibold">Space</span> to record, release to stop.
                    </p>
                    <p>
                      Then press <span className="font-semibold">Enter</span> (or send button) to submit.
                    </p>
                    <p className="text-muted-foreground">
                      Status: {isPushToTalkHeld ? 'Recording while key is held' : isListening ? 'Listening' : 'Idle'}
                    </p>
                  </div>
                  <canvas ref={captureCanvasRef} className="hidden" />
                  {proctoringError && <p className="text-xs text-destructive">{proctoringError}</p>}
                  {interviewFailed && (
                    <p className="text-xs text-destructive">
                      Interview ended because merit reached 0.
                    </p>
                  )}
                </div>
              )}

              {/* Messages */}
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {messages.length === 0 ? (
                  <div className="h-full flex items-center justify-center">
                    <p className="text-muted-foreground text-sm">Interview started. Awaiting your first move.</p>
                  </div>
                ) : (
                  <>
                    {messages.map((m) => (
                      <div
                        key={m.id}
                        className={cn(
                          "flex",
                          m.role === 'assistant' ? 'justify-start' : 'justify-end'
                        )}
                      >
                        <div className={cn(
                          "max-w-[80%] rounded-lg px-4 py-2 space-y-1",
                          m.role === 'assistant' 
                            ? 'bg-muted' 
                            : 'bg-foreground text-background'
                        )}>
                          <p className="text-xs opacity-70">
                            {m.role === 'assistant' ? 'Agent' : 'You'}
                          </p>
                          <p className="text-sm">{m.content}</p>
                        </div>
                      </div>
                    ))}
                    <div ref={messagesEndRef} />
                  </>
                )}
              </div>

              {/* Input Form */}
              <div className="p-4 border-t bg-muted/30">
                <form onSubmit={handleSubmit} className="space-y-3">
                  {interimTranscript && (
                    <p className="text-xs text-muted-foreground italic">{interimTranscript}</p>
                  )}
                  <div className="flex gap-2">
                    <Textarea
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      placeholder="Type your answer or use microphone..."
                      className="resize-none min-h-[60px]"
                      rows={2}
                    />
                    <Button 
                      type="submit" 
                      disabled={isThinking || !draft.trim() || interviewFailed || (isComputerVisionMode && !proctoringReady)}
                      size="icon"
                      className="shrink-0"
                    >
                      <Send className="w-4 h-4" />
                    </Button>
                  </div>
                  {error && (
                    <p className="text-xs text-destructive">{error}</p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    Shift + Enter for new line
                  </p>
                </form>
              </div>
            </div>

            {/* Context Sidebar */}
            <div className="border rounded-lg bg-card shadow-sm p-4 overflow-y-auto max-h-[calc(100vh-110px)] lg:sticky lg:top-20">
              <div className="space-y-4">
                {isComputerVisionMode && (
                  <div className="space-y-2 p-3 rounded-md border bg-muted/20">
                    <h3 className="text-sm font-semibold">Merit Monitor</h3>
                    <p className="text-xs text-muted-foreground">
                      Merit starts at 100 and drops for tab switching, focus loss, no-face, and YOLO phone detection events.
                    </p>
                    {violations.length === 0 ? (
                      <p className="text-xs text-muted-foreground">No violations detected yet.</p>
                    ) : (
                      <div className="space-y-1">
                        {violations.map((item) => (
                          <p key={item.id} className="text-xs">
                            -{item.penalty} {item.reason}
                          </p>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                <div>
                  <h3 className="text-sm font-semibold mb-1">RAG Context Engine</h3>
                  <p className="text-xs text-muted-foreground">Retrieved from your CV</p>
                </div>
                
                {retrievedContext.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Awaiting context from CV...</p>
                ) : (
                  <div className="space-y-3">
                    {retrievedContext.map((item, idx) => (
                      <Card key={idx}>
                        <CardContent className="p-3 space-y-2">
                          <div className="flex items-center gap-2">
                            <FileText className="w-3 h-3 text-muted-foreground" />
                            <span className="text-xs font-medium text-muted-foreground">
                              {item.source_filename}
                            </span>
                          </div>
                          <p className="text-xs leading-relaxed">{item.chunk_text}</p>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
