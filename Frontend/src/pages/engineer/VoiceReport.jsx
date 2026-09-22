import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  Mic,
  Square,
  Volume2,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Clock,
  Send,
  Languages,
  Wrench,
  Sparkles,
  Tag,
  Upload,
  FileAudio,
  RotateCcw,
  ArrowRight,
  Info,
  FileText,
} from "lucide-react";

import DashboardLayout from "../../layouts/DashboardLayout";
import "./VoiceReport.css";
import { API_BASE_URL, ML_BASE_URL } from "../../config/api";

function VoiceReport() {
  const [machine, setMachine] = useState("");
  const [machines, setMachines] = useState([]);
  const [language, setLanguage] = useState("ta-IN");

  // Input Mode: "mic" (Microphone Recording) vs "upload" (Audio File Upload)
  const [inputMode, setInputMode] = useState("mic");

  // Recording & Media State
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [recordedAudioDuration, setRecordedAudioDuration] = useState(null);
  const [audioUrl, setAudioUrl] = useState(null);
  const [recordedBlob, setRecordedBlob] = useState(null);
  const [uploadedFile, setUploadedFile] = useState(null);
  const [uploadedFileDuration, setUploadedFileDuration] = useState(null);
  const [previewError, setPreviewError] = useState(false);
  const [activeSourceType, setActiveSourceType] = useState("microphone"); // "microphone" | "uploaded_file"

  // Processing States
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isCleaning, setIsCleaning] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [processingStage, setProcessingStage] = useState(""); // e.g. "audio", "whisper", "gemini"

  // Transcribed, Translated & Cleaned Results
  const [nativeTranscript, setNativeTranscript] = useState("");
  const [rawEnglishTranslation, setRawEnglishTranslation] = useState("");
  const [cleanedReport, setCleanedReport] = useState("");
  const [detectedLanguage, setDetectedLanguage] = useState("");
  const [isCodeMixed, setIsCodeMixed] = useState(false);
  const [detectedMachineRef, setDetectedMachineRef] = useState("");
  const [extractedProblem, setExtractedProblem] = useState("");
  const [extractedSolution, setExtractedSolution] = useState("");
  const [extractedStatus, setExtractedStatus] = useState("");
  const [maintenanceTime, setMaintenanceTime] = useState("");

  // Diagnostic Mode: Restricted to development/testing only (?debug=true)
  const isDevDiagnosticEnabled = typeof window !== "undefined" && (
    new URLSearchParams(window.location.search).get("debug") === "true" ||
    localStorage.getItem("dev_diagnostic") === "true"
  );
  const [rawWhisperDebugMode, setRawWhisperDebugMode] = useState(false);
  const [diagnosticMetrics, setDiagnosticMetrics] = useState(null);

  // Unregistered Machine State (Read-only notice for Engineer, waiting for Head Officer approval)
  const [unregisteredMachine, setUnregisteredMachine] = useState(null);

  // Status message
  const [statusMessage, setStatusMessage] = useState({ type: "", text: "" });

  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const timerIntervalRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const fileInputRef = useRef(null);
  const recordingStartTimeRef = useRef(null);
  const recordingStopTimeRef = useRef(null);
  const recordingSecondsRef = useRef(0);
  const isProcessingPipelineRef = useRef(false);

  const navigate = useNavigate();

  // ==========================================
  // FETCH ALL MACHINES FROM FIRESTORE
  // ==========================================
  const fetchMachines = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/machines`);
      if (!response.ok) throw new Error("Failed to fetch machines");
      const data = await response.json();
      setMachines(data);
      return data;
    } catch (error) {
      console.error("Error loading machines:", error);
      setStatusMessage({
        type: "error",
        text: "Unable to load machine list. Please check backend server.",
      });
      return [];
    }
  };

  useEffect(() => {
    fetchMachines();

    return () => {
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      }
      if (audioUrl) {
        URL.revokeObjectURL(audioUrl);
      }
    };
  }, []);

  // ==========================================
  // REFRESH EQUIPMENT LIST
  // ==========================================
  const handleRefreshMachines = async () => {
    try {
      setIsRefreshing(true);
      setStatusMessage({
        type: "info",
        text: "Refreshing equipment list from factory system...",
      });

      const updated = await fetchMachines();

      if (unregisteredMachine) {
        const rawTarget = unregisteredMachine.toLowerCase().trim();
        const normTarget = rawTarget.replace(/[-_\s]/g, "");

        const matched = updated.find((item) => {
          const code = String(item.machine_code || "").toLowerCase().trim();
          const normCode = code.replace(/[-_\s]/g, "");
          const name = String(item.machine_name || "").toLowerCase().trim();
          const idStr = String(item.machine_id);

          return (
            code === rawTarget ||
            normCode === normTarget ||
            name === rawTarget ||
            idStr === rawTarget
          );
        });

        if (matched) {
          setMachine(String(matched.machine_id));
          setUnregisteredMachine(null);
          setStatusMessage({
            type: "success",
            text: `Machine '${matched.machine_code} - ${matched.machine_name}' has been approved by the Head Officer and is now registered!`,
          });
          return;
        } else {
          setStatusMessage({
            type: "warning",
            text: `Machine '${unregisteredMachine}' is still pending approval from the Head Officer.`,
          });
          return;
        }
      }

      setStatusMessage({
        type: "info",
        text: "Equipment list refreshed from system.",
      });
    } catch (err) {
      console.error("Error refreshing machines:", err);
    } finally {
      setIsRefreshing(false);
    }
  };

  // ==========================================
  // FORMAT TIMER (MM:SS)
  // ==========================================
  const formatTime = (totalSeconds) => {
    const mins = Math.floor(totalSeconds / 60)
      .toString()
      .padStart(2, "0");
    const secs = (totalSeconds % 60).toString().padStart(2, "0");
    return `${mins}:${secs}`;
  };

  // Format file size helper
  const formatFileSize = (bytes) => {
    if (!bytes || bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
  };

  // ==========================================
  // CONVERT RECORDED BLOB TO 16 KHZ MONO PCM WAV
  // ==========================================
  const convertBlobTo16kHzWav = async (sourceBlob) => {
    if (!sourceBlob || sourceBlob.size === 0) return null;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;

    let audioCtx = null;
    try {
      audioCtx = new AudioContextClass();
      const arrayBuffer = await sourceBlob.arrayBuffer();
      const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);

      const targetSampleRate = 16000;
      const numChannels = 1;
      const duration = audioBuffer.duration;
      const totalSamples = Math.max(1, Math.round(duration * targetSampleRate));

      const OfflineContextClass = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      if (!OfflineContextClass) return null;

      const offlineCtx = new OfflineContextClass(numChannels, totalSamples, targetSampleRate);
      const source = offlineCtx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(offlineCtx.destination);
      source.start(0);

      const renderedBuffer = await offlineCtx.startRendering();
      const channelData = renderedBuffer.getChannelData(0);
      const numSamples = channelData.length;

      // Encode standard 16-bit PCM WAV container
      const wavBuffer = new ArrayBuffer(44 + numSamples * 2);
      const view = new DataView(wavBuffer);

      view.setUint32(0, 0x52494646, false); // "RIFF"
      view.setUint32(4, 36 + numSamples * 2, true);
      view.setUint32(8, 0x57415645, false); // "WAVE"
      view.setUint32(12, 0x666d7420, false); // "fmt "
      view.setUint32(16, 16, true); // 16 for PCM
      view.setUint16(20, 1, true); // PCM format
      view.setUint16(22, 1, true); // 1 channel (mono)
      view.setUint32(24, targetSampleRate, true); // 16000 Hz
      view.setUint32(28, targetSampleRate * 2, true); // ByteRate: 32000
      view.setUint16(32, 2, true); // BlockAlign: 2 bytes
      view.setUint16(34, 16, true); // 16 bits per sample
      view.setUint32(36, 0x64617461, false); // "data"
      view.setUint32(40, numSamples * 2, true);

      let offset = 44;
      for (let i = 0; i < numSamples; i++) {
        const s = Math.max(-1, Math.min(1, channelData[i]));
        view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
        offset += 2;
      }

      const wavBlob = new Blob([view], { type: "audio/wav" });
      return { wavBlob, duration };
    } catch (err) {
      console.warn("WAV normalization fallback:", err);
      return null;
    } finally {
      if (audioCtx && audioCtx.state !== "closed") {
        audioCtx.close().catch(() => {});
      }
    }
  };

  // ==========================================
  // DETERMINE ACTUAL AUDIO DURATION ASYNCHRONOUSLY
  // ==========================================
  const determineAudioDuration = async (blob, sessionFallbackDuration = null) => {
    if (!blob || blob.size === 0) return NaN;

    // 1. Web Audio API decoding (decodes actual PCM frames from Blob)
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass) {
        const audioCtx = new AudioContextClass();
        try {
          const arrayBuffer = await blob.arrayBuffer();
          const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer.slice(0));
          if (
            audioBuffer &&
            typeof audioBuffer.duration === "number" &&
            isFinite(audioBuffer.duration) &&
            !isNaN(audioBuffer.duration) &&
            audioBuffer.duration > 0
          ) {
            return audioBuffer.duration;
          }
        } finally {
          if (audioCtx.state !== "closed") {
            audioCtx.close().catch(() => {});
          }
        }
      }
    } catch (decodeErr) {
      console.warn("AudioContext decodeAudioData duration check failed:", decodeErr);
    }

    // 2. HTML5 Audio element metadata probe
    try {
      const probeDuration = await new Promise((resolve) => {
        const audio = new Audio();
        audio.preload = "metadata";
        let blobUrl = "";
        try {
          blobUrl = URL.createObjectURL(blob);
        } catch {
          return resolve(NaN);
        }

        let settled = false;
        const cleanup = () => {
          audio.onloadedmetadata = null;
          audio.onerror = null;
          if (blobUrl) URL.revokeObjectURL(blobUrl);
        };

        audio.onloadedmetadata = () => {
          if (!settled) {
            settled = true;
            const d = audio.duration;
            cleanup();
            resolve(d);
          }
        };

        audio.onerror = () => {
          if (!settled) {
            settled = true;
            cleanup();
            resolve(NaN);
          }
        };

        setTimeout(() => {
          if (!settled) {
            settled = true;
            cleanup();
            resolve(NaN);
          }
        }, 1500);

        audio.src = blobUrl;
      });

      if (
        typeof probeDuration === "number" &&
        isFinite(probeDuration) &&
        !isNaN(probeDuration) &&
        probeDuration > 0
      ) {
        return probeDuration;
      }
    } catch (probeErr) {
      console.warn("HTML5 Audio metadata duration probe failed:", probeErr);
    }

    // 3. Wall-clock duration of the MediaRecorder session (stopTime - startTime)
    if (
      typeof sessionFallbackDuration === "number" &&
      isFinite(sessionFallbackDuration) &&
      !isNaN(sessionFallbackDuration) &&
      sessionFallbackDuration > 0
    ) {
      return sessionFallbackDuration;
    }

    return NaN;
  };

  // ==========================================
  // START RECORDING (HTML5 MediaRecorder)
  // ==========================================
  const startRecording = async () => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setStatusMessage({
        type: "error",
        text: "Audio recording is not supported in this browser.",
      });
      return;
    }

    // Reset previous audio states
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
      setAudioUrl(null);
    }
    setRecordedBlob(null);
    setRecordedAudioDuration(null);

    try {
      setStatusMessage({ type: "info", text: "Requesting microphone access..." });
      
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      mediaStreamRef.current = stream;

      // Select supported mimeType
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : MediaRecorder.isTypeSupported("audio/ogg;codecs=opus")
        ? "audio/ogg;codecs=opus"
        : "";

      const options = mimeType ? { mimeType } : {};
      const mediaRecorder = new MediaRecorder(stream, options);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        if (!recordingStopTimeRef.current) {
          recordingStopTimeRef.current = Date.now();
        }

        const sessionDuration =
          recordingStartTimeRef.current && recordingStopTimeRef.current
            ? (recordingStopTimeRef.current - recordingStartTimeRef.current) / 1000
            : null;

        const finalType = mediaRecorder.mimeType || "audio/webm";
        const audioBlob = new Blob(audioChunksRef.current, { type: finalType });

        // Release microphone hardware immediately
        stream.getTracks().forEach((track) => track.stop());

        // Validate raw audio blob size
        if (audioBlob.size < 512) {
          setStatusMessage({
            type: "warning",
            text: "Recording was empty. Please check your microphone and speak clearly.",
          });
          setRecordedBlob(null);
          setAudioUrl(null);
          setRecordedAudioDuration(null);
          return;
        }

        // Convert live recording into standard 16 kHz mono PCM WAV (matching uploaded-file audio format)
        let finalAudioBlob = audioBlob;
        let actualAudioDuration = NaN;
        try {
          const wavResult = await convertBlobTo16kHzWav(audioBlob);
          if (wavResult && wavResult.wavBlob && wavResult.duration > 0) {
            finalAudioBlob = wavResult.wavBlob;
            actualAudioDuration = wavResult.duration;
          }
        } catch (wavErr) {
          console.warn("WAV normalization notice:", wavErr);
        }

        // Fallback duration resolver if not already resolved by WAV decoder
        if (isNaN(actualAudioDuration) || actualAudioDuration <= 0) {
          actualAudioDuration = await determineAudioDuration(finalAudioBlob, sessionDuration);
        }

        // Safe debug logging required by specification
        const validationPassed =
          typeof actualAudioDuration === "number" &&
          !isNaN(actualAudioDuration) &&
          isFinite(actualAudioDuration) &&
          actualAudioDuration >= 2.0;

        const displayUiSeconds =
          recordingSecondsRef.current > 0
            ? recordingSecondsRef.current.toFixed(1)
            : sessionDuration
            ? sessionDuration.toFixed(1)
            : "0.0";

        console.log(
          `UI timer: ${displayUiSeconds}s\n` +
          `Blob size: ${(finalAudioBlob.size / 1024).toFixed(1)} KB\n` +
          `Actual audio duration: ${typeof actualAudioDuration === "number" && !isNaN(actualAudioDuration) && isFinite(actualAudioDuration) ? actualAudioDuration.toFixed(1) + "s" : "NaN"}\n` +
          `Validation duration: ${typeof actualAudioDuration === "number" && !isNaN(actualAudioDuration) && isFinite(actualAudioDuration) ? actualAudioDuration.toFixed(1) + "s" : "NaN"}\n` +
          `Result: ${validationPassed ? "PASS" : "FAIL"}`
        );

        // Async / Metadata Check: Do not use 0, NaN, Infinity, undefined
        if (
          typeof actualAudioDuration !== "number" ||
          isNaN(actualAudioDuration) ||
          !isFinite(actualAudioDuration) ||
          actualAudioDuration <= 0
        ) {
          setStatusMessage({
            type: "error",
            text: "Unable to determine audio duration. Please try recording again.",
          });
          setRecordedBlob(null);
          setAudioUrl(null);
          setRecordedAudioDuration(null);
          return;
        }

        // Validate minimum duration (< 2 sec -> reject, >= 2 sec -> allow)
        if (actualAudioDuration < 2.0) {
          setStatusMessage({
            type: "warning",
            text: "Audio is too short (minimum 2 seconds required). Please record or speak longer.",
          });
          setRecordedBlob(null);
          setAudioUrl(null);
          setRecordedAudioDuration(null);
          return;
        }

        let url;
        try {
          url = URL.createObjectURL(finalAudioBlob);
        } catch (objErr) {
          console.error("Failed to create object URL for recorded audio:", objErr);
          setStatusMessage({
            type: "error",
            text: "Unable to preview this audio file. Please choose another file.",
          });
          return;
        }

        setAudioUrl(url);
        setRecordedBlob(finalAudioBlob);
        setRecordedAudioDuration(actualAudioDuration);
        setPreviewError(false);
        setActiveSourceType("microphone");

        setStatusMessage({
          type: "info",
          text: `Recording captured! Listen to preview below, then click 'Process Voice Recording'.`,
        });
      };

      recordingStartTimeRef.current = Date.now();
      recordingStopTimeRef.current = null;
      recordingSecondsRef.current = 0;
      mediaRecorder.start();
      setIsRecording(true);
      setRecordingSeconds(0);
      setRecordedAudioDuration(null);
      setUnregisteredMachine(null);
      setStatusMessage({
        type: "recording",
        text: "Recording in progress... Speak clearly about the maintenance issue.",
      });

      timerIntervalRef.current = setInterval(() => {
        recordingSecondsRef.current += 1;
        setRecordingSeconds((prev) => prev + 1);
      }, 1000);
    } catch (err) {
      console.error("Microphone access error:", err);
      setStatusMessage({
        type: "error",
        text: "Microphone permission was denied or not found. Please enable microphone permissions.",
      });
    }
  };

  // ==========================================
  // STOP RECORDING
  // ==========================================
  const stopRecording = () => {
    recordingStopTimeRef.current = Date.now();
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
    }

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }

    setIsRecording(false);
  };

  // Reset/Discard Voice Recording
  const handleDiscardRecording = () => {
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
      setAudioUrl(null);
    }
    setRecordedBlob(null);
    setRecordedAudioDuration(null);
    setRecordingSeconds(0);
    recordingSecondsRef.current = 0;
    recordingStartTimeRef.current = null;
    recordingStopTimeRef.current = null;
    setPreviewError(false);
    setStatusMessage({
      type: "info",
      text: "Previous recording discarded. Ready to record again.",
    });
  };

  // Handle audio preview player errors
  const handleAudioPreviewError = () => {
    setPreviewError(true);
    setStatusMessage({
      type: "error",
      text: "Unable to preview this audio file. Please choose another file.",
    });
  };

  // ==========================================
  // FILE UPLOAD HANDLER
  // ==========================================
  const handleFileSelect = (e) => {
    try {
      setPreviewError(false);
      // Cancelled file selection
      if (!e || !e.target || !e.target.files || e.target.files.length === 0) {
        return;
      }

      let file;
      try {
        file = e.target.files[0];
      } catch (fileAccessErr) {
        console.error("OS / Device file access error:", fileAccessErr);
        setStatusMessage({
          type: "error",
          text: "Unable to access the selected audio file. Please copy the file to your device/computer and try again.",
        });
        return;
      }

      if (!file) {
        return;
      }

      // Handle null/inaccessible file or missing metadata (MTP/USB disconnection)
      try {
        if (typeof file.size !== "number" || isNaN(file.size) || !file.name) {
          throw new Error("File metadata unavailable");
        }
      } catch (metaErr) {
        console.error("File metadata check error:", metaErr);
        setStatusMessage({
          type: "error",
          text: "Unable to access the selected audio file. Please copy the file to your device/computer and try again.",
        });
        return;
      }

      if (file.size === 0) {
        setStatusMessage({
          type: "error",
          text: "Could not access the selected file. Please choose the audio file again.",
        });
        return;
      }

      // Check max file size limit (50 MB)
      if (file.size > 50 * 1024 * 1024) {
        setStatusMessage({
          type: "error",
          text: "File size exceeds 50MB limit. Please upload a smaller maintenance audio file.",
        });
        return;
      }

      // Validate audio format
      const validExtensions = [".wav", ".mp3", ".m4a", ".webm", ".ogg", ".aac", ".flac", ".mp4", ".opus"];
      const fileName = (file.name || "").toLowerCase();
      const hasValidExt = validExtensions.some((ext) => fileName.endsWith(ext));
      const hasAudioMime = file.type && file.type.startsWith("audio/");

      if (!hasAudioMime && !hasValidExt) {
        setStatusMessage({
          type: "error",
          text: "Unsupported audio format.",
        });
        return;
      }

      // Revoke previous audio preview URL
      if (audioUrl) {
        URL.revokeObjectURL(audioUrl);
      }

      let url;
      try {
        url = URL.createObjectURL(file);
      } catch (objUrlErr) {
        console.error("Could not create object URL for file:", objUrlErr);
        setStatusMessage({
          type: "error",
          text: "Unable to access the selected audio file. Please copy the file to your device/computer and try again.",
        });
        return;
      }

      setAudioUrl(url);
      setUploadedFile(file);
      setUploadedFileDuration(null);
      setActiveSourceType("uploaded_file");
      setUnregisteredMachine(null);

      // Verify browser can read and decode audio metadata
      const audioProbe = new Audio();
      audioProbe.preload = "metadata";
      audioProbe.onloadedmetadata = () => {
        const dur = audioProbe.duration;
        if (dur && !isNaN(dur) && isFinite(dur)) {
          setUploadedFileDuration(dur);
          if (dur < 2.0) {
            setStatusMessage({
              type: "warning",
              text: "Audio is too short (minimum 2 seconds required). Please choose another file.",
            });
            return;
          }
        }
        setStatusMessage({
          type: "info",
          text: `File selected: "${file.name}" (${formatFileSize(file.size)}${dur && !isNaN(dur) && isFinite(dur) ? `, ${Math.round(dur)}s` : ""}). Click 'Process Uploaded File' to continue.`,
        });
      };
      audioProbe.onerror = () => {
        console.warn("Audio preview probe failed for selected file.");
      };
      audioProbe.src = url;

      setStatusMessage({
        type: "info",
        text: `File selected: "${file.name}" (${formatFileSize(file.size)}). Click 'Process Uploaded File' to continue.`,
      });
    } catch (unexpectedErr) {
      console.error("Unexpected file selection error:", unexpectedErr);
      setStatusMessage({
        type: "error",
        text: "Could not access the selected file. Please choose the audio file again.",
      });
    }
  };

  const handleDiscardUpload = () => {
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
      setAudioUrl(null);
    }
    setUploadedFile(null);
    setUploadedFileDuration(null);
    setPreviewError(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
    setStatusMessage({
      type: "info",
      text: "Audio file removed. Select another file or switch to microphone.",
    });
  };

  // ==========================================
  // UNIFIED VOICE PIPELINE:
  // Standardize & Validate Audio -> Whisper STT -> Gemini Clean -> Validate Machine
  // ==========================================
  const processVoicePipeline = async (audioSource, sourceType = "microphone") => {
    if (isProcessingPipelineRef.current) {
      console.warn("Pipeline already in progress. Ignoring duplicate request.");
      return;
    }

    if (!audioSource) {
      setStatusMessage({
        type: "error",
        text: "No audio provided to process. Please record or upload an audio file first.",
      });
      return;
    }

    // Audio duration check (minimum 2 seconds required)
    if (sourceType === "microphone" && recordedAudioDuration !== null && recordedAudioDuration < 2.0) {
      setStatusMessage({
        type: "warning",
        text: "Audio is too short (minimum 2 seconds required). Please record or speak longer.",
      });
      return;
    }

    if (sourceType === "uploaded_file" && uploadedFileDuration && uploadedFileDuration < 2.0) {
      setStatusMessage({
        type: "warning",
        text: "Audio is too short (minimum 2 seconds required). Please choose another file.",
      });
      return;
    }

    if (previewError) {
      setStatusMessage({
        type: "error",
        text: "Unable to preview this audio file. Please choose another file.",
      });
      return;
    }

    isProcessingPipelineRef.current = true;
    setIsTranscribing(true);
    setProcessingStage("audio");
    setStatusMessage({
      type: "info",
      text: "Step 1/3: Audio signal analysis & 16kHz PCM standardization...",
    });

    try {
      // 1. WHISPER SPEECH-TO-TEXT & ENGLISH TRANSLATION
      const formData = new FormData();
      const fileName =
        audioSource.name ||
        (sourceType === "microphone" ? "mic_recording.wav" : "audio_upload.wav");

      formData.append("audio", audioSource, fileName);
      formData.append("source_type", sourceType);

      if (language && language !== "auto") {
        formData.append("language", language);
      }

      // Check if user has explicitly selected a machine from dropdown
      const selectedMachineObj = machines.find(
        (m) => String(m.machine_id) === String(machine)
      );
      if (selectedMachineObj) {
        formData.append("selected_machine_code", selectedMachineObj.machine_code || "");
        formData.append("selected_machine_name", selectedMachineObj.machine_name || "");
      }

      setProcessingStage("whisper");
      setStatusMessage({
        type: "info",
        text: "Step 2/3: Transcribing speech with OpenAI Whisper...",
      });

      const whisperResponse = await fetch(`${ML_BASE_URL}/transcribe`, {
        method: "POST",
        body: formData,
      });

      const whisperResult = await whisperResponse.json().catch(() => ({}));

      if (!whisperResponse.ok || whisperResult.success === false) {
        if (whisperResult.stage === "preprocessing") {
          throw new Error("Audio conversion failed.");
        } else if (whisperResult.stage === "audio") {
          throw new Error(whisperResult.error || "Unable to process the audio file.");
        } else if (
          whisperResult.stage === "transcription_validation" ||
          whisperResult.validation_reason?.toLowerCase().includes("no speech") ||
          whisperResult.error?.toLowerCase().includes("no speech")
        ) {
          throw new Error("No speech could be detected.");
        } else if (whisperResult.stage === "transcription") {
          throw new Error("Speech transcription service failed.");
        } else {
          throw new Error(whisperResult.error || "Speech transcription service failed.");
        }
      }

      const rawNative =
        whisperResult.native_text || whisperResult.transcription || "";
      const rawEnglish =
        whisperResult.english_text ||
        whisperResult.english_translation ||
        rawNative;
      const detectedLang =
        whisperResult.detected_language || whisperResult.language || "";
      const codeMixed = Boolean(whisperResult.is_code_mixed);

      setNativeTranscript(rawNative);
      setRawEnglishTranslation(rawEnglish);
      setDetectedLanguage(detectedLang);
      setIsCodeMixed(codeMixed);
      const wordCount = whisperResult.transcript_word_count || rawNative.split(/\s+/).filter(Boolean).length;
      const audioDuration = whisperResult.audio_duration || 0;
      const speechRate = whisperResult.words_per_minute || (audioDuration > 0 ? Math.round((wordCount / audioDuration) * 60) : 0);

      setDiagnosticMetrics({
        duration: audioDuration,
        model: whisperResult.whisper_model || "small",
        language: detectedLang || language,
        wordCount: wordCount,
        wpm: speechRate,
        repetitionScore: whisperResult.repetition_score !== undefined ? whisperResult.repetition_score : 0.0,
        validationResult: whisperResult.validation_result || "PASSED",
      });

      if (sourceType === "microphone") {
        console.log(
          `[WHISPER DIAGNOSTIC - LIVE MICROPHONE]\n` +
          `live Blob MIME type: ${audioSource.type || "audio/wav"}\n` +
          `live Blob size: ${(audioSource.size / 1024).toFixed(1)} KB\n` +
          `live audio duration: ${typeof recordedAudioDuration === "number" ? recordedAudioDuration.toFixed(1) + "s" : "N/A"}\n` +
          `processed audio duration: ${audioDuration}s\n` +
          `Whisper transcript: "${rawNative}"\n` +
          `word count: ${wordCount}`
        );
      }

      if (!rawEnglish.trim() && !rawNative.trim()) {
        setStatusMessage({
          type: "warning",
          text: "No spoken words were recognized in the audio. Please speak clearly and try again.",
        });
        setIsTranscribing(false);
        return;
      }

      // DIAGNOSTIC TEST MODE: Only allow bypass if dev diagnostic mode is enabled
      if (rawWhisperDebugMode && isDevDiagnosticEnabled) {
        setIsTranscribing(false);
        setCleanedReport(""); // Explicitly bypass Gemini
        setStatusMessage({
          type: "success",
          text: `[DIAGNOSTIC MODE] Raw Whisper Transcript Extracted (${audioDuration}s, ${wordCount} words, Model: ${whisperResult.whisper_model || "small"}). Gemini bypassed.`,
        });
        return;
      }

      // 2. AUTOMATIC MACHINE IDENTIFICATION & FIRESTORE LOOKUP
      setIsTranscribing(false);
      setProcessingStage("machine_lookup");
      setStatusMessage({
        type: "info",
        text: "Step 2/3: Identifying machine from speech and verifying registry...",
      });

      const currentUserId =
        localStorage.getItem("userId") ||
        localStorage.getItem("userName") ||
        "engineer1";

      let authMachineCode = selectedMachineObj?.machine_code || "";
      let authMachineName = selectedMachineObj?.machine_name || "";
      let isUnregistered = false;

      try {
        const identifyResponse = await fetch(`${API_BASE_URL}/identify-machine`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: rawEnglish,
            original_text: rawNative,
            engineer_id: currentUserId,
          }),
        });

        const identifyResult = await identifyResponse.json().catch(() => ({}));

        if (identifyResult.exists && identifyResult.machine) {
          // Machine EXISTS in Firestore
          authMachineCode = identifyResult.machine.machine_code;
          authMachineName = identifyResult.machine.machine_name;
          setMachine(String(identifyResult.machine.machine_id));
          setDetectedMachineRef(identifyResult.machine.machine_code);
          setUnregisteredMachine(null);
          setStatusMessage({
            type: "success",
            text: `Machine identified: ${authMachineCode} (${authMachineName}). Cleaning report...`,
          });
        } else if (identifyResult.machine_code && identifyResult.machine_code !== "UNKNOWN-MACHINE") {
          // Machine was extracted but does NOT exist in Firestore
          authMachineCode = identifyResult.machine_code;
          authMachineName = identifyResult.machine_name || identifyResult.machine_code;
          isUnregistered = true;
          setUnregisteredMachine(authMachineCode);
          setDetectedMachineRef(authMachineCode);
          setMachine(""); // Deselect machine to block finalizing report until approved
          setStatusMessage({
            type: "warning",
            text: "Machine not registered. A request has been sent to the Head Officer for approval.",
          });
        } else if (!machine) {
          // No machine identity found in speech and none pre-selected
          setUnregisteredMachine(null);
        }
      } catch (idErr) {
        console.warn("Machine identification check failed:", idErr);
      }

      // 3. CLEAN & PROFESSIONALIZE WITH GEMINI (/clean-report)
      setIsCleaning(true);
      setProcessingStage("gemini");
      setStatusMessage({
        type: "info",
        text: "Step 3/3: Professionalizing maintenance report with Gemini AI...",
      });

      const cleanResponse = await fetch(`${API_BASE_URL}/clean-report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: rawEnglish,
          original_text: rawNative,
          is_code_mixed: codeMixed,
          language: detectedLang || language,
          source_type: sourceType,
          authoritative_machine_code: authMachineCode,
          authoritative_machine_name: authMachineName,
        }),
      });

      const cleanResult = await cleanResponse.json().catch(() => ({}));
      if (!cleanResponse.ok || cleanResult.success === false) {
        throw new Error(cleanResult.message || "Report processing failed.");
      }

      const cleanedText = cleanResult.cleaned_report || rawEnglish;
      setCleanedReport(cleanedText);
      setExtractedProblem(cleanResult.problem || "");
      setExtractedSolution(cleanResult.solution || "");
      setExtractedStatus(cleanResult.maintenance_status || "");
      if (cleanResult.maintenance_time) {
        setMaintenanceTime(cleanResult.maintenance_time);
      }

      // If machine is unregistered, attach full cleaned report to pending request
      if (isUnregistered && authMachineCode) {
        try {
          await fetch(`${API_BASE_URL}/pending-machines`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              report_text: cleanedText,
              machine_code: authMachineCode,
              machine_name: authMachineName,
              requested_by: currentUserId,
              draft_report: {
                original_text: rawNative.trim() || rawEnglish.trim(),
                source_language: language,
                translated_report: rawEnglish.trim(),
                cleaned_report: cleanedText,
                problem: cleanResult.problem,
                solution: cleanResult.solution,
                maintenance_status: cleanResult.maintenance_status,
                engineer_id: currentUserId,
                source_type: sourceType,
              },
            }),
          });
        } catch (reqErr) {
          console.error("Failed to post pending machine request:", reqErr);
        }

        setStatusMessage({
          type: "warning",
          text: "Machine not registered. A request has been sent to the Head Officer for approval.",
        });
      } else if (authMachineCode) {
        setStatusMessage({
          type: "success",
          text: `Report ready for machine: ${authMachineCode} (${authMachineName}).`,
        });
      } else {
        setStatusMessage({
          type: "info",
          text: "Report professionalized successfully! Please select the target machine before submitting.",
        });
      }
    } catch (err) {
      console.error("Voice pipeline error:", err);
      const isNetworkError =
        err.name === "TypeError" ||
        err.message?.toLowerCase().includes("failed to fetch") ||
        err.message?.toLowerCase().includes("networkerror") ||
        err.message?.toLowerCase().includes("network error") ||
        err.message?.toLowerCase().includes("connection refused") ||
        err.message?.toLowerCase().includes("load failed");

      setStatusMessage({
        type: "error",
        text: isNetworkError
          ? "Connection lost. Please retry."
          : err.message || "Report processing failed.",
      });
    } finally {
      isProcessingPipelineRef.current = false;
      setIsTranscribing(false);
      setIsCleaning(false);
      setProcessingStage("");
    }
  };

  // ==========================================
  // ANALYZE REPORT WITH GEMINI (/analyze-report)
  // ==========================================
  const analyzeReport = async (text, preExtracted = {}) => {
    const response = await fetch(`${API_BASE_URL}/analyze-report`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        report: text.trim(),
        problem: preExtracted.problem || extractedProblem || "",
        solution: preExtracted.solution || extractedSolution || "",
        maintenance_status: preExtracted.maintenance_status || extractedStatus || "",
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.message || "Failed to analyze report with Gemini");
    }

    return data.analysis;
  };

  // ==========================================
  // SUBMIT FINAL REPORT (/reports)
  // ==========================================
  const handleSubmit = async () => {
    // 1. Check if unregistered machine blocker is active
    if (unregisteredMachine) {
      setStatusMessage({
        type: "error",
        text: `Cannot submit: Machine '${unregisteredMachine}' is not currently registered in the system. Please wait until the Head Officer confirms and approves it.`,
      });
      return;
    }

    // 2. Check machine selection
    if (!machine) {
      setStatusMessage({
        type: "error",
        text: "No machine could be identified from your report. Please select a machine from the list before submitting.",
      });
      return;
    }

    // 3. Check report text
    const finalReportText = cleanedReport.trim();
    if (!finalReportText) {
      setStatusMessage({
        type: "error",
        text: "Please record or enter a maintenance report before submitting.",
      });
      return;
    }

    try {
      setIsSubmitting(true);
      setStatusMessage({
        type: "info",
        text: "Gemini AI is analyzing report fields (problem, solution, status)...",
      });

      // Step 1: AI structured analysis on CLEANED report
      const analysis = await analyzeReport(finalReportText, {
        problem: extractedProblem,
        solution: extractedSolution,
        maintenance_status: extractedStatus,
      });

      // Step 2: Session Engineer ID
      const engineerId =
        localStorage.getItem("userId") ||
        localStorage.getItem("userName") ||
        "engineer1";

      const machineIdNumber = Number(machine);
      const selectedMachine = machines.find(
        (item) => Number(item.machine_id) === machineIdNumber
      );

      // Step 3: Complete Payload with all audit fields including source_type
      const requestBody = {
        machine_id: machineIdNumber,
        machine_code: selectedMachine?.machine_code || "N/A",
        machine_name: selectedMachine?.machine_name || "Unknown Machine",
        engineer_id: engineerId,

        // Preserved original & translated versions
        original_text: nativeTranscript.trim() || rawEnglishTranslation.trim(),
        translated_report: rawEnglishTranslation.trim(),
        cleaned_report: finalReportText,

        // Canonical report field for existing dashboards
        report: finalReportText,

        // Gemini structured findings (user edits take precedence)
        problem: extractedProblem || analysis?.problem || "",
        solution: extractedSolution || analysis?.solution || "",
        maintenance_status: extractedStatus || analysis?.maintenance_status || "Completed",
        maintenance_time: maintenanceTime || analysis?.maintenance_time || "",
        source_language: detectedLanguage || language,
        is_code_mixed: isCodeMixed,
        source_type: activeSourceType || "microphone",
      };

      setStatusMessage({ type: "info", text: "Saving report to database..." });

      // Step 4: Save to Firestore
      const response = await fetch(`${API_BASE_URL}/reports`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || "Failed to save report to database.");
      }

      setStatusMessage({
        type: "success",
        text: "Maintenance report submitted and recorded successfully!",
      });

      setTimeout(() => {
        navigate("/engineer/history");
      }, 700);
    } catch (err) {
      console.error("Submit error:", err);
      setStatusMessage({
        type: "error",
        text: err.message || "Failed to process and save report. Please try again.",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const isBusy = isRecording || isTranscribing || isCleaning || isSubmitting;

  return (
    <DashboardLayout>
      <div className="voice-report">
        {/* =====================================
            HEADER
        ====================================== */}
        <div className="voice-report-header">
          <div>
            <h1>Voice-Based Machine Maintenance</h1>
            <p>
              Dual Mode Audio Ingestion: Record Live Speech or Upload Voice File
              &rarr; 16kHz PCM Standardization &rarr; OpenAI Whisper STT &rarr; Gemini Professionalization &rarr; Firestore
            </p>
          </div>
          <div className="header-tag">
            <Sparkles size={16} />
            <span>Whisper + Gemini AI</span>
          </div>
        </div>

        {/* =====================================
            STATUS MESSAGE BANNER
        ====================================== */}
        {statusMessage.text && (
          <div className={`status-banner status-${statusMessage.type}`}>
            {statusMessage.type === "error" && <AlertCircle size={20} />}
            {statusMessage.type === "warning" && <AlertTriangle size={20} />}
            {statusMessage.type === "success" && <CheckCircle2 size={20} />}
            {statusMessage.type === "recording" && (
              <span className="live-dot pulse"></span>
            )}
            {statusMessage.type === "info" && (
              <RefreshCw size={18} className="spin-icon" />
            )}
            <span style={{ flex: 1 }}>{statusMessage.text}</span>
            {statusMessage.text.toLowerCase().includes("retry") && !isBusy && (uploadedFile || recordedBlob) && (
              <button
                type="button"
                className="retry-btn-inline"
                onClick={() => processVoicePipeline(activeSourceType === "uploaded_file" ? uploadedFile : recordedBlob, activeSourceType)}
                title="Retry processing current audio"
              >
                <RotateCcw size={14} />
                <span>Retry</span>
              </button>
            )}
          </div>
        )}

        {/* =====================================
            MACHINE NOT REGISTERED WARNING BANNER
        ====================================== */}
        {unregisteredMachine && (
          <div className="unregistered-machine-banner">
            <div className="banner-left">
              <AlertTriangle size={28} className="warning-icon" />
              <div className="banner-text-block">
                <h3>Machine Not Registered</h3>
                <p className="banner-code-line">
                  Machine Code: <strong className="code-tag">{unregisteredMachine}</strong>
                </p>
                <p className="banner-contact-notice">
                  This machine is not currently registered in the system. The machine details have been sent to the Head Officer for confirmation. Please wait until the machine is approved.
                </p>
              </div>
            </div>
            <div className="banner-actions">
              <button
                type="button"
                className="btn-refresh-machine"
                onClick={handleRefreshMachines}
                disabled={isRefreshing}
                title="Check if the Head Officer has approved and registered this machine"
              >
                <RefreshCw size={16} className={isRefreshing ? "spin-icon" : ""} />
                <span>{isRefreshing ? "Checking..." : "Check Approval / Refresh Equipment"}</span>
              </button>
            </div>
          </div>
        )}

        {/* =====================================
            STEP 1: MACHINE & LANGUAGE CONFIG
        ====================================== */}
        <div className="report-card">
          <div className="card-header space-between">
            <div className="card-header-left">
              <Wrench size={22} className="card-header-icon" />
              <h2>Equipment & Language Details</h2>
            </div>
            <button
              type="button"
              className="link-refresh-machines"
              onClick={handleRefreshMachines}
              disabled={isRefreshing}
              title="Refresh equipment list from factory system"
            >
              <RefreshCw size={14} className={isRefreshing ? "spin-icon" : ""} />
              <span>{isRefreshing ? "Refreshing..." : "Refresh List"}</span>
            </button>
          </div>

          <div className="config-grid">
            {/* MACHINE SELECTION */}
            <div className="form-group">
              <label>Select Machine *</label>
              <select
                value={machine}
                onChange={(e) => {
                  setMachine(e.target.value);
                  setUnregisteredMachine(null);
                }}
                disabled={isBusy}
              >
                <option value="">-- Choose Equipment --</option>
                {machines.map((item) => (
                  <option key={item.id} value={item.machine_id}>
                    {item.machine_code} - {item.machine_name}
                  </option>
                ))}
              </select>
            </div>

            {/* LANGUAGE SELECTION */}
            <div className="form-group">
              <label>
                <Languages size={16} className="inline-icon" />
                Spoken Language
              </label>
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                disabled={isBusy}
              >
                <option value="ta-IN">Tamil (தமிழ் / Thanglish)</option>
                <option value="en-US">English</option>
                <option value="ml-IN">Malayalam (മലയാളം)</option>
                <option value="hi-IN">Hindi (हिन्दी)</option>
                <option value="te-IN">Telugu (తెలుగు)</option>
                <option value="auto">Auto-Detect Language</option>
              </select>
            </div>
          </div>

          {/* DIAGNOSTIC MODE TOGGLE BAR (Hidden from normal engineers; visible only in dev/testing via ?debug=true) */}
          {isDevDiagnosticEnabled && (
            <div className="diagnostic-toggle-bar">
              <label className="diagnostic-toggle-label">
                <input
                  type="checkbox"
                  checked={rawWhisperDebugMode}
                  onChange={(e) => {
                    setRawWhisperDebugMode(e.target.checked);
                    if (e.target.checked) {
                      setStatusMessage({
                        type: "info",
                        text: "Diagnostic Mode Activated: Will display raw Whisper output only without sending to Gemini.",
                      });
                    }
                  }}
                  disabled={isBusy}
                />
                <span className="diagnostic-toggle-text">
                  <strong>Raw Whisper Diagnostic Mode</strong> (Dev/Testing only: Bypass Gemini translation & display exact raw Whisper STT metrics)
                </span>
              </label>
            </div>
          )}
        </div>

        {/* =====================================
            STEP 2: AUDIO INGESTION (MIC vs UPLOAD TABS)
        ====================================== */}
        <div className="report-card voice-card">
          <div className="audio-mode-tabs">
            <button
              type="button"
              className={`mode-tab-btn ${inputMode === "mic" ? "active" : ""}`}
              onClick={() => {
                if (!isBusy) {
                  setInputMode("mic");
                }
              }}
              disabled={isBusy}
            >
              <Mic size={18} />
              <span>Record Live Microphone</span>
            </button>

            <button
              type="button"
              className={`mode-tab-btn ${inputMode === "upload" ? "active" : ""}`}
              onClick={() => {
                if (!isBusy) {
                  setInputMode("upload");
                }
              }}
              disabled={isBusy}
            >
              <Upload size={18} />
              <span>Upload Voice Audio File</span>
            </button>
          </div>

          {/* TAB 1: MICROPHONE CAPTURE */}
          {inputMode === "mic" && (
            <div className="record-container">
              <div className="recording-meter">
                <div
                  className={`mic-orb ${isRecording ? "orb-recording" : ""} ${
                    isTranscribing || isCleaning ? "orb-processing" : ""
                  }`}
                >
                  <Mic size={36} />
                </div>

                <div className="timer-display">
                  <Clock size={18} />
                  <span>{formatTime(recordingSeconds)}</span>
                </div>

                <p className="record-status-label">
                  {isRecording
                    ? "Listening to your maintenance report... Speak naturally."
                    : isTranscribing
                    ? "Whisper is transcribing & standardizing..."
                    : isCleaning
                    ? "Gemini is cleaning & structuring report..."
                    : audioUrl && recordedBlob
                    ? "Recording captured! Review audio preview below."
                    : "Click 'Start Recording' and speak your report"}
                </p>
              </div>

              {/* RECORDING BUTTONS */}
              <div className="record-actions">
                {!isRecording ? (
                  <button
                    type="button"
                    className="record-btn start-btn"
                    onClick={startRecording}
                    disabled={isBusy}
                  >
                    <Mic size={20} />
                    <span>Start Recording</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    className="record-btn stop-btn"
                    onClick={stopRecording}
                  >
                    <Square size={20} />
                    <span>Stop Recording</span>
                  </button>
                )}
              </div>

              {/* RECORDED VOICE PREVIEW & DEDICATED PROCESS BUTTON */}
              {audioUrl && recordedBlob && !isRecording && (
                <div className="audio-preview-card">
                  <div className="preview-top-row">
                    <div className="audio-preview-label">
                      <Volume2 size={16} />
                      <span>Recorded Voice Preview</span>
                      <span className="badge-pill">{formatTime(Math.round(recordedAudioDuration || recordingSeconds))}</span>
                      <span className="badge-pill">{formatFileSize(recordedBlob.size)}</span>
                    </div>
                  </div>

                  <audio src={audioUrl} controls className="audio-player" onError={handleAudioPreviewError} />

                  <div className="preview-action-row">
                    <button
                      type="button"
                      className="btn-secondary-action"
                      onClick={handleDiscardRecording}
                      disabled={isBusy}
                    >
                      <RotateCcw size={16} />
                      <span>Re-record Voice</span>
                    </button>

                    <button
                      type="button"
                      className="btn-primary-action"
                      onClick={() => processVoicePipeline(recordedBlob, "microphone")}
                      disabled={isBusy || previewError}
                    >
                      {isTranscribing || isCleaning ? (
                        <>
                          <RefreshCw size={16} className="spin-icon" />
                          <span>Processing Pipeline...</span>
                        </>
                      ) : (
                        <>
                          <ArrowRight size={16} />
                          <span>Process Voice Recording</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 2: FILE UPLOAD */}
          {inputMode === "upload" && (
            <div className="upload-container">
              <input
                ref={fileInputRef}
                type="file"
                id="voice-file-upload-input"
                accept="audio/*"
                style={{ display: "none" }}
                onChange={handleFileSelect}
                disabled={isBusy}
              />

              {!uploadedFile ? (
                <div
                  className="upload-dropzone"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <div className="upload-icon-bubble">
                    <Upload size={32} />
                  </div>
                  <h3>Select or Drop Voice Audio File</h3>
                  <p>
                    Supported Formats: <strong>.WAV, .MP3, .M4A, .WEBM, .OGG</strong> (Max: 50 MB)
                  </p>
                  <button
                    type="button"
                    className="browse-file-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      fileInputRef.current?.click();
                    }}
                    disabled={isBusy}
                  >
                    <FileAudio size={18} />
                    <span>Browse Audio File</span>
                  </button>
                </div>
              ) : (
                <div className="audio-preview-card upload-preview-card">
                  <div className="preview-top-row">
                    <div className="audio-preview-label">
                      <FileAudio size={18} className="file-icon" />
                      <span className="file-name-tag" title={uploadedFile.name}>
                        {uploadedFile.name}
                      </span>
                      <span className="badge-pill">{formatFileSize(uploadedFile.size)}</span>
                      {uploadedFileDuration && (
                        <span className="badge-pill">{formatTime(Math.round(uploadedFileDuration))}</span>
                      )}
                    </div>
                  </div>

                  <audio
                    src={audioUrl}
                    controls
                    className="audio-player"
                    onError={handleAudioPreviewError}
                    onLoadedMetadata={(e) => {
                      if (e.target?.duration && !isNaN(e.target.duration) && isFinite(e.target.duration)) {
                        setUploadedFileDuration(e.target.duration);
                      }
                    }}
                  />

                  <div className="preview-action-row">
                    <button
                      type="button"
                      className="btn-secondary-action"
                      onClick={handleDiscardUpload}
                      disabled={isBusy}
                    >
                      <RotateCcw size={16} />
                      <span>Choose Different File</span>
                    </button>

                    <button
                      type="button"
                      className="btn-primary-action"
                      onClick={() => processVoicePipeline(uploadedFile, "uploaded_file")}
                      disabled={isBusy}
                    >
                      {isTranscribing || isCleaning ? (
                        <>
                          <RefreshCw size={16} className="spin-icon" />
                          <span>Processing Pipeline...</span>
                        </>
                      ) : (
                        <>
                          <ArrowRight size={16} />
                          <span>Process Uploaded File</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* =====================================
            STEP 3: REPORT REVIEW & SUBMISSION
        ====================================== */}
        <div className="report-card results-card">
          <div className="card-header space-between">
            <div className="card-header-left">
              <Sparkles size={22} className="card-header-icon" />
              <h2>
                {(rawWhisperDebugMode && isDevDiagnosticEnabled) ? "Raw Whisper Diagnostic Output" : "Report Review & Submission"}
              </h2>
            </div>
            {(rawWhisperDebugMode && isDevDiagnosticEnabled) && (
              <div className="badge-pill" style={{ background: "#fef3c7", color: "#92400e", border: "1px solid #fde68a" }}>
                Diagnostic Mode (Gemini Bypassed)
              </div>
            )}
            {!(rawWhisperDebugMode && isDevDiagnosticEnabled) && detectedMachineRef && (
              <div className="machine-detected-tag">
                <Tag size={14} />
                <span>Identified: {detectedMachineRef}</span>
              </div>
            )}
          </div>

          {/* DIAGNOSTIC METRICS DISPLAY (Dev/Testing Only via ?debug=true) */}
          {(rawWhisperDebugMode && isDevDiagnosticEnabled) && diagnosticMetrics && (
            <div className="diagnostic-metrics-grid">
              <div className="metric-chip">
                <span className="metric-label">Audio Duration</span>
                <strong className="metric-value">{diagnosticMetrics.duration}s</strong>
              </div>
              <div className="metric-chip">
                <span className="metric-label">Whisper Model</span>
                <strong className="metric-value" style={{ textTransform: "uppercase", color: "#4f46e5" }}>
                  {diagnosticMetrics.model || "small"}
                </strong>
              </div>
              <div className="metric-chip">
                <span className="metric-label">Detected Language</span>
                <strong className="metric-value">{diagnosticMetrics.language}</strong>
              </div>
              <div className="metric-chip">
                <span className="metric-label">Word Count</span>
                <strong className="metric-value">{diagnosticMetrics.wordCount} words</strong>
              </div>
              <div className="metric-chip">
                <span className="metric-label">Speech Rate</span>
                <strong className="metric-value">{diagnosticMetrics.wpm} WPM</strong>
              </div>
              <div className="metric-chip">
                <span className="metric-label">Repetition Score</span>
                <strong className="metric-value">
                  {diagnosticMetrics.repetitionScore !== undefined ? diagnosticMetrics.repetitionScore : "0.00"}
                </strong>
              </div>
              <div className="metric-chip">
                <span className="metric-label">Validation Result</span>
                <strong
                  className="metric-value"
                  style={{
                    color: diagnosticMetrics.validationResult === "PASSED" ? "#16a34a" : "#dc2626",
                  }}
                >
                  {diagnosticMetrics.validationResult || "PASSED"}
                </strong>
              </div>
            </div>
          )}

          {/* DEV DIAGNOSTIC RAW VIEW vs SERVICE ENGINEER PROFESSIONAL REVIEW VIEW */}
          {(rawWhisperDebugMode && isDevDiagnosticEnabled) ? (
            <div className="diagnostic-single-view">
              <div className="box-title">
                <span>Raw Whisper Transcript (Unedited & Untranslated)</span>
                <span className="badge-pill">OpenAI Whisper Direct</span>
              </div>
              <textarea
                value={nativeTranscript}
                readOnly
                placeholder="Raw Whisper speech-to-text transcript will appear here..."
                rows="6"
                className="diagnostic-textarea"
              />
              <div className="diagnostic-notice">
                <Info size={16} />
                <span>
                  Notice: In Diagnostic Mode, speech is converted directly by Whisper without any Gemini text cleaning, translation, or modification.
                </span>
              </div>
            </div>
          ) : (
            /* SERVICE ENGINEER PROFESSIONAL REVIEW: FULL-WIDTH CLEANED REPORT ONLY */
            <div className="report-review-container">
              {/* SUB-HEADER / SECTION TITLE */}
              <div className="review-section-header">
                <div className="review-title-wrap">
                  <FileText size={18} className="section-title-icon" />
                  <h3>Maintenance Report</h3>
                </div>
                <span className="badge-pill badge-primary">Cleaned Professional English</span>
              </div>

              {/* CLEANED PROFESSIONAL REPORT (FULL WIDTH) */}
              <div className="review-box full-width-box">
                <div className="box-title">
                  <span>Cleaned Professional Report *</span>
                  <span className="field-hint">AI-cleaned and standardized English maintenance report</span>
                </div>
                <textarea
                  id="cleaned-report-text"
                  value={cleanedReport}
                  onChange={(e) => setCleanedReport(e.target.value)}
                  placeholder="The cleaned, professional English maintenance report will appear here. You can review and make edits if needed..."
                  rows="6"
                  className="cleaned-report-textarea"
                />
              </div>

              {/* STRUCTURED FIELDS: MACHINE INFO, PROBLEM, SOLUTION, STATUS, MAINTENANCE TIME */}
              <div className="structured-fields-grid">
                {/* MACHINE INFORMATION */}
                <div className="structured-field machine-field">
                  <label className="field-label">
                    <Wrench size={14} />
                    <span>Machine Information</span>
                  </label>
                  <div className="readonly-field-box">
                    {(() => {
                      const selectedMachineObj = machines.find(
                        (m) => String(m.machine_id) === String(machine)
                      );
                      if (selectedMachineObj) {
                        return (
                          <span className="machine-badge-text">
                            <strong>{selectedMachineObj.machine_code}</strong> — {selectedMachineObj.machine_name}
                          </span>
                        );
                      }
                      if (detectedMachineRef) {
                        return (
                          <span className="machine-badge-text">
                            <strong>{detectedMachineRef}</strong>
                          </span>
                        );
                      }
                      return (
                        <span className="placeholder-text">Identified automatically from voice report</span>
                      );
                    })()}
                  </div>
                </div>

                {/* STATUS */}
                <div className="structured-field">
                  <label htmlFor="report-status-input" className="field-label">
                    <Info size={14} />
                    <span>Status</span>
                  </label>
                  <input
                    type="text"
                    id="report-status-input"
                    value={extractedStatus}
                    onChange={(e) => setExtractedStatus(e.target.value)}
                    placeholder="e.g. Operating - Further Observation Required"
                    className="structured-input single-line-input"
                  />
                </div>

                {/* PROBLEM */}
                <div className="structured-field full-row-field">
                  <label htmlFor="report-problem-input" className="field-label">
                    <AlertCircle size={14} />
                    <span>Problem</span>
                  </label>
                  <textarea
                    id="report-problem-input"
                    value={extractedProblem}
                    onChange={(e) => setExtractedProblem(e.target.value)}
                    placeholder="Observed problem or inspection issue..."
                    rows="2"
                    className="structured-input"
                  />
                </div>

                {/* SOLUTION */}
                <div className="structured-field full-row-field">
                  <label htmlFor="report-solution-input" className="field-label">
                    <CheckCircle2 size={14} />
                    <span>Solution</span>
                  </label>
                  <textarea
                    id="report-solution-input"
                    value={extractedSolution}
                    onChange={(e) => setExtractedSolution(e.target.value)}
                    placeholder="Maintenance actions taken or solution performed..."
                    rows="2"
                    className="structured-input"
                  />
                </div>

                {/* MAINTENANCE TIME */}
                <div className="structured-field">
                  <label htmlFor="report-time-input" className="field-label">
                    <Clock size={14} />
                    <span>Maintenance Time</span>
                  </label>
                  <input
                    type="text"
                    id="report-time-input"
                    value={maintenanceTime}
                    onChange={(e) => setMaintenanceTime(e.target.value)}
                    placeholder="e.g. 30 mins, 45 mins, 2 hours..."
                    className="structured-input single-line-input"
                  />
                </div>
              </div>

              {/* SUBMIT BUTTON */}
              <div className="submit-action-row">
                <button
                  type="button"
                  className="submit-btn"
                  onClick={handleSubmit}
                  disabled={isBusy || Boolean(unregisteredMachine)}
                  title={
                    unregisteredMachine
                      ? "Report cannot be submitted until machine is confirmed and approved by Head Officer"
                      : "Submit Maintenance Report"
                  }
                >
                  {isSubmitting ? (
                    <>
                      <RefreshCw size={20} className="spin-icon" />
                      <span>Analyzing &amp; Saving to Cloud...</span>
                    </>
                  ) : (
                    <>
                      <Send size={20} />
                      <span>Submit Maintenance Report</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}

export default VoiceReport;