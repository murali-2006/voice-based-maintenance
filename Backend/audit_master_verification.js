const axios = require("axios");
const fs = require("fs");
const path = require("path");
const FormData = require("form-data");

const BACKEND_URL = "http://localhost:5000";
const ML_URL = "http://localhost:8000";

let passCount = 0;
let failCount = 0;
const results = [];

function recordResult(testName, passed, detail = "") {
  if (passed) {
    passCount++;
    console.log(`[PASS] ${testName} ${detail ? "- " + detail : ""}`);
    results.push({ testName, status: "PASS", detail });
  } else {
    failCount++;
    console.error(`[FAIL] ${testName} - ${detail}`);
    results.push({ testName, status: "FAIL", detail });
  }
}

async function runAudit() {
  console.log("==================================================");
  console.log("STARTING FULL SYSTEM AUDIT VERIFICATION (ALL SUITES)");
  console.log("==================================================");

  // 1. HEALTH & ROOT ENDPOINTS
  try {
    const resRoot = await axios.get(`${BACKEND_URL}/`);
    const isRunning = resRoot.status === 200 && typeof resRoot.data === "string" && resRoot.data.includes("Running");
    recordResult("GET /", isRunning, resRoot.data);
  } catch (err) {
    recordResult("GET /", false, err.message);
  }

  try {
    const resHealth = await axios.get(`${BACKEND_URL}/health`);
    recordResult("GET /health", resHealth.status === 200 && resHealth.data.status === "healthy");
  } catch (err) {
    recordResult("GET /health", false, err.message);
  }

  try {
    const resMLStatus = await axios.get(`${BACKEND_URL}/ml-status`);
    recordResult("GET /ml-status", resMLStatus.status === 200 && resMLStatus.data.available === true);
  } catch (err) {
    recordResult("GET /ml-status", false, err.message);
  }

  try {
    const resDb = await axios.get(`${BACKEND_URL}/test-db`);
    recordResult("GET /test-db", resDb.status === 200 && resDb.data.message.includes("successful"));
  } catch (err) {
    recordResult("GET /test-db", false, err.message);
  }

  // 2. AUTHENTICATION (POST /login)
  try {
    const officerLogin = await axios.post(`${BACKEND_URL}/login`, {
      email: "officer@gmail.com",
      password: "officer123"
    });
    recordResult("Officer Login", officerLogin.status === 200 && officerLogin.data.user?.role === "OFFICER");
  } catch (err) {
    recordResult("Officer Login", false, err.message);
  }

  try {
    let rejected = false;
    try {
      await axios.post(`${BACKEND_URL}/login`, {
        email: "officer@gmail.com",
        password: "wrongpassword"
      });
    } catch (e) {
      rejected = e.response && e.response.status === 401;
    }
    recordResult("Invalid Password Rejection", rejected);
  } catch (err) {
    recordResult("Invalid Password Rejection", false, err.message);
  }

  // 3. MACHINES
  try {
    const resMachines = await axios.get(`${BACKEND_URL}/machines`);
    const valid = resMachines.status === 200 && Array.isArray(resMachines.data) && resMachines.data.length > 0;
    recordResult("GET /machines", valid, `Loaded ${resMachines.data.length} machines`);
  } catch (err) {
    recordResult("GET /machines", false, err.message);
  }

  // 4. AUTOMATIC MACHINE IDENTIFICATION & CODE AUTHORITY
  try {
    const resId = await axios.post(`${BACKEND_URL}/identify-machine`, {
      text: "I am inspecting the air dryer machine ADR-009 today morning.",
      original_text: "I am inspecting the air dryer machine ADR-009 today morning.",
      engineer_id: "engineer1"
    });
    const valid = resId.status === 200 && resId.data.exists === true && resId.data.machine?.machine_code === "ADR-009";
    recordResult("Machine Identification (Exact Existing)", valid, `Code: ${resId.data.machine?.machine_code}`);
  } catch (err) {
    recordResult("Machine Identification (Exact Existing)", false, err.message);
  }

  try {
    const resUnk = await axios.post(`${BACKEND_URL}/identify-machine`, {
      text: "I inspected the newly installed robotic packaging arm RPA-999 yesterday.",
      original_text: "I inspected the newly installed robotic packaging arm RPA-999 yesterday.",
      engineer_id: "engineer1"
    });
    const valid = resUnk.status === 200 && resUnk.data.exists === false && resUnk.data.machine_code === "RPA-999";
    recordResult("Machine Identification (Unknown Machine)", valid, `Code: ${resUnk.data.machine_code}`);
  } catch (err) {
    recordResult("Machine Identification (Unknown Machine)", false, err.message);
  }

  // 5. REPORT CREATION, RETRIEVAL, AND DELETION
  let createdReportId = null;
  try {
    const testReportPayload = {
      machine_id: 9,
      machine_name: "Industrial Air Dryer",
      machine_code: "ADR-009",
      engineer_id: "test_engineer_audit",
      original_text: "I inspected ADR-009 temperature sensor connection.",
      cleaned_report: "I inspected the industrial air dryer ADR-009 and tightened the temperature sensor connection.",
      report: "I inspected the industrial air dryer ADR-009 and tightened the temperature sensor connection.",
      problem: "Temperature sensor connection loose",
      solution: "Tightened temperature sensor connection",
      maintenance_status: "Operational",
      maintenance_time: "15 minutes",
      source_language: "en",
      source_type: "audit_test"
    };

    const resSave = await axios.post(`${BACKEND_URL}/reports`, testReportPayload);
    const saveOk = (resSave.status === 200 || resSave.status === 201) && (resSave.data.id || resSave.data.report_id);
    createdReportId = resSave.data.id || resSave.data.report_id;
    recordResult("POST /reports (Save Report)", saveOk, `Created ID: ${createdReportId}`);
  } catch (err) {
    recordResult("POST /reports (Save Report)", false, err.message);
  }

  try {
    const resGetReports = await axios.get(`${BACKEND_URL}/reports`);
    const found = resGetReports.data.some(r => r.id === createdReportId || r.engineer_id === "test_engineer_audit");
    recordResult("GET /reports (Retrieve Reports)", found, `Found created report: ${found}`);
  } catch (err) {
    recordResult("GET /reports (Retrieve Reports)", false, err.message);
  }

  if (createdReportId) {
    try {
      const resDelete = await axios.delete(`${BACKEND_URL}/reports/${createdReportId}`);
      recordResult("DELETE /reports/:id (Delete Report)", resDelete.status === 200);

      // Verify deletion from list
      const resVerifyDel = await axios.get(`${BACKEND_URL}/reports`);
      const stillPresent = resVerifyDel.data.some(r => r.id === createdReportId);
      recordResult("Verify Report Deleted from Firestore", !stillPresent, `Still present: ${stillPresent}`);
    } catch (err) {
      recordResult("DELETE /reports/:id (Delete Report)", false, err.message);
    }
  }

  // 6. PENDING MACHINE APPROVAL AND REJECTION WORKFLOW
  let testPendingId = null;
  const testPendingCode = `AUD-${Math.floor(100 + Math.random() * 900)}`;
  try {
    const resPending = await axios.post(`${BACKEND_URL}/pending-machines`, {
      machine_code: testPendingCode,
      machine_name: "Audit Test Lathe",
      engineer_id: "test_engineer",
      notes: "Audit test pending creation"
    });
    testPendingId = resPending.data.request?.id || resPending.data.id;
    recordResult("POST /pending-machines (Submit Pending Request)", !!testPendingId, `Request ID: ${testPendingId}`);
  } catch (err) {
    recordResult("POST /pending-machines (Submit Pending Request)", false, err.message);
  }

  if (testPendingId) {
    try {
      const resListPending = await axios.get(`${BACKEND_URL}/pending-machines?status=PENDING`);
      const exists = resListPending.data.some(r => r.id === testPendingId);
      recordResult("GET /pending-machines", exists, `Found pending item: ${exists}`);
    } catch (err) {
      recordResult("GET /pending-machines", false, err.message);
    }

    try {
      const resApprove = await axios.post(`${BACKEND_URL}/pending-machines/${testPendingId}/approve`, {
        role: "OFFICER",
        officer_id: "officer1",
        machine_name: "Audit Test Lathe Approved"
      }, {
        headers: { "x-user-role": "OFFICER", "x-user-id": "officer1" }
      });
      recordResult("POST /pending-machines/:id/approve", resApprove.status === 200 && resApprove.data.success === true, `Assigned machine_id: ${resApprove.data.machine?.machine_id}`);
    } catch (err) {
      recordResult("POST /pending-machines/:id/approve", false, err.message);
    }
  }

  // Test Pending Rejection
  const rejectPendingCode = `REJ-${Math.floor(100 + Math.random() * 900)}`;
  try {
    const resPendingRej = await axios.post(`${BACKEND_URL}/pending-machines`, {
      machine_code: rejectPendingCode,
      machine_name: "Audit Test Reject Machine",
      engineer_id: "test_engineer",
      notes: "Audit test pending rejection"
    });
    const rejId = resPendingRej.data.request?.id || resPendingRej.data.id;
    if (rejId) {
      const resReject = await axios.post(`${BACKEND_URL}/pending-machines/${rejId}/reject`, {
        role: "OFFICER",
        officer_id: "officer1",
        reason: "Audit test rejection"
      }, {
        headers: { "x-user-role": "OFFICER", "x-user-id": "officer1" }
      });
      recordResult("POST /pending-machines/:id/reject", resReject.status === 200 && resReject.data.success === true, `Status: ${resReject.data.request?.status}`);
    }
  } catch (err) {
    recordResult("POST /pending-machines/:id/reject", false, err.message);
  }

  // 7. GEMINI PROCESSING & FALLBACK REPORT EXTRACTION
  try {
    const resClean = await axios.post(`${BACKEND_URL}/clean-report`, {
      text: "I inspected ADR-009 air dryer. Temperature sensor loose connection secured.",
      source_language: "en"
    });
    const valid = resClean.status === 200 && (resClean.data.cleaned_report || resClean.data.report);
    recordResult("POST /clean-report", valid);
  } catch (err) {
    recordResult("POST /clean-report", false, err.message);
  }

  try {
    const resAnalyze = await axios.post(`${BACKEND_URL}/analyze-report`, {
      report: "I inspected ADR-009 air dryer. Temperature sensor loose connection was secured. Observation required.",
      raw_transcript: "I inspected ADR-009 air dryer. Temperature sensor loose connection was secured. Observation required."
    });
    const analysis = resAnalyze.data.analysis || resAnalyze.data;
    const valid = resAnalyze.status === 200 && (analysis.problem || analysis.solution);
    recordResult("POST /analyze-report (Extract Problem/Solution/Status)", valid, `Status: ${analysis.maintenance_status}`);
  } catch (err) {
    recordResult("POST /analyze-report (Extract Problem/Solution/Status)", false, err.message);
  }

  try {
    const resMachineAnalyze = await axios.post(`${BACKEND_URL}/analyze-machine`, {
      machine_id: 9
    });
    const valid = resMachineAnalyze.status === 200 && (resMachineAnalyze.data.summary || resMachineAnalyze.data.analysis);
    recordResult("POST /analyze-machine", valid);
  } catch (err) {
    recordResult("POST /analyze-machine", false, err.message);
  }

  // 8. NATURAL LANGUAGE SEARCH WITH COMPOUND CONDITIONS & SPELL CORRECTION
  const queriesToTest = [
    {
      query: "show me the maintenance of cnc milling machine with oil leakage problem",
      desc: "Compound condition: CNC AND oil leakage"
    },
    {
      query: "show me the record of cnc mashine with oill leackage",
      desc: "Spelling correction: cnc mashine + oill leackage"
    },
    {
      query: "air dryer temperature fluctuation",
      desc: "Air dryer temperature issue"
    },
    {
      query: "hydraulic press oil leakage",
      desc: "Hydraulic press oil leakage"
    }
  ];

  for (const t of queriesToTest) {
    try {
      const resSearch = await axios.post(`${BACKEND_URL}/search-maintenance-records`, {
        query: t.query
      });
      const valid = resSearch.status === 200 && Array.isArray(resSearch.data.results);
      const matchFound = resSearch.data.results.length > 0;
      recordResult(`Search Query: "${t.query}"`, valid && matchFound, `Returned ${resSearch.data.results.length} results`);
    } catch (err) {
      recordResult(`Search Query: "${t.query}"`, false, err.message);
    }
  }

  // 9. FASTAPI / WHISPER ML SERVICE
  try {
    const resMLHealth = await axios.get(`${ML_URL}/health`);
    recordResult("FastAPI GET /health", resMLHealth.status === 200 && resMLHealth.data.status === "healthy");
  } catch (err) {
    recordResult("FastAPI GET /health", false, err.message);
  }

  try {
    const resMLLangs = await axios.get(`${ML_URL}/languages`);
    recordResult("FastAPI GET /languages", resMLLangs.status === 200 && Array.isArray(resMLLangs.data.languages));
  } catch (err) {
    recordResult("FastAPI GET /languages", false, err.message);
  }

  // 10. WHISPER AUDIO TRANSCRIPTION (POST /transcribe)
  try {
    // Check if test audio file exists
    const audioDir = path.join(__dirname, "..", "test-audio");
    let testAudioPath = null;
    if (fs.existsSync(audioDir)) {
      const files = fs.readdirSync(audioDir);
      for (const f of files) {
        if (f.endsWith(".wav") || f.endsWith(".mp3") || f.endsWith(".webm") || f.endsWith(".m4a")) {
          testAudioPath = path.join(audioDir, f);
          break;
        }
      }
    }

    if (testAudioPath) {
      const form = new FormData();
      form.append("audio", fs.createReadStream(testAudioPath));
      form.append("language", "auto");
      form.append("source_type", "upload");

      const resTranscribe = await axios.post(`${ML_URL}/transcribe`, form, {
        headers: form.getHeaders(),
        timeout: 30000
      });

      const valid = resTranscribe.status === 200 && resTranscribe.data.success === true && !!(resTranscribe.data.whisper_transcript || resTranscribe.data.native_text);
      recordResult("FastAPI POST /transcribe (Real Audio)", valid, `Transcript: "${resTranscribe.data.native_text?.substring(0, 40)}..."`);
    } else {
      console.log("[INFO] No audio file found in test-audio directory, verifying endpoint rejects empty audio properly");
      let rejectedOk = false;
      try {
        await axios.post(`${ML_URL}/transcribe`, {});
      } catch (e) {
        rejectedOk = e.response && e.response.status === 422;
      }
      recordResult("FastAPI POST /transcribe (Validation Check)", rejectedOk, "Properly validated missing audio payload");
    }
  } catch (err) {
    recordResult("FastAPI POST /transcribe", false, err.message);
  }

  console.log("==================================================");
  console.log(`FULL AUDIT COMPLETE: ${passCount} PASSED, ${failCount} FAILED`);
  console.log("==================================================");
  process.exit(failCount > 0 ? 1 : 0);
}

runAudit();
