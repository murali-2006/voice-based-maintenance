import { useEffect, useState, useRef } from "react";
import {
  PlusCircle,
  X,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  Mic,
  Search,
  Loader2,
  FileText,
  Square,
} from "lucide-react";
import OfficerSidebar from "../../components/OfficerSidebar";
import "./MachineAnalysis.css";
import { API_BASE_URL, ML_BASE_URL } from "../../config/api";

function MachineAnalysis() {
  const [machines, setMachines] = useState([]);
  const [reports, setReports] = useState([]);
  const [selectedMachine, setSelectedMachine] =
    useState("");
  const [analysis, setAnalysis] = useState({});
  const [loading, setLoading] = useState(true);
  const [analyzingMachine, setAnalyzingMachine] =
    useState(null);

  // Machine Registration Modal State
  const [showAddModal, setShowAddModal] = useState(false);
  const [machineIdInput, setMachineIdInput] = useState("");
  const [machineCodeInput, setMachineCodeInput] = useState("");
  const [machineNameInput, setMachineNameInput] = useState("");
  const [isSubmittingMachine, setIsSubmittingMachine] = useState(false);
  const [formError, setFormError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  // ======================================================
  // NATURAL LANGUAGE MAINTENANCE RECORD SEARCH STATE
  // ======================================================
  const [searchQuery, setSearchQuery] = useState("");
  const [voiceLanguage, setVoiceLanguage] = useState("en-US");
  const [searchState, setSearchState] = useState("idle"); // "idle" | "recording" | "processing" | "searching" | "results"
  const [searchFeedback, setSearchFeedback] = useState(null); // { type: "error" | "warning" | "info", message: string }
  const [searchResults, setSearchResults] = useState([]);
  const [searchStructuredQuery, setSearchStructuredQuery] = useState(null);
  const [viewingReport, setViewingReport] = useState(null);

  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const recordingStreamRef = useRef(null);
  const recognitionRef = useRef(null);
  const isListeningRef = useRef(false);
  const userRequestedStopRef = useRef(false);
  const accumulatedTranscriptRef = useRef("");
  const sessionFinalTranscriptRef = useRef("");
  const restartTimerRef = useRef(null);

  useEffect(() => {
    return () => {
      userRequestedStopRef.current = true;
      isListeningRef.current = false;
      if (restartTimerRef.current) {
        clearTimeout(restartTimerRef.current);
      }
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch (e) {}
      }
      if (recordingStreamRef.current) {
        recordingStreamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  // ======================================================
  // LOAD MACHINES + REPORTS
  // ======================================================

  useEffect(() => {
    const loadData = async () => {
      try {
        const [
          machinesResponse,
          reportsResponse,
        ] = await Promise.all([
          fetch(`${API_BASE_URL}/machines`),
          fetch(`${API_BASE_URL}/reports`),
        ]);

        if (
          !machinesResponse.ok ||
          !reportsResponse.ok
        ) {
          throw new Error(
            "Failed to load machine data"
          );
        }

        const machinesData =
          await machinesResponse.json();

        const reportsData =
          await reportsResponse.json();

        setMachines(machinesData);
        setReports(reportsData);
      } catch (error) {
        console.error(
          "Error loading machine analysis data:",
          error
        );
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, []);

  // ======================================================
  // GET REPORTS OF ONE MACHINE
  // ======================================================

  const getMachineReports = (machineId) => {
    return reports.filter(
      (report) =>
        String(report.machine_id) ===
        String(machineId)
    );
  };

  // ======================================================
  // GET REPEATED PROBLEMS
  // ======================================================

  const getRepeatedProblems = (machineId) => {
    const machineReports =
      getMachineReports(machineId);

    const problemCounts = {};

    machineReports.forEach((report) => {
      if (
        report.problem &&
        report.problem.trim() !== ""
      ) {
        const problem =
          report.problem.trim();

        problemCounts[problem] =
          (problemCounts[problem] || 0) + 1;
      }
    });

    return Object.entries(problemCounts)
      .filter(([, count]) => count > 1)
      .map(([problem, count]) => ({
        problem,
        count,
      }));
  };

  // ======================================================
  // ANALYZE MACHINE
  // ======================================================

  const handleAnalyzeMachine = async (machine) => {
    try {
      setAnalyzingMachine(
        machine.machine_id
      );

      const machineReports =
        getMachineReports(
          machine.machine_id
        );

      const response = await fetch(
        `${API_BASE_URL}/analyze-machine`,
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json",
          },

          body: JSON.stringify({
            machine_id:
              machine.machine_id,

            reports:
              machineReports,
          }),
        }
      );

      const data =
        await response.json();

      if (!response.ok) {
        throw new Error(
          data.message ||
            "Machine analysis failed"
        );
      }

      console.log(
        "Machine analysis response:",
        data
      );

      // IMPORTANT:
      // Backend returns:
      //
      // {
      //   success,
      //   machine_id,
      //   total_reports,
      //   latest_report,
      //   analysis: {
      //      summary,
      //      repeated_problems,
      //      latest_status,
      //      maintenance_pattern,
      //      attention_required
      //   }
      // }
      //
      // So only data.analysis is stored.

      setAnalysis((previous) => ({
        ...previous,

        [machine.machine_id]:
          data.analysis || {},
      }));
    } catch (error) {
      console.error(
        "Machine analysis error:",
        error
      );

      alert(
        error.message ||
          "Failed to analyze machine"
      );
    } finally {
      setAnalyzingMachine(null);
    }
  };

  // ======================================================
  // REGISTER NEW MACHINE (OFFICER ACTION)
  // ======================================================

  const handleRegisterMachine = async (e) => {
    if (e) e.preventDefault();

    if (!machineCodeInput.trim()) {
      setFormError("Machine Code is required.");
      return;
    }
    if (!machineNameInput.trim()) {
      setFormError("Machine Name is required.");
      return;
    }

    try {
      setIsSubmittingMachine(true);
      setFormError("");

      const userRole = localStorage.getItem("userRole") || "OFFICER";
      const userId = localStorage.getItem("userId") || "";

      const payload = {
        machine_code: machineCodeInput.trim(),
        machine_name: machineNameInput.trim(),
        role: userRole,
      };

      if (machineIdInput.trim()) {
        payload.machine_id = Number(machineIdInput.trim());
      }

      const response = await fetch(`${API_BASE_URL}/machines`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-user-role": userRole,
          "x-user-id": userId,
        },
        body: JSON.stringify(payload),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || "Failed to register machine.");
      }

      // Re-fetch machines from Firestore
      const machinesRes = await fetch(`${API_BASE_URL}/machines`);
      const updatedMachines = await machinesRes.json();
      setMachines(updatedMachines);

      // Auto-select the newly added machine
      setSelectedMachine(String(data.machine.machine_id));

      // Reset form & close modal
      setShowAddModal(false);
      setMachineIdInput("");
      setMachineCodeInput("");
      setMachineNameInput("");
      setSuccessMessage(
        `Machine '${data.machine.machine_code} - ${data.machine.machine_name}' successfully registered!`
      );
    } catch (err) {
      console.error("Error registering machine:", err);
      setFormError(err.message || "Failed to save machine.");
    } finally {
      setIsSubmittingMachine(false);
    }
  };

  // ======================================================
  // SELECTED / VISIBLE MACHINES
  // ======================================================

  const visibleMachines =
    selectedMachine
      ? machines.filter(
          (machine) =>
            String(
              machine.machine_id
            ) ===
            String(selectedMachine)
        )
      : machines;

  // ======================================================
  // SELECTED MACHINE OBJECT
  // ======================================================

  const selectedMachineData =
    machines.find(
      (machine) =>
        String(machine.machine_id) ===
        String(selectedMachine)
    );

  // ======================================================
  // SELECTED MACHINE REPORTS
  // ======================================================

  const selectedMachineReports =
    selectedMachine
      ? getMachineReports(
          selectedMachine
        )
      : [];

  // ======================================================
  // REPEATED FAULT MACHINE COUNT
  // ======================================================

  const repeatedFaultMachines =
    visibleMachines.filter(
      (machine) =>
        getRepeatedProblems(
          machine.machine_id
        ).length > 0
    ).length;

  // ======================================================
  // LOADING SCREEN
  // ======================================================

  if (loading) {
    return (
      <div className="machine-analysis-layout">

        <OfficerSidebar />

        <main className="machine-analysis-main">

          <div className="machine-analysis-page">

            <div className="machine-analysis-loading">
              Loading Machine Analysis...
            </div>

          </div>

        </main>

      </div>
    );
  }

  // ======================================================
  // NATURAL LANGUAGE SEARCH HANDLERS
  // ======================================================
  const formatResultDate = (dateVal) => {
    if (!dateVal) return "Date not available";
    try {
      const d = new Date(dateVal);
      if (isNaN(d.getTime())) return "Date not available";
      const day = d.getDate();
      const months = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun",
        "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
      ];
      return `${day} ${months[d.getMonth()]} ${d.getFullYear()}`;
    } catch {
      return "Date not available";
    }
  };

  const handleOpenFullReport = (record) => {
    if (!record) {
      setSearchFeedback({
        type: "error",
        message: "Unable to load the selected maintenance report.",
      });
      return;
    }

    const reportData = record.full_report || record;
    if (
      !reportData ||
      (!reportData.id &&
        !reportData.problem &&
        !reportData.report &&
        !reportData.cleaned_report)
    ) {
      setSearchFeedback({
        type: "error",
        message: "Unable to load the selected maintenance report.",
      });
      return;
    }

    setViewingReport(reportData);
  };

  const executeSearch = async (queryText) => {
    const trimmed = (queryText || "").trim();
    if (!trimmed) {
      setSearchResults([]);
      setSearchStructuredQuery(null);
      setSearchFeedback({
        type: "warning",
        message: "Enter or speak a maintenance query.",
      });
      return;
    }

    setSearchState("searching");
    setSearchFeedback(null);
    setSearchResults([]);
    setSearchStructuredQuery(null);

    try {
      const res = await fetch(`${API_BASE_URL}/search-maintenance-records`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: trimmed }),
      });

      const data = await res.json().catch(() => ({}));

      setSearchState("results");
      setSearchStructuredQuery(data.structured_query || null);

      if (!res.ok || !data.success) {
        setSearchResults([]);
        setSearchFeedback({
          type: "error",
          message: data.message || "Failed to complete search.",
        });
        return;
      }

      if (data.is_ambiguous || data.needs_clarification) {
        setSearchResults([]);
        setSearchFeedback({
          type: "warning",
          message:
            data.clarification_message ||
            data.message ||
            "Please specify the machine or sensor name.",
        });
        return;
      }

      if (!data.results || data.results.length === 0) {
        setSearchResults([]);
        setSearchFeedback({
          type: "info",
          message:
            data.message ||
            "No matching maintenance record was found for the requested details.",
        });
        return;
      }

      setSearchResults(data.results);
    } catch (err) {
      console.error("Maintenance search execution error:", err);
      setSearchState("results");
      setSearchResults([]);
      setSearchStructuredQuery(null);
      setSearchFeedback({
        type: "error",
        message: "Unable to connect to search service. Please verify backend server.",
      });
    }
  };

  const handleTextSearch = (e) => {
    if (e) e.preventDefault();
    executeSearch(searchQuery);
  };

  const initAndStartWebSpeech = () => {
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return false;

    try {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch (e) {
          console.warn("Could not abort existing recognition:", e);
        }
        recognitionRef.current = null;
      }

      const recognition = new SpeechRecognition();
      recognitionRef.current = recognition;

      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;
      recognition.lang = voiceLanguage || "en-US";

      recognition.onstart = () => {
        console.log("[WebSpeech] Continuous listening started. Lang:", recognition.lang);
        setSearchState("recording");
        setSearchFeedback(null);
      };

      recognition.onresult = (event) => {
        console.log("[WebSpeech] Recognition onresult:", event);
        if (event.results && event.results.length > 0) {
          let sessionFinal = "";
          let sessionInterim = "";

          for (let i = 0; i < event.results.length; i++) {
            const res = event.results[i];
            const text = res[0]?.transcript || "";
            if (res.isFinal) {
              sessionFinal += (sessionFinal ? " " : "") + text.trim();
            } else {
              sessionInterim += (sessionInterim ? " " : "") + text.trim();
            }
          }

          sessionFinalTranscriptRef.current = sessionFinal;

          const base = accumulatedTranscriptRef.current.trim();
          let currentDisplay = base;
          if (sessionFinal.trim()) {
            currentDisplay = base
              ? `${base} ${sessionFinal.trim()}`
              : sessionFinal.trim();
          }
          if (sessionInterim.trim()) {
            currentDisplay = currentDisplay
              ? `${currentDisplay} ${sessionInterim.trim()}`
              : sessionInterim.trim();
          }

          console.log("[WebSpeech] Live transcript display:", currentDisplay);
          setSearchQuery(currentDisplay);
        }
      };

      recognition.onerror = (event) => {
        console.warn("[WebSpeech] onerror event:", event.error);
        // Short pauses or silence trigger 'no-speech'; do not stop listening
        if (event.error === "no-speech" || event.error === "aborted") {
          return;
        }

        // Unrecoverable errors (permission denied, hardware missing)
        if (
          event.error === "not-allowed" ||
          event.error === "service-not-allowed" ||
          event.error === "audio-capture"
        ) {
          userRequestedStopRef.current = true;
          isListeningRef.current = false;
          setSearchState("idle");
          setSearchResults([]);
          setSearchStructuredQuery(null);

          let errorMsg = "Unable to convert the voice query to text.";
          if (
            event.error === "not-allowed" ||
            event.error === "service-not-allowed"
          ) {
            errorMsg =
              "Microphone permission denied. Please allow microphone access in your browser.";
          } else if (event.error === "audio-capture") {
            errorMsg = "No microphone found or audio capture failed.";
          }

          setSearchFeedback({
            type: "error",
            message: errorMsg,
          });
        }
      };

      recognition.onend = () => {
        console.log(
          "[WebSpeech] onend fired. userRequestedStop:",
          userRequestedStopRef.current,
          "isListening:",
          isListeningRef.current
        );

        // Commit any finalized speech from this session into persistent accumulator
        if (sessionFinalTranscriptRef.current.trim()) {
          const base = accumulatedTranscriptRef.current.trim();
          const add = sessionFinalTranscriptRef.current.trim();
          accumulatedTranscriptRef.current = base ? `${base} ${add}` : add;
          sessionFinalTranscriptRef.current = "";
        }

        // If user did NOT explicitly stop and is still in listening mode:
        // Automatically restart speech recognition so silence never cuts off voice search
        if (isListeningRef.current && !userRequestedStopRef.current) {
          console.log("[WebSpeech] Browser auto-ended; restarting recognition immediately...");
          if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
          restartTimerRef.current = setTimeout(() => {
            if (isListeningRef.current && !userRequestedStopRef.current) {
              try {
                recognition.start();
              } catch (e) {
                console.warn("[WebSpeech] Restart error, re-initializing:", e);
                initAndStartWebSpeech();
              }
            }
          }, 150);
        }
      };

      recognition.start();
      return true;
    } catch (err) {
      console.warn("[WebSpeech] SpeechRecognition start failed:", err);
      return false;
    }
  };

  const startVoiceSearch = async () => {
    // Reset state before every new voice search
    setSearchFeedback(null);
    setSearchResults([]);
    setSearchStructuredQuery(null);
    accumulatedTranscriptRef.current = "";
    sessionFinalTranscriptRef.current = "";
    userRequestedStopRef.current = false;
    isListeningRef.current = true;

    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current);
    }

    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (SpeechRecognition) {
      const ok = initAndStartWebSpeech();
      if (ok) return;
    }

    // Fallback: MediaRecorder + Whisper API (if Web Speech API unavailable or fails)
    startWhisperVoiceSearch();
  };

  const startWhisperVoiceSearch = async () => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setSearchFeedback({
        type: "error",
        message: "Microphone access is required for voice search.",
      });
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recordingStreamRef.current = stream;
      audioChunksRef.current = [];

      const options = MediaRecorder.isTypeSupported("audio/webm")
        ? { mimeType: "audio/webm" }
        : {};
      const recorder = new MediaRecorder(stream, options);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = async () => {
        if (recordingStreamRef.current) {
          recordingStreamRef.current.getTracks().forEach((track) => track.stop());
          recordingStreamRef.current = null;
        }

        const audioBlob = new Blob(audioChunksRef.current, {
          type: recorder.mimeType || "audio/webm",
        });

        if (audioBlob.size < 100) {
          setSearchState("idle");
          setSearchResults([]);
          setSearchStructuredQuery(null);
          setSearchFeedback({
            type: "error",
            message: "Unable to convert the voice query to text.",
          });
          return;
        }

        setSearchState("processing");

        try {
          const formData = new FormData();
          formData.append("audio", audioBlob, "voice_query.webm");
          formData.append("file", audioBlob, "voice_query.webm");
          formData.append("language", voiceLanguage === "ta-IN" ? "ta" : "en");

          const whisperRes = await fetch(`${ML_BASE_URL}/transcribe`, {
            method: "POST",
            body: formData,
          });

          if (!whisperRes.ok) {
            throw new Error("Unable to convert the voice query to text.");
          }

          const whisperData = await whisperRes.json().catch(() => ({}));
          const spokenText = (
            whisperData.english_text ||
            whisperData.transcription ||
            whisperData.native_text ||
            ""
          ).trim();

          if (!spokenText) {
            throw new Error("Unable to convert the voice query to text.");
          }

          setSearchQuery(spokenText);
          executeSearch(spokenText);
        } catch (err) {
          console.error("Voice search transcription error:", err);
          setSearchState("idle");
          setSearchResults([]);
          setSearchStructuredQuery(null);
          setSearchFeedback({
            type: "error",
            message: "Unable to convert the voice query to text.",
          });
        }
      };

      recorder.start();
      setSearchState("recording");
    } catch (err) {
      console.error("Mic access error:", err);
      setSearchState("idle");
      setSearchResults([]);
      setSearchStructuredQuery(null);
      setSearchFeedback({
        type: "error",
        message: "Microphone access is required for voice search.",
      });
    }
  };

  const stopVoiceSearch = () => {
    userRequestedStopRef.current = true;
    isListeningRef.current = false;

    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current);
    }

    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch (e) {
        console.warn("Error stopping Web Speech recognition:", e);
      }
    }

    // Consolidate any remaining finalized text from current session
    if (sessionFinalTranscriptRef.current.trim()) {
      const base = accumulatedTranscriptRef.current.trim();
      const add = sessionFinalTranscriptRef.current.trim();
      accumulatedTranscriptRef.current = base ? `${base} ${add}` : add;
      sessionFinalTranscriptRef.current = "";
    }

    // Determine final transcript from accumulated or live input
    const finalTranscript = (
      accumulatedTranscriptRef.current ||
      searchQuery ||
      ""
    ).trim();

    if (finalTranscript) {
      setSearchQuery(finalTranscript);
      setSearchFeedback(null);
      setSearchState("searching");
      executeSearch(finalTranscript);
    } else {
      setSearchState("idle");
      setSearchFeedback({
        type: "error",
        message: "No speech detected. Please speak clearly into your microphone.",
      });
    }

    if (
      mediaRecorderRef.current &&
      mediaRecorderRef.current.state === "recording"
    ) {
      mediaRecorderRef.current.stop();
    }
  };

  const handleClearSearch = () => {
    setSearchQuery("");
    setSearchResults([]);
    setSearchFeedback(null);
    setSearchState("idle");
    setSearchStructuredQuery(null);
  };

  // ======================================================
  // MAIN PAGE
  // ======================================================

  return (
    <div className="machine-analysis-layout">

      {/* ==================================================
          SIDEBAR
          ================================================== */}

      <OfficerSidebar />

      {/* ==================================================
          MAIN
          ================================================== */}

      <main className="machine-analysis-main">

        <div className="machine-analysis-page">

          {/* =================================================
              HEADER
              ================================================= */}

          <div className="machine-analysis-header">
            <div>
              <h1>Machine Analysis</h1>
              <p>Analyze machine maintenance history and repeated problems</p>
            </div>
            <button
              type="button"
              className="btn-register-machine"
              onClick={() => {
                const nextId =
                  machines.reduce((max, m) => {
                    const id = Number(m.machine_id);
                    return !isNaN(id) && id > max ? id : max;
                  }, 0) + 1;
                setMachineIdInput(String(nextId));
                setMachineCodeInput("");
                setMachineNameInput("");
                setFormError("");
                setShowAddModal(true);
              }}
            >
              <PlusCircle size={18} />
              <span>Register New Machine</span>
            </button>
          </div>

          {/* SUCCESS MESSAGE BANNER */}
          {successMessage && (
            <div className="officer-success-banner">
              <div className="success-banner-content">
                <CheckCircle2 size={20} className="success-banner-icon" />
                <span>{successMessage}</span>
              </div>
              <button
                type="button"
                className="banner-close-btn"
                onClick={() => setSuccessMessage("")}
                title="Dismiss"
              >
                <X size={16} />
              </button>
            </div>
          )}

          {/* =================================================
              MACHINE SELECTOR
              ================================================= */}

          <div className="machine-selector-card">

            <div className="selector-content">

              <div className="selector-label-area">

                <label htmlFor="machine-select">
                  Select Machine
                </label>

                <span>
                  View maintenance history for
                  a specific machine
                </span>

              </div>

              <select
                id="machine-select"
                value={selectedMachine}
                onChange={(event) => {
                  setSelectedMachine(
                    event.target.value
                  );
                }}
              >

                <option value="">
                  All Machines
                </option>

                {machines.map(
                  (machine) => (
                    <option
                      key={
                        machine.machine_id
                      }
                      value={
                        machine.machine_id
                      }
                    >
                      {
                        machine.machine_code
                      }{" "}
                      -{" "}
                      {
                        machine.machine_name
                      }
                    </option>
                  )
                )}

              </select>

            </div>

          </div>

          {/* =================================================
              NATURAL LANGUAGE MAINTENANCE RECORD SEARCH
              ================================================= */}
          <section className="nl-search-section">
            <div className="nl-search-header">
              <div className="nl-search-title-wrap">
                <h2 className="nl-search-title">Maintenance Record Search</h2>
                <span className="nl-search-subtitle">
                  Search maintenance records using natural language or voice (English / Tamil)
                </span>
              </div>
              {(searchResults.length > 0 || searchQuery || searchFeedback) && (
                <button
                  type="button"
                  className="nl-btn-clear"
                  onClick={handleClearSearch}
                >
                  Clear Search
                </button>
              )}
            </div>

            <form className="nl-search-form" onSubmit={handleTextSearch}>
              <div className="nl-search-input-wrap">
                <input
                  type="text"
                  className="nl-search-input"
                  placeholder="Ask about maintenance history... (e.g. 'Show me the CNC-001 bearing replacement with date')"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  disabled={searchState === "recording" || searchState === "processing"}
                />
                {searchQuery && (
                  <button
                    type="button"
                    className="nl-input-clear-btn"
                    onClick={() => setSearchQuery("")}
                    title="Clear input"
                  >
                    <X size={16} />
                  </button>
                )}
              </div>

              <div className="nl-search-actions">
                <select
                  className="nl-lang-select"
                  value={voiceLanguage}
                  onChange={(e) => setVoiceLanguage(e.target.value)}
                  title="Select voice recognition language (English / Tamil)"
                  disabled={searchState === "recording" || searchState === "processing" || searchState === "searching"}
                >
                  <option value="en-US">English (en-US)</option>
                  <option value="ta-IN">Tamil (ta-IN)</option>
                </select>

                {searchState === "recording" ? (
                  <button
                    type="button"
                    className="nl-btn-voice recording"
                    onClick={stopVoiceSearch}
                    title="Stop listening"
                  >
                    <Square size={16} className="pulse-icon" />
                    <span>Stop Listening</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    className="nl-btn-voice"
                    onClick={startVoiceSearch}
                    disabled={searchState === "processing" || searchState === "searching"}
                    title="Speak your maintenance query"
                  >
                    <Mic size={16} />
                    <span>Speak</span>
                  </button>
                )}

                <button
                  type="submit"
                  className="nl-btn-search"
                  disabled={searchState === "recording" || searchState === "processing" || searchState === "searching"}
                >
                  {searchState === "searching" ? (
                    <>
                      <Loader2 size={16} className="spin-icon" />
                      <span>Searching...</span>
                    </>
                  ) : (
                    <>
                      <Search size={16} />
                      <span>Search</span>
                    </>
                  )}
                </button>
              </div>
            </form>

            {/* Live State Badges */}
            {searchState === "recording" && (
              <div className="nl-status-banner recording">
                <span className="live-indicator-dot"></span>
                <span>
                  Listening ({voiceLanguage === "ta-IN" ? "Tamil" : "English"})... Speak your query now (e.g. "show me cnc machine with oil leakage")
                </span>
              </div>
            )}

            {searchState === "processing" && (
              <div className="nl-status-banner processing">
                <Loader2 size={16} className="spin-icon" />
                <span>Processing voice query with Whisper...</span>
              </div>
            )}

            {searchState === "searching" && (
              <div className="nl-status-banner searching">
                <Loader2 size={16} className="spin-icon" />
                <span>Searching Firestore maintenance records...</span>
              </div>
            )}

            {/* Feedback Messages */}
            {searchFeedback && (
              <div className={`nl-feedback-banner ${searchFeedback.type}`}>
                <AlertCircle size={18} />
                <span>{searchFeedback.message}</span>
              </div>
            )}

            {/* Structured Intent Badge */}
            {searchStructuredQuery && !searchStructuredQuery.needs_clarification && (searchResults.length > 0 || searchStructuredQuery.machine_identifier || (searchStructuredQuery.maintenance_conditions && searchStructuredQuery.maintenance_conditions.length > 0)) && (
              <div className="nl-intent-bar">
                <span className="nl-intent-label">Search parameters:</span>
                {searchStructuredQuery.machine_identifier && (
                  <span className="nl-intent-chip machine">
                    Machine: {searchStructuredQuery.machine_identifier}
                  </span>
                )}
                {searchStructuredQuery.maintenance_conditions?.map((c, i) => (
                  <span className="nl-intent-chip component" key={`mc-${i}`}>
                    Condition: {c}
                  </span>
                ))}
                {!searchStructuredQuery.maintenance_conditions && searchStructuredQuery.components?.map((c, i) => (
                  <span className="nl-intent-chip component" key={`comp-${i}`}>
                    Condition: {c}
                  </span>
                ))}
                {searchStructuredQuery.requested_fields && searchStructuredQuery.requested_fields.filter(f => f !== "matching records").map((f, i) => (
                  <span className="nl-intent-chip action" key={`rf-${i}`}>
                    Field: {f}
                  </span>
                ))}
                {searchStructuredQuery.is_latest_only && (
                  <span className="nl-intent-chip latest">Latest Record Only</span>
                )}
              </div>
            )}

            {/* Results Display */}
            {searchResults.length > 0 && (
              <div className="nl-results-container">
                <div className="nl-results-header">
                  <h3>Search Results</h3>
                  <span className="nl-results-count">
                    {searchResults.length} {searchResults.length === 1 ? "record" : "records"} found
                  </span>
                </div>

                <div className="nl-results-grid">
                  {searchResults.map((record) => (
                    <div className="nl-result-card" key={record.id}>
                      <div className="nl-result-header">
                        <div className="nl-result-machine-group">
                          <span className="nl-meta-label">Machine:</span>
                          <span className="nl-machine-code-badge">{record.machine_code}</span>
                          {record.machine_name && record.machine_name !== "Unknown Machine" && (
                            <span className="nl-machine-name-sub">({record.machine_name})</span>
                          )}
                        </div>
                        <div className="nl-result-date-group">
                          <span className="nl-meta-label">Date:</span>
                          <span className="nl-date-value">{record.date}</span>
                        </div>
                      </div>

                      <div className="nl-result-body">
                        <div className="nl-matched-heading">Matched Maintenance Details:</div>
                        <ul className="nl-matched-list">
                          {record.matched_details && record.matched_details.length > 0 ? (
                            record.matched_details.map((detail, idx) => (
                              <li key={idx} className="nl-matched-item">
                                <span className="bullet-dot">•</span>
                                <span className="detail-text">{detail.display || `${detail.item} — ${detail.action}`}</span>
                              </li>
                            ))
                          ) : (
                            <li className="nl-matched-item">
                              <span className="bullet-dot">•</span>
                              <span className="detail-text">Maintenance record matched query</span>
                            </li>
                          )}
                        </ul>

                        {record.additional_details && Object.keys(record.additional_details).length > 0 && (
                          <div className="nl-extra-details">
                            {record.additional_details.engineer && (
                              <div><strong>Engineer:</strong> {record.additional_details.engineer}</div>
                            )}
                            {record.additional_details.maintenance_status && (
                              <div><strong>Status:</strong> {record.additional_details.maintenance_status}</div>
                            )}
                          </div>
                        )}
                      </div>

                      <div className="nl-result-footer">
                        <button
                          type="button"
                          className="nl-btn-view-report"
                          onClick={() => handleOpenFullReport(record)}
                          id={`view-full-report-${record.id}`}
                        >
                          <FileText size={15} />
                          <span>View Full Report</span>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>

          {/* =================================================
              SUMMARY CARDS
              ================================================= */}

          <div className="machine-summary-grid">

            <div className="machine-summary-card">

              <div className="summary-card-title">
                Total Machines
              </div>

              <div className="summary-card-value">
                {
                  visibleMachines.length
                }
              </div>

            </div>

            <div className="machine-summary-card">

              <div className="summary-card-title">
                Total Reports
              </div>

              <div className="summary-card-value">
                {selectedMachine
                  ? selectedMachineReports.length
                  : reports.length}
              </div>

            </div>

            <div className="machine-summary-card">

              <div className="summary-card-title">
                Repeated Fault Machines
              </div>

              <div className="summary-card-value">
                {
                  repeatedFaultMachines
                }
              </div>

            </div>

          </div>

          {/* =================================================
              MACHINE CARDS
              ================================================= */}

          {visibleMachines.length === 0 ? (

            <div className="no-machines-message">
              No machines found.
            </div>

          ) : (

            <div className="machine-analysis-grid">

              {visibleMachines.map(
                (machine) => {

                  const machineReports =
                    getMachineReports(
                      machine.machine_id
                    );

                  const repeatedProblems =
                    getRepeatedProblems(
                      machine.machine_id
                    );

                  const latestReport =
                    machineReports.length >
                    0
                      ? machineReports[0]
                      : null;

                  const machineAnalysis =
                    analysis[
                      machine.machine_id
                    ];

                  return (
                    <div
                      className="machine-analysis-card"
                      key={
                        machine.machine_id
                      }
                    >

                      {/* =================================
                          MACHINE HEADER
                          ================================= */}

                      <div className="machine-card-header">

                        <div className="machine-card-title">

                          <h2>
                            {
                              machine.machine_name
                            }
                          </h2>

                          <span>
                            {
                              machine.machine_code
                            }
                          </span>

                        </div>

                        <div className="machine-id">
                          ID:{" "}
                          {
                            machine.machine_id
                          }
                        </div>

                      </div>

                      {/* =================================
                          BASIC DETAILS
                          ================================= */}

                      <div className="machine-card-details">

                        <div className="machine-detail-box">

                          <span>
                            Total Reports
                          </span>

                          <strong>
                            {
                              machineReports.length
                            }
                          </strong>

                        </div>

                        <div className="machine-detail-box">

                          <span>
                            Repeated Problems
                          </span>

                          <strong>
                            {
                              repeatedProblems.length
                            }
                          </strong>

                        </div>

                      </div>

                      {/* =================================
                          REPEATED PROBLEMS
                          ================================= */}

                      <div className="machine-section">

                        <div className="section-title">
                          <h3>
                            Repeated Problems
                          </h3>
                        </div>

                        {repeatedProblems.length ===
                        0 ? (

                          <div className="no-data">
                            No repeated problems
                            found
                          </div>

                        ) : (

                          <div className="repeated-problems-list">

                            {repeatedProblems.map(
                              (
                                item,
                                index
                              ) => (

                                <div
                                  className="repeated-problem"
                                  key={index}
                                >

                                  <span>
                                    {
                                      item.problem
                                    }
                                  </span>

                                  <strong>
                                    {
                                      item.count
                                    }{" "}
                                    times
                                  </strong>

                                </div>

                              )
                            )}

                          </div>
                        )}

                      </div>

                      {/* =================================
                          LATEST MAINTENANCE
                          ================================= */}

                      <div className="machine-section">

                        <div className="section-title">
                          <h3>
                            Latest Maintenance
                          </h3>
                        </div>

                        {latestReport ? (

                          <div className="latest-maintenance">

                            <div className="maintenance-row">

                              <span>
                                Problem
                              </span>

                              <strong>
                                {
                                  latestReport.problem ||
                                  "Not available"
                                }
                              </strong>

                            </div>

                            <div className="maintenance-row">

                              <span>
                                Solution
                              </span>

                              <strong>
                                {
                                  latestReport.solution ||
                                  "Not available"
                                }
                              </strong>

                            </div>

                            <div className="maintenance-row">

                              <span>
                                Status
                              </span>

                              <strong
                                className={
                                  latestReport
                                    .maintenance_status
                                    ?.toLowerCase() ===
                                  "completed"
                                    ? "status-completed"
                                    : "status-default"
                                }
                              >
                                {
                                  latestReport
                                    .maintenance_status ||
                                  "Not available"
                                }
                              </strong>

                            </div>

                            <div className="maintenance-row">

                              <span>
                                Time
                              </span>

                              <strong>
                                {
                                  latestReport
                                    .maintenance_time ||
                                  "Not available"
                                }
                              </strong>

                            </div>

                          </div>

                        ) : (

                          <div className="no-data">
                            No maintenance reports
                            available
                          </div>

                        )}

                      </div>

                      {/* =================================
                          ANALYZE BUTTON
                          ================================= */}

                      <button
                        type="button"
                        className="analyze-machine-btn"
                        onClick={() =>
                          handleAnalyzeMachine(
                            machine
                          )
                        }
                        disabled={
                          analyzingMachine ===
                          machine.machine_id
                        }
                      >
                        {analyzingMachine ===
                        machine.machine_id
                          ? "Analyzing..."
                          : "Analyze Machine"}
                      </button>

                      {/* =================================
                          AI ANALYSIS RESULT
                          ================================= */}

                      {machineAnalysis && (

                        <div className="ai-analysis-result">

                          <div className="ai-analysis-header">

                            <h3>
                              AI Machine Analysis
                            </h3>

                          </div>

                          <div className="ai-analysis-content">

                            {/* SUMMARY */}

                            <div className="ai-analysis-item">

                              <span>
                                Summary
                              </span>

                              <p>
                                {
                                  machineAnalysis.summary ||
                                  "No summary available"
                                }
                              </p>

                            </div>

                            {/* LATEST STATUS */}

                            <div className="ai-analysis-item">

                              <span>
                                Latest Status
                              </span>

                              <p>
                                {
                                  machineAnalysis
                                    .latest_status ||
                                  "Not available"
                                }
                              </p>

                            </div>

                            {/* PATTERN */}

                            <div className="ai-analysis-item">

                              <span>
                                Maintenance Pattern
                              </span>

                              <p>
                                {
                                  machineAnalysis
                                    .maintenance_pattern ||
                                  "Not available"
                                }
                              </p>

                            </div>

                            {/* ATTENTION */}

                            <div className="ai-analysis-item">

                              <span>
                                Attention Required
                              </span>

                              <p
                                className={
                                  machineAnalysis
                                    .attention_required
                                    ? "attention-yes"
                                    : "attention-no"
                                }
                              >
                                {
                                  machineAnalysis
                                    .attention_required
                                    ? "Yes"
                                    : "No"
                                }
                              </p>

                            </div>

                            {/* AI REPEATED PROBLEMS */}

                            {Array.isArray(
                              machineAnalysis
                                .repeated_problems
                            ) &&
                              machineAnalysis
                                .repeated_problems
                                .length > 0 && (

                                <div className="ai-repeated-problems">

                                  <h4>
                                    AI Detected
                                    Repeated
                                    Problems
                                  </h4>

                                  {machineAnalysis
                                    .repeated_problems
                                    .map(
                                      (
                                        problem,
                                        index
                                      ) => (

                                        <div
                                          className="ai-repeated-problem"
                                          key={index}
                                        >

                                          <span>
                                            {
                                              problem.problem
                                            }
                                          </span>

                                          <strong>
                                            {
                                              problem.count
                                            }
                                          </strong>

                                        </div>

                                      )
                                    )}

                                </div>
                              )}

                          </div>

                        </div>
                      )}

                    </div>
                  );
                }
              )}

            </div>
          )}

          {/* =================================================
              SELECTED MACHINE REPORTS
              ================================================= */}

          {selectedMachine &&
            selectedMachineData && (

              <div className="selected-machine-reports-section">

                <div className="selected-reports-header">

                  <div>

                    <h2>
                      Maintenance Reports
                    </h2>

                    <p>
                      {
                        selectedMachineData.machine_code
                      }{" "}
                      -{" "}
                      {
                        selectedMachineData.machine_name
                      }
                    </p>

                  </div>

                  <div className="report-count-badge">

                    {
                      selectedMachineReports.length
                    }{" "}
                    Reports

                  </div>

                </div>

                {selectedMachineReports.length ===
                0 ? (

                  <div className="no-selected-reports">
                    No reports found for this
                    machine.
                  </div>

                ) : (

                  <div className="selected-reports-grid">

                    {selectedMachineReports.map(
                      (
                        report,
                        index
                      ) => (

                        <div
                          className="selected-report-card"
                          key={
                            report.id ||
                            index
                          }
                        >

                          <div className="selected-report-top">

                            <span>
                              {report.created_at
                                ? new Date(
                                    report.created_at
                                  ).toLocaleDateString()
                                : "Date unavailable"}
                            </span>

                            <span className="report-status">
                              {
                                report
                                  .maintenance_status ||
                                "Unknown"
                              }
                            </span>

                          </div>

                          <div className="selected-report-content">

                            <div className="report-detail-row">

                              <span>
                                Problem
                              </span>

                              <strong>
                                {
                                  report.problem ||
                                  "Not available"
                                }
                              </strong>

                            </div>

                            <div className="report-detail-row">

                              <span>
                                Solution
                              </span>

                              <strong>
                                {
                                  report.solution ||
                                  "Not available"
                                }
                              </strong>

                            </div>

                            <div className="report-detail-row">

                              <span>
                                Maintenance Time
                              </span>

                              <strong>
                                {
                                  report
                                    .maintenance_time ||
                                  "Not available"
                                }
                              </strong>

                            </div>

                            <div className="report-detail-row">

                              <span>
                                Engineer ID
                              </span>

                              <strong>
                                {
                                  report.engineer_id ||
                                  "Not available"
                                }
                              </strong>

                            </div>

                          </div>

                          <div className="selected-report-full">

                            <h4>
                              Report
                            </h4>

                            <p>
                              {
                                report.report ||
                                report.translated_report ||
                                "No report text available"
                              }
                            </p>

                          </div>

                        </div>
                      )
                    )}

                  </div>
                )}

              </div>
            )}

          {/* =================================================
              REGISTER NEW MACHINE MODAL (HEAD OFFICER ONLY)
              ================================================= */}
          {showAddModal && (
            <div className="modal-backdrop">
              <div className="add-machine-modal">
                <div className="modal-header">
                  <h3>
                    <PlusCircle size={20} className="modal-header-icon" />
                    Register New Machine
                  </h3>
                  <button
                    type="button"
                    className="modal-close-btn"
                    onClick={() => setShowAddModal(false)}
                    disabled={isSubmittingMachine}
                  >
                    <X size={20} />
                  </button>
                </div>

                <form onSubmit={handleRegisterMachine} className="modal-form">
                  {formError && (
                    <div className="modal-error-alert">
                      <AlertCircle size={16} />
                      <span>{formError}</span>
                    </div>
                  )}

                  <div className="modal-form-group">
                    <label htmlFor="modal-machine-id">Machine ID</label>
                    <input
                      id="modal-machine-id"
                      type="number"
                      value={machineIdInput}
                      onChange={(e) => setMachineIdInput(e.target.value)}
                      placeholder="e.g. 4"
                    />
                    <small className="modal-help-text">
                      Numeric ID assigned by the system (can be customized if required).
                    </small>
                  </div>

                  <div className="modal-form-group">
                    <label htmlFor="modal-machine-code">
                      Machine Code / Identifier *
                    </label>
                    <input
                      id="modal-machine-code"
                      type="text"
                      value={machineCodeInput}
                      onChange={(e) => setMachineCodeInput(e.target.value)}
                      placeholder="e.g. CMP-004, CNC-001, HYD-002"
                      required
                    />
                    <small className="modal-help-text">
                      Equipment reference spoken by engineers in voice reports.
                    </small>
                  </div>

                  <div className="modal-form-group">
                    <label htmlFor="modal-machine-name">Machine Name *</label>
                    <input
                      id="modal-machine-name"
                      type="text"
                      value={machineNameInput}
                      onChange={(e) => setMachineNameInput(e.target.value)}
                      placeholder="e.g. Industrial Air Compressor, CNC Milling Machine"
                      required
                    />
                  </div>

                  <div className="modal-actions-row">
                    <button
                      type="button"
                      className="btn-modal-cancel"
                      onClick={() => setShowAddModal(false)}
                      disabled={isSubmittingMachine}
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="btn-modal-save"
                      disabled={isSubmittingMachine}
                    >
                      {isSubmittingMachine ? (
                        <>
                          <RefreshCw size={16} className="spin-icon" />
                          <span>Saving Machine...</span>
                        </>
                      ) : (
                        <span>Save Machine</span>
                      )}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {/* =================================================
              READ-ONLY FULL MAINTENANCE REPORT MODAL
              ================================================= */}
          {viewingReport && (
            <div
              className="modal-backdrop nl-modal-backdrop"
              onClick={() => setViewingReport(null)}
            >
              <div
                className="nl-report-modal-content"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="modal-header">
                  <div>
                    <h3>
                      <FileText size={18} className="modal-header-icon" />
                      Maintenance Report Details
                    </h3>
                    <span className="modal-subtitle">
                      {viewingReport.machine_code}{" "}
                      {viewingReport.machine_name &&
                      viewingReport.machine_name !== "Unknown Machine"
                        ? `— ${viewingReport.machine_name}`
                        : ""}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="modal-close-btn"
                    onClick={() => setViewingReport(null)}
                    title="Close report details"
                  >
                    <X size={20} />
                  </button>
                </div>

                <div className="nl-modal-body">
                  <div className="nl-modal-meta-grid">
                    <div className="meta-box">
                      <span className="meta-label">Machine Code</span>
                      <strong className="meta-val">
                        {viewingReport.machine_code || "N/A"}
                      </strong>
                    </div>
                    <div className="meta-box">
                      <span className="meta-label">Machine Name</span>
                      <strong className="meta-val">
                        {viewingReport.machine_name || "Unknown Machine"}
                      </strong>
                    </div>
                    <div className="meta-box">
                      <span className="meta-label">Engineer ID</span>
                      <strong className="meta-val">
                        {viewingReport.engineer_id || "N/A"}
                      </strong>
                    </div>
                    <div className="meta-box">
                      <span className="meta-label">Date Recorded</span>
                      <strong className="meta-val">
                        {formatResultDate(
                          viewingReport.created_at || viewingReport.maintenance_time
                        )}
                      </strong>
                    </div>
                    <div className="meta-box">
                      <span className="meta-label">Maintenance Time</span>
                      <strong className="meta-val">
                        {viewingReport.maintenance_time || "N/A"}
                      </strong>
                    </div>
                    <div className="meta-box">
                      <span className="meta-label">Status</span>
                      <strong className="meta-val">
                        {viewingReport.maintenance_status || "N/A"}
                      </strong>
                    </div>
                  </div>

                  <div className="nl-modal-field">
                    <label>Problem Description</label>
                    <div className="nl-modal-text-box">
                      {viewingReport.problem || "Not specified"}
                    </div>
                  </div>

                  <div className="nl-modal-field">
                    <label>Solution / Action Taken</label>
                    <div className="nl-modal-text-box">
                      {viewingReport.solution || "Not specified"}
                    </div>
                  </div>

                  <div className="nl-modal-field">
                    <label>Full Professional Report</label>
                    <div className="nl-modal-text-box report-text-area">
                      {viewingReport.cleaned_report ||
                        viewingReport.report ||
                        "No report text available."}
                    </div>
                  </div>

                  {viewingReport.original_text && (
                    <div className="nl-modal-field">
                      <label>Original Voice Transcript</label>
                      <div className="nl-modal-text-box subtle">
                        {viewingReport.original_text}
                      </div>
                    </div>
                  )}
                </div>

                <div className="modal-actions-row nl-report-modal-footer">
                  <button
                    type="button"
                    className="btn-modal-cancel"
                    onClick={() => setViewingReport(null)}
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>
          )}

        </div>

      </main>

    </div>
  );
}

export default MachineAnalysis;