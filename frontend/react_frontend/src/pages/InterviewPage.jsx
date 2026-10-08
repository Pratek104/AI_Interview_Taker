import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import {
  Activity,
  ArrowLeft,
  Camera,
  CheckCircle2,
  Clock,
  Eye,
  EyeOff,
  FileText,
  Mic,
  MicOff,
  Monitor,
  RotateCcw,
  Send,
  ShieldAlert,
  Smartphone,
  VolumeX,
} from 'lucide-react';
import { useInterview } from '../context/interview-context';
import { detectPhoneInFrame, generateSpeech } from '../lib/api';
import JEELIZFACEFILTER from 'facefilter/dist/jeelizFaceFilter.moduleES6.js';
import NN_DEFAULT from 'facefilter/neuralNets/NN_DEFAULT.json';
import { Button } from '../components/ui/button';
import { Textarea } from '../components/ui/textarea';
import { Badge } from '../components/ui/badge';
import { Card, CardContent } from '../components/ui/card';
import { cn } from '../lib/utils';

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const STARTING_MERIT = 100;
const PENALTY = {
  tabSwitch: 15,
  noFace: 10,
  lookAway: 8,
  phoneDetected: 25,
  cameraStopped: 30,
  screenStopped: 30,
};
const VIOLATION_COOLDOWN_MS = 12000;
const PROCTORING_CHECK_INTERVAL_MS = 2000;
const PROCTORING_STARTUP_GRACE_MS = 10000;
const TAB_SWITCH_VIOLATION_WINDOW_MS = 7000;
const FACE_MISSING_VIOLATION_WINDOW_MS = 1500;
const LOOK_AWAY_VIOLATION_WINDOW_MS = 1500;
const LOOK_DOWN_VIOLATION_WINDOW_MS = 1500;
const SUSPICIOUS_MOTION_VIOLATION_WINDOW_MS = 1300;
const PHONE_CONFIRM_STREAK = 2;
const PHONE_VIOLATION_STREAK = 3;
const FACE_TRACKER_STALL_MS = 5000;
const FACE_TRACKER_RECOVERY_COOLDOWN_MS = 10000;
const FACE_BOX_UPDATE_MS = 200;
const HEAD_YAW_MAX = 0.42;
const HEAD_PITCH_DOWN_MAX = 0.26;
const SUSPICIOUS_MOTION_DELTA_THRESHOLD = 0.55;
const SHOW_LEGACY_LAYOUT = false;

function hasLiveVideoTrack(stream) {
  if (!stream?.active) return false;
  return stream.getVideoTracks().some((track) => track.readyState === 'live');
}

export function InterviewPage() {
  const navigate = useNavigate();
  const { state, submitCandidateMessage } = useInterview();
  const [draft, setDraft] = useState('');
  const [interimTranscript, setInterimTranscript] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [isPreparingSpeech, setIsPreparingSpeech] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isPushToTalkHeld, setIsPushToTalkHeld] = useState(false);
  const [error, setError] = useState('');
  const [inputStatus, setInputStatus] = useState(SpeechRecognition ? 'Mic ready' : 'Mic unavailable (use Chrome/Edge)');
  const [hasStarted, setHasStarted] = useState(false);

  const hasStartedRef = useRef(false);
  const isSpeakingRef = useRef(false);
  const isThinkingRef = useRef(false);
  const isPreparingSpeechRef = useRef(false);
  const draftRef = useRef('');
  const submitTimeoutRef = useRef(null);
  const autoSubmitRef = useRef(null);
  const speechAbortControllerRef = useRef(null);
  const speechRunIdRef = useRef(0);

  useEffect(() => { hasStartedRef.current = hasStarted; }, [hasStarted]);
  useEffect(() => { isSpeakingRef.current = isSpeaking; }, [isSpeaking]);
  useEffect(() => { isThinkingRef.current = isThinking; }, [isThinking]);
  useEffect(() => { isPreparingSpeechRef.current = isPreparingSpeech; }, [isPreparingSpeech]);
  useEffect(() => { draftRef.current = draft; }, [draft]);

  const setThinkingState = useCallback((value) => {
    isThinkingRef.current = value;
    setIsThinking(value);
  }, []);

  const setSpeakingState = useCallback((value) => {
    isSpeakingRef.current = value;
    setIsSpeaking(value);
  }, []);

  const setPreparingSpeechState = useCallback((value) => {
    isPreparingSpeechRef.current = value;
    setIsPreparingSpeech(value);
  }, []);
  const [clock, setClock] = useState(() => new Date());
  const [merit, setMerit] = useState(STARTING_MERIT);
  const [violations, setViolations] = useState([]);
  const [proctoringReady, setProctoringReady] = useState(false);
  const [mediaStatus, setMediaStatus] = useState({ camera: false, screen: false });
  const [proctoringError, setProctoringError] = useState('');
  const [interviewFailed, setInterviewFailed] = useState(false);
  const [faceBox, setFaceBox] = useState(null);
  const [isFaceDetected, setIsFaceDetected] = useState(false);
  const [proctoringStatus, setProctoringStatus] = useState({ label: 'Preparing camera...', tone: 'neutral' });
  const [behaviorSignals, setBehaviorSignals] = useState({
    face: 'Initializing',
    yaw: '0.00',
    pitch: '0.00',
    roll: '0.00',
    lookAway: 'No',
    lookingDown: 'No',
    suspiciousMotion: 'No',
    phone: 'No',
  });

  const recognitionRef = useRef(null);
  const audioRef = useRef(null);
  const openingMessageKeyRef = useRef('');
  const messagesEndRef = useRef(null);
  const cameraStreamRef = useRef(null);
  const screenStreamRef = useRef(null);
  const cameraVideoRef = useRef(null);
  const monitorIntervalRef = useRef(null);
  const jeelizCanvasRef = useRef(null);
  const jeelizReadyRef = useRef(false);
  const jeelizStartingRef = useRef(false);
  const captureCanvasRef = useRef(null);
  const lastViolationRef = useRef({});
  const phoneCheckInFlightRef = useRef(false);
  const isSpacePressedRef = useRef(false);
  const faceSignalRef = useRef({
    looksAwaySince: null,
    looksDownSince: null,
    suspiciousMotionSince: null,
    lastPose: null,
    lastPoseAt: 0,
  });
  const noFaceSinceRef = useRef(null);
  const phoneDetectedSinceRef = useRef(null);
  const phoneStreakRef = useRef(0);
  const lastFaceCallbackAtRef = useRef(0);
  const lastFaceBoxAtRef = useRef(0);
  const lastFaceBoxRef = useRef(null);
  const isFaceDetectedRef = useRef(false);
  const lastJeelizRecoveryAtRef = useRef(0);
  const hiddenSinceRef = useRef(null);
  const proctoringStartInFlightRef = useRef(false);
  const proctoringSessionRef = useRef(0);
  const proctoringGraceUntilRef = useRef(0);
  const behaviorUpdateAtRef = useRef(0);

  const messages = state.messages;
  const retrievedContext = useDeferredValue(state.retrievedContext);
  const isComputerVisionMode = state.interviewMode === 'computer_vision';

  const orbMode = useMemo(() => {
    if (isSpeaking) return 'speaking';
    // Audio is still loading; question text is already on screen — not an LLM "thinking" phase.
    if (isPreparingSpeech) return 'speaking';
    if (isThinking) return 'thinking';
    if (isListening) return 'listening';
    return 'idle';
  }, [isListening, isPreparingSpeech, isSpeaking, isThinking]);

  const modeLabel = useMemo(() => {
    if (state.interviewMode === 'computer_vision') return 'Computer Vision';
    if (state.interviewMode === 'voice') return 'Voice';
    return 'Text';
  }, [state.interviewMode]);

  const phaseLabel = useMemo(() => (
    state.phase ? state.phase.replace(/_/g, ' ') : 'interview'
  ), [state.phase]);

  const currentPrompt = useMemo(() => {
    const assistantMessages = messages.filter((message) => message.role === 'assistant');
    return assistantMessages.at(-1)?.content || state.openingMessage || 'Preparing your next interview question.';
  }, [messages, state.openingMessage]);

  const trackTabs = useMemo(() => {
    const activeRole = state.jobPosition || state.roleName || 'Data Analysis';
    return [
      { label: activeRole, active: true },
      { label: 'Programming focus', active: false },
      { label: 'Domain expertise', active: false },
    ];
  }, [state.jobPosition, state.roleName]);

  const clockLabel = useMemo(() => (
    clock.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
  ), [clock]);

  const signalRows = useMemo(() => [
    {
      label: 'Face',
      value: behaviorSignals.face,
      tone: behaviorSignals.face === 'Detected' ? 'success' : 'danger',
      icon: behaviorSignals.face === 'Detected' ? CheckCircle2 : ShieldAlert,
    },
    {
      label: 'Look away',
      value: behaviorSignals.lookAway,
      tone: behaviorSignals.lookAway === 'Yes' ? 'warning' : 'success',
      icon: behaviorSignals.lookAway === 'Yes' ? EyeOff : Eye,
    },
    {
      label: 'Looking down',
      value: behaviorSignals.lookingDown,
      tone: behaviorSignals.lookingDown === 'Yes' ? 'warning' : 'success',
      icon: Activity,
    },
    {
      label: 'Phone',
      value: behaviorSignals.phone,
      tone: behaviorSignals.phone === 'Yes' ? 'danger' : 'success',
      icon: Smartphone,
    },
  ], [behaviorSignals]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setClock(new Date());
    }, 30000);
    return () => window.clearInterval(intervalId);
  }, []);

  const setLiveProctoringStatus = useCallback((label, tone) => {
    setProctoringStatus((current) => {
      if (current.label === label && current.tone === tone) {
        return current;
      }
      return { label, tone };
    });
  }, []);

  const updateBehaviorSignals = useCallback((next) => {
    const now = Date.now();
    if (now - behaviorUpdateAtRef.current < 120) return;
    behaviorUpdateAtRef.current = now;
    setBehaviorSignals((current) => ({ ...current, ...next }));
  }, []);

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

  // Immediate tab switch & window blur detection
  useEffect(() => {
    if (!hasStarted || interviewFailed) return;

    const handleVisibilityChange = () => {
      if (document.hidden || document.visibilityState === 'hidden') {
        registerViolation('tabSwitch', 'Interview tab hidden / tab switched');
        setLiveProctoringStatus('Interview tab hidden', 'danger');
        updateBehaviorSignals({
          face: 'Hidden tab',
          lookAway: 'No',
          lookingDown: 'No',
          suspiciousMotion: 'No',
        });
      }
    };

    const handleBlur = () => {
      if (document.hidden || document.visibilityState === 'hidden' || !document.hasFocus()) {
        registerViolation('tabSwitch', 'Interview window lost focus');
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('blur', handleBlur);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('blur', handleBlur);
    };
  }, [hasStarted, interviewFailed, registerViolation, setLiveProctoringStatus, updateBehaviorSignals]);

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
        const t = event.results[i][0].transcript;
        if (!t.trim()) continue;
        if (event.results[i].isFinal) finalText += t + ' ';
        else interim += t + ' ';
      }
      setInterimTranscript(interim.trim());
      if (finalText.trim()) {
        setDraft((current) => (current + ' ' + finalText.trim()).trim());
      }
      
      if (submitTimeoutRef.current) clearTimeout(submitTimeoutRef.current);
      submitTimeoutRef.current = setTimeout(() => {
        if (draftRef.current.trim()) {
          autoSubmitRef.current?.();
        }
      }, 4000);
    };
    recognition.onerror = (e) => { setIsListening(false); setInputStatus(`Mic error: ${e.error}`); };
    recognition.onend = () => { 
      setIsListening(false); 
      setInputStatus('Mic ready'); 
      if (hasStartedRef.current && !isSpeakingRef.current && !isThinkingRef.current && !isPreparingSpeechRef.current) {
        try { recognitionRef.current?.start(); } catch(e) {}
      }
    };
    recognitionRef.current = recognition;
    return () => { recognition.stop(); recognitionRef.current = null; };
  }, []);

  const restartRecognitionIfReady = useCallback(() => {
    if (
      hasStartedRef.current &&
      recognitionRef.current &&
      !isSpeakingRef.current &&
      !isThinkingRef.current &&
      !isPreparingSpeechRef.current
    ) {
      try { recognitionRef.current.start(); } catch(e) {}
    }
  }, []);

  const stopPlayback = useCallback(() => {
    speechRunIdRef.current += 1;
    speechAbortControllerRef.current?.abort();
    speechAbortControllerRef.current = null;

    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current = null;
    }

    setPreparingSpeechState(false);
    setSpeakingState(false);
  }, [setPreparingSpeechState, setSpeakingState]);

  const speakReply = useCallback((text, phase) => {
    const trimmedText = text?.trim();
    if (!trimmedText) return;

    stopPlayback();
    const runId = ++speechRunIdRef.current;
    setError('');
    setPreparingSpeechState(true);

    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch(e) {}
    }

    const finishSpeech = () => {
      if (speechRunIdRef.current !== runId) return;
      speechAbortControllerRef.current = null;
      audioRef.current = null;
      setPreparingSpeechState(false);
      setSpeakingState(false);
      restartRecognitionIfReady();
    };

    const failSpeech = (message) => {
      if (speechRunIdRef.current !== runId) return;
      speechAbortControllerRef.current = null;
      audioRef.current = null;
      setPreparingSpeechState(false);
      setSpeakingState(false);
      if (message) setError(message);
      restartRecognitionIfReady();
    };

    const abortController = new AbortController();
    speechAbortControllerRef.current = abortController;

    (async () => {
      try {
        const speech = await generateSpeech({
          text: trimmedText,
          phase,
          voice: state.defaultVoice,
          signal: abortController.signal,
        });
        if (abortController.signal.aborted || speechRunIdRef.current !== runId) return;

        const audio = new Audio(`data:${speech.mime_type};base64,${speech.audio_base64}`);
        audioRef.current = audio;
        audio.onplay = () => {
          if (speechRunIdRef.current !== runId) return;
          setPreparingSpeechState(false);
          setSpeakingState(true);
        };
        audio.onended = finishSpeech;
        audio.onerror = () => failSpeech('Voice playback failed.');
        await audio.play();
      } catch (e) {
        if (abortController.signal.aborted || speechRunIdRef.current !== runId) return;
        failSpeech(e.message);
      }
    })();
  }, [
    restartRecognitionIfReady,
    setPreparingSpeechState,
    setSpeakingState,
    state.defaultVoice,
    stopPlayback,
  ]);

  useEffect(() => {
    if (!hasStarted) return;
    if (!['voice', 'computer_vision'].includes(state.interviewMode) || !state.sessionId || !state.openingMessage) return;
    const currentKey = state.sessionId + ':' + state.openingMessage;
    if (openingMessageKeyRef.current === currentKey) return;
    openingMessageKeyRef.current = currentKey;
    void speakReply(state.openingMessage, state.phase);
  }, [speakReply, state.interviewMode, state.openingMessage, state.phase, state.sessionId, hasStarted]);

  useEffect(() => { return () => { stopPlayback(); recognitionRef.current?.stop(); }; }, [stopPlayback]);



  const resetProctoringSignals = useCallback(() => {
    lastViolationRef.current = {};
    phoneCheckInFlightRef.current = false;
    faceSignalRef.current = {
      looksAwaySince: null,
      looksDownSince: null,
      suspiciousMotionSince: null,
      lastPose: null,
      lastPoseAt: 0,
    };
    noFaceSinceRef.current = null;
    phoneDetectedSinceRef.current = null;
    phoneStreakRef.current = 0;
    lastFaceCallbackAtRef.current = 0;
    lastFaceBoxAtRef.current = 0;
    lastFaceBoxRef.current = null;
    isFaceDetectedRef.current = false;
    lastJeelizRecoveryAtRef.current = 0;
    hiddenSinceRef.current = null;
    proctoringGraceUntilRef.current = 0;
    behaviorUpdateAtRef.current = 0;
    setBehaviorSignals({
      face: 'Initializing',
      yaw: '0.00',
      pitch: '0.00',
      roll: '0.00',
      lookAway: 'No',
      lookingDown: 'No',
      suspiciousMotion: 'No',
      phone: 'No',
    });
  }, []);

  const stopJeelizTracking = useCallback(() => {
    try {
      if (jeelizReadyRef.current && typeof JEELIZFACEFILTER.destroy === 'function') {
        JEELIZFACEFILTER.destroy();
      }
    } catch {
      // Ignore teardown issues from underlying WebGL context.
    } finally {
      jeelizReadyRef.current = false;
      jeelizStartingRef.current = false;
    }
  }, []);

  const stopProctoring = useCallback(() => {
    proctoringSessionRef.current += 1;
    proctoringStartInFlightRef.current = false;
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
    stopJeelizTracking();
    resetProctoringSignals();
    setIsFaceDetected(false);
    setFaceBox(null);
    setProctoringReady(false);
    setMediaStatus({ camera: false, screen: false });
    setLiveProctoringStatus('Proctoring stopped', 'neutral');
  }, [resetProctoringSignals, setLiveProctoringStatus, stopJeelizTracking]);

  const startJeelizTracking = useCallback((sessionId) => {
    if (jeelizStartingRef.current || jeelizReadyRef.current) return;
    const videoElement = cameraVideoRef.current;
    const canvasElement = jeelizCanvasRef.current;
    if (!videoElement || !canvasElement) return;

    jeelizStartingRef.current = true;
    JEELIZFACEFILTER.init({
      canvas: canvasElement,
      NNC: NN_DEFAULT,
      maxFacesDetected: 1,
      videoSettings: { videoElement },
      callbackReady: (errCode) => {
        jeelizStartingRef.current = false;
        if (proctoringSessionRef.current !== sessionId) {
          stopJeelizTracking();
          return;
        }
        if (errCode) {
          setProctoringError(`Jeeliz tracker failed to initialize (error ${errCode}).`);
          setLiveProctoringStatus('Face tracker unavailable', 'warning');
          return;
        }
        jeelizReadyRef.current = true;
        lastFaceCallbackAtRef.current = Date.now();
      },
      callbackTrack: (detectState) => {
        if (proctoringSessionRef.current !== sessionId) return;
        const now = Date.now();
        lastFaceCallbackAtRef.current = now;
        const detectionConfidence = Number(detectState?.detected || 0);
        const hasFace = detectionConfidence >= 0.6;

        if (!hasFace) {
          if (isFaceDetectedRef.current) {
            isFaceDetectedRef.current = false;
            setIsFaceDetected(false);
          }
          if (lastFaceBoxRef.current !== null) {
            lastFaceBoxRef.current = null;
            setFaceBox(null);
          }
          updateBehaviorSignals({
            face: 'Missing',
            lookAway: 'No',
            lookingDown: 'No',
            suspiciousMotion: 'No',
          });
          if (!noFaceSinceRef.current) noFaceSinceRef.current = now;
          if (now - noFaceSinceRef.current >= FACE_MISSING_VIOLATION_WINDOW_MS) {
            registerViolation('noFace', 'Face not detected continuously for 1.5 seconds');
            noFaceSinceRef.current = now;
          }
          faceSignalRef.current.looksAwaySince = null;
          faceSignalRef.current.looksDownSince = null;
          faceSignalRef.current.suspiciousMotionSince = null;
          faceSignalRef.current.lastPose = null;
          setLiveProctoringStatus('No face detected', 'danger');
          return;
        }

        noFaceSinceRef.current = null;
        const yaw = Number(detectState?.ry || 0);
        const pitch = Number(detectState?.rx || 0);
        const roll = Number(detectState?.rz || 0);
        const x = Number(detectState?.x || 0);
        const y = Number(detectState?.y || 0);
        const s = Math.max(0.12, Number(detectState?.s || 0.22));

        const boxWidthPct = Math.min(88, Math.max(18, s * 95));
        const boxHeightPct = Math.min(88, Math.max(22, s * 130));
        const centerXPct = ((x + 1) / 2) * 100;
        const centerYPct = ((1 - y) / 2) * 100;
        const left = Math.min(100 - boxWidthPct, Math.max(0, centerXPct - boxWidthPct / 2));
        const top = Math.min(100 - boxHeightPct, Math.max(0, centerYPct - boxHeightPct / 2));

        if (!isFaceDetectedRef.current) {
          isFaceDetectedRef.current = true;
          setIsFaceDetected(true);
        }
        // Throttle overlay updates: Jeeliz fires every frame (~30fps) and
        // setState on every frame causes a re-render storm that freezes the
        // UI after a couple of minutes. Update at most ~5fps or on big moves.
        const prevBox = lastFaceBoxRef.current;
        const boxMoved = !prevBox
          || Math.abs(prevBox.left - left) > 2.5
          || Math.abs(prevBox.top - top) > 2.5
          || Math.abs(prevBox.width - boxWidthPct) > 3;
        if (boxMoved || now - lastFaceBoxAtRef.current >= FACE_BOX_UPDATE_MS) {
          lastFaceBoxAtRef.current = now;
          const nextBox = {
            left: `${left}%`,
            top: `${top}%`,
            width: `${boxWidthPct}%`,
            height: `${boxHeightPct}%`,
          };
          lastFaceBoxRef.current = { left, top, width: boxWidthPct, height: boxHeightPct };
          setFaceBox(nextBox);
        }

        const lookAwayNow = Math.abs(yaw) > HEAD_YAW_MAX;
        const lookDownNow = pitch > HEAD_PITCH_DOWN_MAX;

        const lastPose = faceSignalRef.current.lastPose;
        const lastPoseAt = faceSignalRef.current.lastPoseAt || now;
        const dtSeconds = Math.max((now - lastPoseAt) / 1000, 0.001);
        let suspiciousMotionNow = false;
        if (lastPose) {
          const delta =
            Math.abs(yaw - lastPose.yaw) +
            Math.abs(pitch - lastPose.pitch) +
            Math.abs(roll - lastPose.roll);
          suspiciousMotionNow = (delta / dtSeconds) > SUSPICIOUS_MOTION_DELTA_THRESHOLD;
        }
        faceSignalRef.current.lastPose = { yaw, pitch, roll };
        faceSignalRef.current.lastPoseAt = now;

        if (lookAwayNow) {
          if (!faceSignalRef.current.looksAwaySince) faceSignalRef.current.looksAwaySince = now;
          if (now - faceSignalRef.current.looksAwaySince >= LOOK_AWAY_VIOLATION_WINDOW_MS) {
            registerViolation('lookAway', 'Head turned away continuously for 1.5 seconds');
            faceSignalRef.current.looksAwaySince = now;
          }
        } else {
          faceSignalRef.current.looksAwaySince = null;
        }

        if (lookDownNow) {
          if (!faceSignalRef.current.looksDownSince) faceSignalRef.current.looksDownSince = now;
          if (now - faceSignalRef.current.looksDownSince >= LOOK_DOWN_VIOLATION_WINDOW_MS) {
            registerViolation('lookAway', 'Looking down continuously for 1.5 seconds');
            faceSignalRef.current.looksDownSince = now;
          }
        } else {
          faceSignalRef.current.looksDownSince = null;
        }

        if (suspiciousMotionNow) {
          if (!faceSignalRef.current.suspiciousMotionSince) faceSignalRef.current.suspiciousMotionSince = now;
          if (now - faceSignalRef.current.suspiciousMotionSince >= SUSPICIOUS_MOTION_VIOLATION_WINDOW_MS) {
            registerViolation('lookAway', 'Suspicious rapid head movement detected');
            faceSignalRef.current.suspiciousMotionSince = now;
          }
        } else {
          faceSignalRef.current.suspiciousMotionSince = null;
        }

        const tone = lookAwayNow || lookDownNow || suspiciousMotionNow ? 'warning' : 'success';
        const label = lookAwayNow
          ? 'Head turned away'
          : lookDownNow
            ? 'Looking down'
            : suspiciousMotionNow
              ? 'Suspicious movement'
              : 'Face aligned';
        setLiveProctoringStatus(label, tone);

        updateBehaviorSignals({
          face: 'Detected',
          yaw: yaw.toFixed(2),
          pitch: pitch.toFixed(2),
          roll: roll.toFixed(2),
          lookAway: lookAwayNow ? 'Yes' : 'No',
          lookingDown: lookDownNow ? 'Yes' : 'No',
          suspiciousMotion: suspiciousMotionNow ? 'Yes' : 'No',
        });
      },
    });
  }, [registerViolation, setLiveProctoringStatus, stopJeelizTracking, updateBehaviorSignals]);

  const detectPhoneFromCurrentFrame = useCallback(async () => {
    const video = cameraVideoRef.current;
    const canvas = captureCanvasRef.current;
    if (!video || !canvas || video.videoWidth === 0 || video.videoHeight === 0) return false;
    if (phoneCheckInFlightRef.current) return false;
    // Skip frames while tab hidden or video stalled — stale frames are a
    // classic source of false "phone" hits.
    if (document.hidden || video.readyState < 2 || video.paused || video.ended) return false;

    phoneCheckInFlightRef.current = true;
    try {
      // Downscale to max 640px wide: matches model imgsz, cuts bandwidth,
      // and removes tiny high-frequency false positives.
      const scale = Math.min(1, 640 / video.videoWidth);
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);
      const ctx = canvas.getContext('2d');
      if (!ctx) return false;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.8));
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

  const startMonitorLoop = useCallback((sessionId) => {
    if (monitorIntervalRef.current) {
      clearInterval(monitorIntervalRef.current);
      monitorIntervalRef.current = null;
    }

    proctoringGraceUntilRef.current = Date.now() + PROCTORING_STARTUP_GRACE_MS;
    lastFaceCallbackAtRef.current = Date.now();
    monitorIntervalRef.current = setInterval(async () => {
      if (proctoringSessionRef.current !== sessionId) return;

      const now = Date.now();
      if (now < proctoringGraceUntilRef.current) {
        setLiveProctoringStatus('Calibrating camera...', 'neutral');
        return;
      }

      if (document.hidden) {
        registerViolation('tabSwitch', 'Interview tab hidden');
        setLiveProctoringStatus('Interview tab hidden', 'danger');
        noFaceSinceRef.current = null;
        phoneDetectedSinceRef.current = null;
        phoneStreakRef.current = 0;
        faceSignalRef.current.looksAwaySince = null;
        faceSignalRef.current.looksDownSince = null;
        faceSignalRef.current.suspiciousMotionSince = null;
        updateBehaviorSignals({
          face: 'Hidden tab',
          lookAway: 'No',
          lookingDown: 'No',
          suspiciousMotion: 'No',
        });
        return;
      }
      hiddenSinceRef.current = null;

      // --- Face-tracker stall watchdog ---
      // Jeeliz sometimes stops emitting callbackTrack (WebGL hiccup / tab
      // throttle) while the last face box stays frozen on screen. Detect the
      // stall here, clear the stale overlay, and restart tracking.
      const msSinceFaceCallback = now - (lastFaceCallbackAtRef.current || now);
      if (
        jeelizReadyRef.current
        && msSinceFaceCallback > FACE_TRACKER_STALL_MS
        && hasLiveVideoTrack(cameraStreamRef.current)
      ) {
        if (lastFaceBoxRef.current !== null) {
          lastFaceBoxRef.current = null;
          setFaceBox(null);
        }
        if (isFaceDetectedRef.current) {
          isFaceDetectedRef.current = false;
          setIsFaceDetected(false);
        }
        // Keep the video element alive — a paused element also freezes Jeeliz.
        try {
          const video = cameraVideoRef.current;
          if (video && video.paused && video.srcObject) {
            await video.play().catch(() => {});
          }
        } catch { /* ignore autoplay nudges */ }
        if (now - lastJeelizRecoveryAtRef.current >= FACE_TRACKER_RECOVERY_COOLDOWN_MS) {
          lastJeelizRecoveryAtRef.current = now;
          setLiveProctoringStatus('Face tracker stalled — recovering...', 'warning');
          updateBehaviorSignals({ face: 'Recovering' });
          try {
            stopJeelizTracking();
            // Small delay so the old WebGL context fully releases.
            await new Promise((resolve) => setTimeout(resolve, 400));
            if (proctoringSessionRef.current !== sessionId) return;
            lastFaceCallbackAtRef.current = Date.now();
            startJeelizTracking(sessionId);
          } catch { /* recovery retried on next stall window */ }
        }
        // Skip phone inference on this tick while recovering.
        return;
      }

      // --- Phone detection with streak confirmation ---
      // A single YOLO hit is NOT a violation: require consecutive positives
      // across polls so one stray false positive can't nuke merit.
      const phoneDetected = await detectPhoneFromCurrentFrame();
      if (phoneDetected) {
        phoneStreakRef.current += 1;
        if (!phoneDetectedSinceRef.current) {
          phoneDetectedSinceRef.current = now;
        }
        if (phoneStreakRef.current >= PHONE_CONFIRM_STREAK) {
          updateBehaviorSignals({ phone: 'Yes' });
          setLiveProctoringStatus('Phone detected', 'danger');
        }
        if (phoneStreakRef.current >= PHONE_VIOLATION_STREAK) {
          registerViolation('phoneDetected', `Phone detected in ${phoneStreakRef.current} consecutive checks`);
          phoneDetectedSinceRef.current = now;
          // Keep streak (don't reset to 0) so a genuinely held phone keeps
          // re-flagging through the 12s violation cooldown; a transient
          // false hit decays on the next clean frame below.
          phoneStreakRef.current = PHONE_VIOLATION_STREAK;
        }
      } else {
        phoneDetectedSinceRef.current = null;
        // Decay instead of hard reset: one clean frame after a long streak
        // doesn't instantly erase it, but two clean frames do.
        phoneStreakRef.current = Math.max(0, phoneStreakRef.current - 2);
        if (phoneStreakRef.current === 0) {
          updateBehaviorSignals({ phone: 'No' });
        }
      }
    }, PROCTORING_CHECK_INTERVAL_MS);
  }, [detectPhoneFromCurrentFrame, registerViolation, setLiveProctoringStatus, startJeelizTracking, stopJeelizTracking, updateBehaviorSignals]);

  const startProctoring = useCallback(async ({ forceRestart = false } = {}) => {
    if (!isComputerVisionMode) return;
    if (proctoringStartInFlightRef.current) return;
    if (!forceRestart && hasLiveVideoTrack(cameraStreamRef.current) && hasLiveVideoTrack(screenStreamRef.current) && monitorIntervalRef.current) return;

    if (forceRestart) {
      stopProctoring();
    }

    setProctoringError('');
    setLiveProctoringStatus('Requesting camera and screen share...', 'neutral');
    resetProctoringSignals();
    proctoringStartInFlightRef.current = true;
    const sessionId = proctoringSessionRef.current + 1;
    proctoringSessionRef.current = sessionId;

    try {
      const shouldReuseCameraStream = hasLiveVideoTrack(cameraStreamRef.current);
      const shouldReuseScreenStream = hasLiveVideoTrack(screenStreamRef.current);
      const [cameraStream, screenStream] = await Promise.all([
        shouldReuseCameraStream
          ? Promise.resolve(cameraStreamRef.current)
          : navigator.mediaDevices.getUserMedia({ video: true }),
        shouldReuseScreenStream
          ? Promise.resolve(screenStreamRef.current)
          : navigator.mediaDevices.getDisplayMedia({ video: true, audio: false }),
      ]);

      if (proctoringSessionRef.current !== sessionId) {
        if (!shouldReuseCameraStream) {
          cameraStream.getTracks().forEach((track) => track.stop());
        }
        if (!shouldReuseScreenStream) {
          screenStream.getTracks().forEach((track) => track.stop());
        }
        return;
      }

      cameraStreamRef.current = cameraStream;
      screenStreamRef.current = screenStream;
      setMediaStatus({
        camera: hasLiveVideoTrack(cameraStream),
        screen: hasLiveVideoTrack(screenStream),
      });

      if (cameraVideoRef.current) {
        if (cameraVideoRef.current.srcObject !== cameraStream) {
          cameraVideoRef.current.srcObject = cameraStream;
        }
        await cameraVideoRef.current.play();
      }

      cameraStream.getVideoTracks().forEach((track) => {
        track.onended = () => {
          if (proctoringSessionRef.current !== sessionId) return;
          cameraStreamRef.current = null;
          if (cameraVideoRef.current) {
            cameraVideoRef.current.srcObject = null;
          }
          setIsFaceDetected(false);
          setFaceBox(null);
          setProctoringReady(false);
          setMediaStatus((current) => ({ ...current, camera: false }));
          setProctoringError('Camera access stopped. Recheck permissions to resume proctoring.');
          setLiveProctoringStatus('Camera disconnected', 'danger');
          registerViolation('cameraStopped', 'Camera stream stopped');
        };
      });
      screenStream.getVideoTracks().forEach((track) => {
        track.onended = () => {
          if (proctoringSessionRef.current !== sessionId) return;
          screenStreamRef.current = null;
          setProctoringReady(false);
          setMediaStatus((current) => ({ ...current, screen: false }));
          setProctoringError('Screen share stopped. Recheck permissions to resume proctoring.');
          setLiveProctoringStatus('Screen share disconnected', 'danger');
          registerViolation('screenStopped', 'Screen share stopped');
        };
      });

      startJeelizTracking(sessionId);
      startMonitorLoop(sessionId);
      setProctoringReady(true);
    } catch {
      if (proctoringSessionRef.current === sessionId) {
        setProctoringError('Camera and screen share are required for Computer Vision mode.');
        setProctoringReady(false);
        setMediaStatus({ camera: false, screen: false });
        setLiveProctoringStatus('Camera and screen share required', 'danger');
      }
    } finally {
      if (proctoringSessionRef.current === sessionId) {
        proctoringStartInFlightRef.current = false;
      }
    }
  }, [isComputerVisionMode, registerViolation, resetProctoringSignals, setLiveProctoringStatus, startJeelizTracking, startMonitorLoop, stopProctoring]);

  useEffect(() => {
    return () => {
      stopProctoring();
    };
  }, [stopProctoring]);

  async function handleStartInterview() {
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
      if (isComputerVisionMode) {
        await startProctoring({ forceRestart: true });
      }
      setHasStarted(true);
      if (recognitionRef.current) {
        try { recognitionRef.current.start(); } catch(e) {}
      }
    } catch (e) {
      setError('Permissions denied. Please allow mic, camera, and screen share to start.');
    }
  }

  function toggleMic() {
    if (!recognitionRef.current) return;
    if (isListening) recognitionRef.current.stop();
    else recognitionRef.current.start();
  }

  useEffect(() => {
    autoSubmitRef.current = async () => {
      const finalMsg = draftRef.current.trim();
      if (!finalMsg || interviewFailed) return;
      if (isComputerVisionMode && !proctoringReady) {
        setError('Start camera and screen share before sending answers.');
        return;
      }
      setError(''); setThinkingState(true); setInterimTranscript(''); stopPlayback();
      if (recognitionRef.current) recognitionRef.current.stop();
      if (submitTimeoutRef.current) clearTimeout(submitTimeoutRef.current);
      try {
        const payload = await submitCandidateMessage(finalMsg);
        setDraft('');
        draftRef.current = '';
        setThinkingState(false);
        if (['voice', 'computer_vision'].includes(state.interviewMode)) {
          speakReply(payload.answer, payload.phase);
        }
      } catch (e) {
        setError(e.message);
        setThinkingState(false);
        if (hasStartedRef.current && recognitionRef.current) {
          try { recognitionRef.current.start(); } catch(err) {}
        }
      }
    };
  });

  async function handleSubmit(event) {
    if (event) event.preventDefault();
    await autoSubmitRef.current?.();
  }

  function handleDraftKeyDown(event) {
    if (event.key !== 'Enter' || event.shiftKey) return;
    event.preventDefault();
    handleSubmit();
  }

  if (!state.sessionId) return <Navigate to="/setup/cv" replace />;

  function handleResetMeritForTesting() {
    setMerit(STARTING_MERIT);
    setInterviewFailed(false);
    setError('');
    setViolations([]);
    setProctoringError('');
    lastViolationRef.current = {};
    resetProctoringSignals();
    setProctoringReady(false);
    if (monitorIntervalRef.current) {
      clearInterval(monitorIntervalRef.current);
      monitorIntervalRef.current = null;
    }
    const shouldForceRestart = !(hasLiveVideoTrack(cameraStreamRef.current) && hasLiveVideoTrack(screenStreamRef.current));
    void startProctoring({ forceRestart: shouldForceRestart });
  }

  return (
    <div className="min-h-screen overflow-hidden bg-[#eef3ff] text-slate-950">
      <header className="fixed inset-x-0 top-0 z-30 px-4 py-3 sm:px-6">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => navigate('/setup/mode')}
          className="absolute left-4 top-3 h-9 w-9 rounded-full border border-white/70 bg-white/60 text-slate-700 shadow-sm backdrop-blur hover:bg-white"
          aria-label="Leave interview room"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>

        <div className="mx-auto flex w-fit max-w-[68vw] items-start gap-3 overflow-hidden pt-1">
          {trackTabs.map((tab) => (
            <div key={tab.label} className="w-24 min-w-0 sm:w-36">
              <p
                className={cn(
                  'truncate text-center text-[11px] font-semibold capitalize leading-4',
                  tab.active ? 'text-slate-950' : 'text-slate-500'
                )}
              >
                {tab.label}
              </p>
              <div className="mt-1 h-1 rounded-full bg-white/65 shadow-inner">
                <div
                  className={cn(
                    'h-full rounded-full transition-all',
                    tab.active ? 'w-full bg-indigo-300' : 'w-1/4 bg-slate-300/70'
                  )}
                />
              </div>
            </div>
          ))}
        </div>

        <div className="absolute right-4 top-3 hidden items-center gap-2 rounded-md border border-white/70 bg-white/65 px-3 py-2 text-sm font-semibold text-slate-800 shadow-sm backdrop-blur sm:flex">
          <Clock className="h-4 w-4 text-indigo-600" />
          {clockLabel}
        </div>
      </header>

      <main className="relative min-h-screen px-4 pb-[36rem] pt-20 sm:px-6 lg:pb-[21rem]">
        <div className="mx-auto flex min-h-[calc(100vh-28rem)] max-w-6xl items-center justify-center lg:min-h-[calc(100vh-22rem)]">
          <div className="grid w-full grid-cols-1 items-center gap-8 lg:grid-cols-[1fr_220px_1fr] lg:gap-12">
            <div className="hidden lg:block" />

            <div className="flex justify-center">
              <button
                type="button"
                onClick={toggleMic}
                disabled={!SpeechRecognition || interviewFailed || !hasStarted}
                className={cn(
                  'relative flex h-36 w-36 items-center justify-center rounded-full border border-white/80 bg-white/65 text-slate-900 shadow-[0_20px_60px_rgba(63,81,181,0.22)] backdrop-blur transition-transform hover:scale-[1.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 disabled:cursor-not-allowed disabled:opacity-60',
                  orbMode === 'listening' && 'shadow-[0_0_80px_rgba(16,185,129,0.48)]',
                  orbMode === 'speaking' && 'shadow-[0_0_90px_rgba(79,70,229,0.5)]',
                  orbMode === 'thinking' && 'shadow-[0_0_80px_rgba(245,158,11,0.42)]'
                )}
                aria-label={isListening ? 'Stop microphone' : 'Start microphone'}
              >
                <span
                  className={cn(
                    'absolute h-44 w-44 rounded-full border-[18px] border-indigo-500/40 blur-[1px] transition-opacity',
                    orbMode === 'idle' ? 'opacity-55' : 'animate-pulse opacity-90'
                  )}
                />
                <span className="absolute h-28 w-28 rounded-full border border-indigo-100 bg-white/60" />
                <span className="relative flex h-20 w-20 items-center justify-center rounded-full border border-slate-200 bg-slate-50 text-xl font-bold shadow-inner">
                  ai.
                </span>
              </button>
            </div>

            <section className="mx-auto w-full max-w-lg space-y-5 lg:mx-0 flex flex-col items-center text-center">
              <div className="space-y-4">
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <Badge variant="outline" className="border-white/80 bg-white/50 capitalize text-slate-600">
                    {phaseLabel}
                  </Badge>
                  <Badge variant="outline" className="border-white/80 bg-white/50 text-slate-600">
                    {modeLabel}
                  </Badge>
                  {state.roleName && (
                    <Badge variant="outline" className="border-white/80 bg-white/50 text-slate-600">
                      {state.roleName}
                    </Badge>
                  )}
                </div>
                {hasStarted && (
                  <p className="text-lg font-semibold leading-8 text-slate-900 sm:text-xl">
                    {currentPrompt}
                  </p>
                )}
              </div>

              <div className="mt-8 flex min-h-[140px] w-full flex-col items-center justify-center rounded-xl border border-white/60 bg-white/40 p-6 shadow-sm backdrop-blur-md">
                {!hasStarted ? (
                  <div className="space-y-4 w-full">
                    <p className="text-sm text-slate-600">
                      This interview requires camera, microphone, and screen share permissions to proceed.
                    </p>
                    <Button 
                      onClick={handleStartInterview} 
                      size="lg" 
                      className="w-full h-14 rounded-full bg-indigo-600 hover:bg-indigo-700 text-base text-white"
                    >
                      Grant Permissions & Start Interview
                    </Button>
                    {error && <p className="text-xs text-red-600">{error}</p>}
                  </div>
                ) : isSpeaking || isPreparingSpeech ? (
                  <p className="text-slate-500 italic">Agent is speaking...</p>
                ) : isThinking ? (
                  <p className="text-amber-600 italic animate-pulse">Agent is thinking...</p>
                ) : (
                  <div className="w-full text-center">
                    <p className="text-lg text-slate-800 font-medium">
                      {draft} <span className="text-slate-500">{interimTranscript}</span>
                    </p>
                    {(!draft && !interimTranscript) && (
                      <p className="text-slate-400 italic">Listening for your answer...</p>
                    )}
                    {error && <p className="mt-4 text-xs text-red-600">{error}</p>}
                  </div>
                )}
              </div>
            </section>
          </div>
        </div>
      </main>

      <section className="fixed inset-x-3 bottom-3 z-20 flex flex-col gap-3 lg:inset-x-auto lg:left-4 lg:flex-row lg:items-end">
        <div className="w-full overflow-hidden rounded-md border border-white/70 bg-slate-950 shadow-[0_18px_50px_rgba(15,23,42,0.22)] lg:w-[390px]">
          <div className="relative aspect-video">
            <video
              ref={cameraVideoRef}
              className="h-full w-full object-cover"
              muted
              playsInline
            />
            <div className="absolute left-3 top-3 rounded-sm bg-black/55 px-2 py-1 text-[11px] font-semibold text-white backdrop-blur">
              Facecam
            </div>
            <div
              className={cn(
                'absolute right-3 top-3 rounded-sm px-2 py-1 text-[11px] font-semibold backdrop-blur',
                proctoringStatus.tone === 'success' && 'bg-emerald-500/80 text-white',
                proctoringStatus.tone === 'warning' && 'bg-amber-400/90 text-slate-950',
                proctoringStatus.tone === 'danger' && 'bg-red-500/85 text-white',
                proctoringStatus.tone === 'neutral' && 'bg-white/75 text-slate-700'
              )}
            >
              {proctoringStatus.label}
            </div>
            {!isComputerVisionMode && (
              <div className="absolute inset-0 flex items-center justify-center bg-slate-950/70 px-6 text-center text-sm font-medium text-white">
                Computer Vision mode required for proctoring.
              </div>
            )}
            {faceBox ? (
              <div
                className={cn(
                  'absolute rounded-sm pointer-events-none transition-colors shadow-[0_0_0_1px_rgba(255,255,255,0.25)]',
                  isFaceDetected ? 'border-4 border-emerald-400' : 'border-4 border-red-500'
                )}
                style={faceBox}
              >
                {isFaceDetected ? (
                  <span className="absolute -top-6 left-0 rounded-sm bg-emerald-500 px-2 py-0.5 text-[10px] font-semibold text-white">
                    Face locked
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>

        <aside className="w-full rounded-md border border-white/75 bg-white/80 p-3 shadow-[0_18px_50px_rgba(80,91,150,0.2)] backdrop-blur lg:w-[360px]">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <ShieldAlert className="h-4 w-4 text-indigo-600" />
                <p className="text-sm font-semibold text-slate-950">Cheating monitor</p>
              </div>
              <p className="mt-1 text-xs text-slate-500">
                {mediaStatus.camera ? 'Camera live' : 'Camera waiting'} / {mediaStatus.screen ? 'screen live' : 'screen waiting'}
              </p>
            </div>
            <Badge
              variant="outline"
              className={cn(
                'border-transparent',
                merit > 60 && 'bg-emerald-50 text-emerald-700',
                merit <= 60 && merit > 35 && 'bg-amber-50 text-amber-700',
                merit <= 35 && 'bg-red-50 text-red-700'
              )}
            >
              Merit {merit}
            </Badge>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2">
            <div className="rounded-sm border border-slate-200 bg-white/75 p-2">
              <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
                <Camera className="h-3.5 w-3.5" />
                Camera
              </div>
              <p className="mt-1 text-sm font-semibold text-slate-900">
                {mediaStatus.camera ? 'Connected' : 'Waiting'}
              </p>
            </div>
            <div className="rounded-sm border border-slate-200 bg-white/75 p-2">
              <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
                <Monitor className="h-3.5 w-3.5" />
                Screen
              </div>
              <p className="mt-1 text-sm font-semibold text-slate-900">
                {mediaStatus.screen ? 'Shared' : 'Waiting'}
              </p>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2">
            {signalRows.map(({ label, value, tone, icon: Icon }) => (
              <div key={label} className="rounded-sm border border-slate-200 bg-white/75 p-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-medium text-slate-500">{label}</span>
                  <Icon
                    className={cn(
                      'h-3.5 w-3.5',
                      tone === 'success' && 'text-emerald-600',
                      tone === 'warning' && 'text-amber-600',
                      tone === 'danger' && 'text-red-600'
                    )}
                  />
                </div>
                <p
                  className={cn(
                    'mt-1 text-sm font-semibold',
                    tone === 'success' && 'text-emerald-700',
                    tone === 'warning' && 'text-amber-700',
                    tone === 'danger' && 'text-red-700'
                  )}
                >
                  {value}
                </p>
              </div>
            ))}
          </div>

          <div className="mt-3 rounded-sm border border-slate-200 bg-white/75 p-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold text-slate-700">Recent flags</p>
              <p className="text-[11px] text-slate-500">Yaw {behaviorSignals.yaw} / Pitch {behaviorSignals.pitch}</p>
            </div>
            {violations.length === 0 ? (
              <p className="mt-1 text-xs text-slate-500">No violations detected.</p>
            ) : (
              <div className="mt-1 space-y-1">
                {violations.slice(0, 3).map((item) => (
                  <p key={item.id} className="text-xs text-red-700">
                    -{item.penalty} {item.reason}
                  </p>
                ))}
              </div>
            )}
          </div>

          <div className="mt-3 flex gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void startProctoring({ forceRestart: true })}
              disabled={!isComputerVisionMode}
              className="flex-1 gap-2 bg-white/80"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Recheck
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={handleResetMeritForTesting}
              disabled={!isComputerVisionMode}
              className="flex-1 gap-2 bg-white/80"
            >
              <Activity className="h-3.5 w-3.5" />
              Reset
            </Button>
          </div>
          {proctoringError && <p className="mt-2 text-xs text-red-600">{proctoringError}</p>}
          {interviewFailed && <p className="mt-2 text-xs text-red-600">Interview ended because merit reached 0.</p>}
        </aside>
      </section>

      <canvas ref={captureCanvasRef} className="hidden" />
      <canvas ref={jeelizCanvasRef} className="hidden" />

      {SHOW_LEGACY_LAYOUT && (
        <>
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
                        {isListening
                          ? 'Listening...'
                          : (isSpeaking || isPreparingSpeech)
                            ? 'Agent speaking...'
                            : isThinking
                              ? 'Thinking...'
                              : inputStatus}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      {(isSpeaking || isPreparingSpeech) && (
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
                    <Button size="sm" variant="outline" onClick={() => void startProctoring({ forceRestart: true })}>
                      Recheck Permissions
                    </Button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="rounded-md border bg-background p-3 text-xs flex items-center gap-2">
                      <Camera className="w-4 h-4" />
                      Camera: {mediaStatus.camera ? 'Connected' : 'Disconnected'}
                    </div>
                    <div className="rounded-md border bg-background p-3 text-xs flex items-center gap-2">
                      <Monitor className="w-4 h-4" />
                      Screen Share: {mediaStatus.screen ? 'Connected' : 'Disconnected'}
                    </div>
                  </div>
                  <div className="rounded-md border bg-background p-2">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <p className="text-xs text-muted-foreground">Camera Preview</p>
                      <Badge
                        variant="outline"
                        className={cn(
                          'border-transparent',
                          proctoringStatus.tone === 'success' && 'bg-emerald-500/15 text-emerald-700',
                          proctoringStatus.tone === 'warning' && 'bg-amber-500/15 text-amber-700',
                          proctoringStatus.tone === 'danger' && 'bg-destructive/15 text-destructive',
                          proctoringStatus.tone === 'neutral' && 'bg-muted text-muted-foreground'
                        )}
                      >
                        {proctoringStatus.label}
                      </Badge>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
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
                              'absolute rounded-sm pointer-events-none transition-colors shadow-[0_0_0_1px_rgba(255,255,255,0.15)]',
                              isFaceDetected ? 'border-4 border-emerald-400' : 'border-4 border-destructive'
                            )}
                            style={faceBox}
                          >
                            {isFaceDetected ? (
                              <span className="absolute -top-6 left-0 rounded bg-emerald-500 px-2 py-0.5 text-[10px] font-semibold text-white">
                                Face locked
                              </span>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                      <div className="rounded border bg-muted/20 p-2 text-[11px] space-y-1">
                        <p className="font-semibold text-xs mb-1">Behavior Signals</p>
                        <p>Face: <span className="font-semibold">{behaviorSignals.face}</span></p>
                        <p>Yaw (side): <span className="font-mono">{behaviorSignals.yaw}</span></p>
                        <p>Pitch (down/up): <span className="font-mono">{behaviorSignals.pitch}</span></p>
                        <p>Roll: <span className="font-mono">{behaviorSignals.roll}</span></p>
                        <p>Looking away: <span className={cn('font-semibold', behaviorSignals.lookAway === 'Yes' ? 'text-amber-700' : 'text-emerald-700')}>{behaviorSignals.lookAway}</span></p>
                        <p>Looking down: <span className={cn('font-semibold', behaviorSignals.lookingDown === 'Yes' ? 'text-amber-700' : 'text-emerald-700')}>{behaviorSignals.lookingDown}</span></p>
                        <p>Suspicious movement: <span className={cn('font-semibold', behaviorSignals.suspiciousMotion === 'Yes' ? 'text-amber-700' : 'text-emerald-700')}>{behaviorSignals.suspiciousMotion}</span></p>
                        <p>Phone: <span className={cn('font-semibold', behaviorSignals.phone === 'Yes' ? 'text-destructive' : 'text-emerald-700')}>{behaviorSignals.phone}</span></p>
                      </div>
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
                  <canvas ref={jeelizCanvasRef} className="hidden" />
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
                      Merit starts at 100 and drops for tab switching, no-face, looking away, and YOLO phone detection events.
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
        </>
      )}
    </div>
  );
}
