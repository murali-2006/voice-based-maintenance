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
} from "lucide-react";

import DashboardLayout from "../../layouts/DashboardLayout";
import "./VoiceReport.css";
import { API_BASE_URL, ML_BASE_URL } from "../../config/api";

function VoiceReport() {
  const [machine, setMachine] = useState("");
  const [machines, setMachines] = useState([]);
  const [language, setLanguage] = useState("ta-IN");

  // Recording State
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [audioUrl, setAudioUrl] = useState(null);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isCleaning, setIsCleaning] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Transcribed, Translated & Cleaned Results
  const [nativeTranscript, setNativeTranscript] = useState("");
  const [rawEnglishTranslation, setRawEnglishTranslation] = useState("");
  const [cleanedReport, setCleanedReport] = useState("");
  const [detectedLanguage, setDetectedLanguage] = useState("");
  const [detectedMachineRef, setDetectedMachineRef] = useState("");

  // Unregistered Machine State (Read-only notice for Engineer, waiting for Head Officer approval)
  const [unregisteredMachine, setUnregisteredMachine] = useState(null);

  // Status message
  const [statusMessage, setStatusMessage] = useState({ type: "", text: "" });

  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const timerIntervalRef = useRef(null);
  const mediaStreamRef = useRef(null);

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
    };
  }, []);

  // ==========================================
  // REFRESH EQUIPMENT LIST
  // (Allows engineer to pull newly registered machines after Head Officer approves them)
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
        // Check if the previously unregistered machine is now registered
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

    try {
      setStatusMessage({ type: "info", text: "Requesting microphone access..." });
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, {
          type: mediaRecorder.mimeType || "audio/webm",
        });
        const url = URL.createObjectURL(audioBlob);
        setAudioUrl(url);

        // Release microphone
        stream.getTracks().forEach((track) => track.stop());

        // Process audio with Whisper, then Clean, then Validate Machine
        await processVoicePipeline(audioBlob);
      };

      mediaRecorder.start(250);
      setIsRecording(true);
      setRecordingSeconds(0);
      setUnregisteredMachine(null);
      setStatusMessage({
        type: "recording",
        text: "Recording in progress... Speak clearly about the maintenance issue.",
      });

      timerIntervalRef.current = setInterval(() => {
        setRecordingSeconds((prev) => prev + 1);
      }, 1000);
    } catch (err) {
      console.error("Microphone access error:", err);
      setStatusMessage({
        type: "error",
        text: "Microphone permission was denied or not found.",
      });
    }
  };

  // ==========================================
  // STOP RECORDING
  // ==========================================
  const stopRecording = () => {
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
    }

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }

    setIsRecording(false);
  };

  // ==========================================
  // FULL VOICE PIPELINE:
  // Whisper -> Clean Text -> Machine Detection -> Validation -> Auto Request if Unregistered
  // ==========================================
  const processVoicePipeline = async (audioBlob) => {
    setIsTranscribing(true);
    setStatusMessage({
      type: "info",
      text: "Step 1/3: OpenAI Whisper is transcribing speech...",
    });

    try {
      // 1. WHISPER SPEECH-TO-TEXT & TRANSLATION
      const formData = new FormData();
      formData.append("audio", audioBlob, "maintenance_voice.webm");
      if (language && language !== "auto") {
        formData.append("language", language);
      }

      const whisperResponse = await fetch(`${ML_BASE_URL}/transcribe`, {
        method: "POST",
        body: formData,
      });

      if (!whisperResponse.ok) {
        const errorData = await whisperResponse.json().catch(() => ({}));
        throw new Error(
          errorData.detail || "Whisper service failed to process audio."
        );
      }

      const whisperResult = await whisperResponse.json();
      console.log("Whisper result:", whisperResult);

      const rawNative = whisperResult.transcription || "";
      const rawEnglish =
        whisperResult.english_translation || whisperResult.transcription || "";

      setNativeTranscript(rawNative);
      setRawEnglishTranslation(rawEnglish);
      setDetectedLanguage(whisperResult.language || "");

      setIsTranscribing(false);

      if (!rawEnglish.trim()) {
        setStatusMessage({
          type: "warning",
          text: "No clear speech was detected. Please try recording again.",
        });
        return;
      }

      // 2. CLEAN & PROFESSIONALIZE WITH GEMINI (/clean-report)
      setIsCleaning(true);
      setStatusMessage({
        type: "info",
        text: "Step 2/3: Cleaning & professionalizing text with Gemini AI...",
      });

      const cleanResponse = await fetch(`${API_BASE_URL}/clean-report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: rawEnglish }),
      });

      const cleanResult = await cleanResponse.json();
      if (!cleanResponse.ok) {
        throw new Error(cleanResult.message || "Failed to professionalize report.");
      }

      console.log("Cleaned report result:", cleanResult);
      const cleanedText = cleanResult.cleaned_report || rawEnglish;
      setCleanedReport(cleanedText);

      // 3. DETECT & VALIDATE MACHINE
      const detectedRef = (cleanResult.detected_machine || "").trim();
      setDetectedMachineRef(detectedRef);

      if (detectedRef) {
        setStatusMessage({
          type: "info",
          text: `Step 3/3: Validating detected machine '${detectedRef}' against factory registry...`,
        });

        const validateResponse = await fetch(
          `${API_BASE_URL}/validate-machine`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ machine_reference: detectedRef }),
          }
        );

        const validateResult = await validateResponse.json();
        console.log("Machine validation result:", validateResult);

        if (validateResult.exists && validateResult.machine) {
          // ==========================================
          // CASE 1: MACHINE ALREADY EXISTS
          // ==========================================
          setMachine(String(validateResult.machine.machine_id));
          setUnregisteredMachine(null);
          setStatusMessage({
            type: "success",
            text: `Report ready! Machine detected & matched: ${validateResult.machine.machine_code} (${validateResult.machine.machine_name}).`,
          });
        } else {
          // ==========================================
          // CASE 2: MACHINE DOES NOT EXIST
          // Create pending request for Head Officer confirmation
          // ==========================================
          setStatusMessage({
            type: "info",
            text: `Machine '${detectedRef}' is not registered. Sending details to Head Officer for confirmation...`,
          });

          const currentUserId =
            localStorage.getItem("userId") ||
            localStorage.getItem("userName") ||
            "engineer1";

          try {
            const pendingRes = await fetch(`${API_BASE_URL}/pending-machines`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                report_text: cleanedText,
                machine_code: detectedRef,
                requested_by: currentUserId,
                draft_report: {
                  original_text: rawNative.trim() || rawEnglish.trim(),
                  source_language: language,
                  translated_report: rawEnglish.trim(),
                  cleaned_report: cleanedText,
                  engineer_id: currentUserId,
                },
              }),
            });

            const pendingData = await pendingRes.json();
            console.log("Pending machine request response:", pendingData);
          } catch (reqErr) {
            console.error("Failed to post pending machine request:", reqErr);
          }

          setUnregisteredMachine(detectedRef);
          setMachine(""); // Deselect machine to block finalizing report
          setStatusMessage({
            type: "warning",
            text: `Machine '${detectedRef}' is not currently registered in the system. The machine details have been sent to the Head Officer for confirmation. Please wait until the machine is approved.`,
          });
        }
      } else {
        setStatusMessage({
          type: "success",
          text: "Report professionalized! Please verify or select the machine before submitting.",
        });
      }
    } catch (err) {
      console.error("Voice pipeline error:", err);
      const isNetworkError =
        err.name === "TypeError" ||
        err.message?.toLowerCase().includes("failed to fetch");

      setStatusMessage({
        type: "error",
        text: isNetworkError
          ? "ML Service or Backend is unreachable. Please verify both services are running."
          : err.message || "Failed to complete voice report pipeline.",
      });
    } finally {
      setIsTranscribing(false);
      setIsCleaning(false);
    }
  };

  // ==========================================
  // ANALYZE REPORT WITH GEMINI (/analyze-report)
  // ==========================================
  const analyzeReport = async (text) => {
    const response = await fetch(`${API_BASE_URL}/analyze-report`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ report: text.trim() }),
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
        text: "Please select a registered machine from the list before submitting.",
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
      const analysis = await analyzeReport(finalReportText);

      // Step 2: Session Engineer ID
      const engineerId =
        localStorage.getItem("userId") ||
        localStorage.getItem("userName") ||
        "engineer1";

      const machineIdNumber = Number(machine);
      const selectedMachine = machines.find(
        (item) => Number(item.machine_id) === machineIdNumber
      );

      // Step 3: Complete Payload with all audit fields
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

        // Gemini structured findings
        problem: analysis?.problem || "",
        solution: analysis?.solution || "",
        maintenance_status: analysis?.maintenance_status || "Completed",
        maintenance_time: analysis?.maintenance_time || "",
        source_language: language,
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

  return (
    <DashboardLayout>
      <div className="voice-report">
        {/* =====================================
            HEADER
        ====================================== */}
        <div className="voice-report-header">
          <div>
            <h1>New Voice Maintenance Report</h1>
            <p>
              Automated end-to-end flow: Regional Speech &rarr; Whisper STT
              &rarr; Gemini Text Professionalization &rarr; Auto
              Machine Detection &rarr; Firestore Recording.
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
            <span>{statusMessage.text}</span>
          </div>
        )}

        {/* =====================================
            MACHINE NOT REGISTERED WARNING BANNER
            (Informational notice instructing engineer to wait for Head Officer approval)
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
                disabled={isRecording || isSubmitting}
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
                disabled={isRecording || isSubmitting}
              >
                <option value="ta-IN">Tamil (தமிழ்)</option>
                <option value="hi-IN">Hindi (हिन्दी)</option>
                <option value="te-IN">Telugu (తెలుగు)</option>
                <option value="en-US">English</option>
                <option value="auto">Auto-Detect Language</option>
              </select>
            </div>
          </div>
        </div>

        {/* =====================================
            STEP 2: AUDIO RECORDING
        ====================================== */}
        <div className="report-card voice-card">
          <div className="card-header">
            <Mic size={22} className="card-header-icon" />
            <h2>Voice Recording (Whisper AI)</h2>
          </div>

          <div className="record-container">
            {/* RECORDING VISUALIZER & TIMER */}
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
                  ? "Listening to your maintenance report..."
                  : isTranscribing
                  ? "Whisper is transcribing & translating..."
                  : isCleaning
                  ? "Gemini is cleaning and professionalizing text..."
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
                  disabled={isTranscribing || isCleaning || isSubmitting}
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
                  <span>Stop & Process</span>
                </button>
              )}
            </div>

            {/* AUDIO PLAYBACK PREVIEW */}
            {audioUrl && (
              <div className="audio-preview-container">
                <div className="audio-preview-label">
                  <Volume2 size={16} />
                  <span>Recorded Voice Preview</span>
                </div>
                <audio src={audioUrl} controls className="audio-player" />
              </div>
            )}
          </div>
        </div>

        {/* =====================================
            STEP 3: TRANSCRIPTION & CLEANED REPORT
        ====================================== */}
        <div className="report-card results-card">
          <div className="card-header space-between">
            <div className="card-header-left">
              <Sparkles size={22} className="card-header-icon" />
              <h2>Report Review & Submission</h2>
            </div>
            {detectedMachineRef && (
              <div className="machine-detected-tag">
                <Tag size={14} />
                <span>Detected: {detectedMachineRef}</span>
              </div>
            )}
          </div>

          {/* DUAL DISPLAY: RAW WHISPER VS CLEANED REPORT */}
          <div className="review-grid">
            {/* RAW SPOKEN TRANSCRIPT */}
            <div className="review-box">
              <div className="box-title">
                <span>Original Speech ({detectedLanguage || language})</span>
                <span className="badge-pill">Whisper Raw</span>
              </div>
              <textarea
                value={nativeTranscript}
                onChange={(e) => setNativeTranscript(e.target.value)}
                placeholder="Raw spoken words in your selected language will appear here..."
                rows="6"
              />
            </div>

            {/* CLEANED PROFESSIONAL REPORT */}
            <div className="review-box">
              <div className="box-title">
                <span>Cleaned Professional Report *</span>
                <span className="badge-pill badge-primary">Gemini Cleaned</span>
              </div>
              <textarea
                value={cleanedReport}
                onChange={(e) => setCleanedReport(e.target.value)}
                placeholder="Cleaned, professional report without speech hesitations will appear here. You can review and make edits..."
                rows="6"
              />
            </div>
          </div>

          {/* SUBMIT BUTTON */}
          <div className="submit-action-row">
            <button
              type="button"
              className="submit-btn"
              onClick={handleSubmit}
              disabled={
                isRecording ||
                isTranscribing ||
                isCleaning ||
                isSubmitting ||
                Boolean(unregisteredMachine)
              }
              title={
                unregisteredMachine
                  ? "Report cannot be submitted until machine is confirmed and approved by Head Officer"
                  : "Submit Maintenance Report"
              }
            >
              {isSubmitting ? (
                <>
                  <RefreshCw size={20} className="spin-icon" />
                  <span>Analyzing & Saving to Cloud...</span>
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
      </div>
    </DashboardLayout>
  );
}

export default VoiceReport;