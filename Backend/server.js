require("dotenv").config();

const express = require("express");
const cors = require("cors");
const axios = require("axios");
const { GoogleGenAI } = require("@google/genai");
const db = require("./firebaseAdmin");

const app = express();

// ==========================================
// GEMINI
// ==========================================
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

// ==========================================
// MIDDLEWARE
// ==========================================
app.use(
  cors({
    origin: true,
    credentials: true,
  })
);
app.use(express.json());

// ==========================================
// HEALTH CHECK ENDPOINT (Render / Cloud)
// ==========================================
app.get("/health", (req, res) => {
  res.json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    service: "Voice Maintenance Backend",
  });
});

// ==========================================
// Basic API
// ==========================================
app.get("/", (req, res) => {
  res.send("Voice Maintenance Backend is Running!");
});

// ===============================
// ML Whisper Service Status
// ===============================
app.get("/ml-status", async (req, res) => {
  try {
    const mlUrl = (process.env.ML_SERVICE_URL || "http://localhost:8000").replace(/\/+$/, "");
    const response = await axios.get(`${mlUrl}/health`, {
      timeout: 3000,
    });
    res.json({
      available: true,
      data: response.data,
    });
  } catch (error) {
    res.json({
      available: false,
      message: "ML Whisper service is not running on port 8000",
    });
  }
});

// ==========================================
// FIREBASE CONNECTION TEST
// ==========================================
app.get("/test-db", async (req, res) => {
  try {
    const snapshot = await db
      .collection("users")
      .limit(1)
      .get();

    res.json({
      message: "Firebase connection successful",
      usersFound: snapshot.size,
    });
  } catch (error) {
    console.error(
      "Firebase connection error:",
      error
    );

    res.status(500).json({
      message: "Firebase connection failed",
      error: error.message,
    });
  }
});

// ==========================================
// TRANSLATE TEXT TO ENGLISH
// ==========================================
app.post("/translate", async (req, res) => {
  try {
    const { text, source } = req.body;

    if (!text) {
      return res.status(400).json({
        message: "Text is required",
      });
    }

    const languageCode = source || "ta";

    const response = await axios.get(
      "https://api.mymemory.translated.net/get",
      {
        params: {
          q: text,
          langpair: `${languageCode}|en`,
        },
      }
    );

    const translatedText =
      response.data.responseData.translatedText;

    res.json({
      translatedText,
    });
  } catch (error) {
    console.error(
      "Translation error:",
      error.response?.data || error.message
    );

    res.status(500).json({
      message: "Translation failed",
      error: error.message,
    });
  }
});

// ==========================================
// CLEAN & PROFESSIONALIZE MAINTENANCE REPORT
// ==========================================
app.post("/clean-report", async (req, res) => {
  try {
    const { text } = req.body;

    if (!text || !text.trim()) {
      return res.status(400).json({
        message: "Text is required for cleanup",
      });
    }

    const response = await ai.models.generateContent({
      model: "gemini-3.6-flash",
      contents: `
You are a professional industrial maintenance report editor.
Clean and professionalize this raw speech maintenance report.

Rules:
- Convert to clear, grammatically correct professional English suitable for an industrial plant maintenance log.
- Remove verbal filler words such as "uh", "um", "actually", "you know", obvious speech hesitation, or stuttering/repeated words.
- Do NOT invent facts or hallucinate missing maintenance actions or times.
- If a sentence is unclear, clean it conservatively without guessing.
- PRESERVE machine identifiers, machine codes, numbers, measurements, times, component names, and technical details exactly.
- Detect any machine code or equipment identifier mentioned in the report (e.g., "ML-06", "ML-10", "CNC-001", "HYD-002", "ML-99", "Machine 2") and return it in "detected_machine". If no specific machine identifier is mentioned, return an empty string "".

Return ONLY valid JSON in this exact structure:
{
  "cleaned_report": "",
  "detected_machine": ""
}

Raw maintenance speech text:
${text}
`,
      config: {
        responseMimeType: "application/json",
      },
    });

    const resultText = response.text;
    if (!resultText) {
      throw new Error("Gemini returned an empty cleanup response");
    }

    const parsed = JSON.parse(resultText);

    res.json({
      success: true,
      cleaned_report: parsed.cleaned_report || text.trim(),
      detected_machine: parsed.detected_machine || "",
    });
  } catch (error) {
    console.error("Report cleanup error:", error);
    res.status(500).json({
      message: "Report cleanup failed",
      error: error.message,
    });
  }
});

// ==========================================
// ANALYZE ENGLISH MAINTENANCE REPORT
// ==========================================
app.post("/analyze-report", async (req, res) => {
  try {
    const { report } = req.body;

    if (!report || !report.trim()) {
      return res.status(400).json({
        message: "English report is required",
      });
    }

    const response =
      await ai.models.generateContent({
        model: "gemini-3.6-flash",

        contents: `
Analyze this English industrial maintenance report.

Extract only these fields:

{
  "problem": "",
  "solution": "",
  "maintenance_status": "",
  "maintenance_time": ""
}

Rules:
- Do not invent information.
- If information is not mentioned, return an empty string.
- Keep values short and clear.
- maintenance_status should be Completed, Pending, In Progress, or empty.
- maintenance_time should contain the time only when it is mentioned.

Maintenance report:
${report}
`,

        config: {
          responseMimeType:
            "application/json",
        },
      });

    const resultText = response.text;

    if (!resultText) {
      throw new Error(
        "Gemini returned an empty response"
      );
    }

    const analysis =
      JSON.parse(resultText);

    res.json({
      success: true,
      analysis: {
        problem:
          analysis.problem || "",

        solution:
          analysis.solution || "",

        maintenance_status:
          analysis.maintenance_status || "",

        maintenance_time:
          analysis.maintenance_time || "",
      },
    });
  } catch (error) {
    console.error(
      "Report analysis error:",
      error
    );

    res.status(500).json({
      message: "Analysis failed",
      error: error.message,
    });
  }
});

// ==========================================
// ANALYZE COMPLETE MACHINE HISTORY
// ==========================================
app.post("/analyze-machine", async (req, res) => {
  try {
    const { machine_id } = req.body;

    if (
      machine_id === undefined ||
      machine_id === null ||
      machine_id === ""
    ) {
      return res.status(400).json({
        message: "machine_id is required",
      });
    }

    const machineIdNumber = Number(machine_id);

    if (Number.isNaN(machineIdNumber)) {
      return res.status(400).json({
        message: "Invalid machine_id",
      });
    }

    // ----------------------------------------
    // GET ALL REPORTS FOR THIS MACHINE
    // ----------------------------------------
    const snapshot = await db
      .collection("maintenance_reports")
      .where(
        "machine_id",
        "==",
        machineIdNumber
      )
      .get();

    if (snapshot.empty) {
      return res.status(404).json({
        message:
          "No reports found for this machine",
      });
    }

    const machineReports =
      snapshot.docs.map((doc) => {
        const data = doc.data();

        return {
          problem: data.problem || "",

          solution: data.solution || "",

          maintenance_status:
            data.maintenance_status || "",

          maintenance_time:
            data.maintenance_time || "",

          report: data.report || "",

          created_at:
            data.created_at || null,
        };
      });

    // ----------------------------------------
    // FIND LATEST REPORT
    // ----------------------------------------
    machineReports.sort((a, b) => {
      const dateA = getTimestamp(a.created_at);
      const dateB = getTimestamp(b.created_at);

      return dateB - dateA;
    });

    const latestReport =
      machineReports[0] || null;

    // ----------------------------------------
    // GEMINI PROMPT
    // ----------------------------------------
    const prompt = `
You are analyzing the complete maintenance history
of one industrial machine.

Analyze the following maintenance reports and return
ONLY valid JSON.

Required structure:

{
  "summary": "",
  "repeated_problems": [
    {
      "problem": "",
      "count": 0
    }
  ],
  "latest_status": "",
  "maintenance_pattern": "",
  "attention_required": false
}

Rules:
- Do not invent information.
- Use only information present in the reports.
- Count repeated problems accurately.
- Include only problems that actually repeat.
- If no problem repeats, return an empty repeated_problems array.
- latest_status should come from the latest available report.
- maintenance_pattern should summarize the observed history.
- attention_required should be true only when the machine shows repeated or recurring problems that deserve further inspection.
- This is an analytical indicator, NOT a guaranteed future failure prediction.
- Keep all text short and clear.

Maintenance reports:

${JSON.stringify(
  machineReports,
  null,
  2
)}
`;

    // ----------------------------------------
    // GEMINI ANALYSIS
    // ----------------------------------------
    const response =
      await ai.models.generateContent({
        model: "gemini-3.6-flash",

        contents: prompt,

        config: {
          responseMimeType:
            "application/json",
        },
      });

    const resultText = response.text;

    if (!resultText) {
      throw new Error(
        "Gemini returned an empty machine analysis"
      );
    }

    const analysis =
      JSON.parse(resultText);

    // ----------------------------------------
    // RESPONSE
    // ----------------------------------------
    res.json({
      success: true,

      machine_id:
        machineIdNumber,

      total_reports:
        machineReports.length,

      latest_report: latestReport,

      analysis: {
        summary:
          analysis.summary || "",

        repeated_problems:
          Array.isArray(
            analysis.repeated_problems
          )
            ? analysis.repeated_problems
            : [],

        latest_status:
          analysis.latest_status || "",

        maintenance_pattern:
          analysis.maintenance_pattern || "",

        attention_required:
          Boolean(
            analysis.attention_required
          ),
      },
    });
  } catch (error) {
    console.error(
      "Machine analysis error:",
      error
    );

    res.status(500).json({
      message:
        "Failed to analyze machine",
      error: error.message,
    });
  }
});

// ==========================================
// SAVE MAINTENANCE REPORT
// ==========================================
app.post("/reports", async (req, res) => {
  try {
    console.log(
      "================================="
    );

    console.log(
      "REPORT REQUEST RECEIVED"
    );

    console.log(
      "Request body:",
      req.body
    );

    console.log(
      "================================="
    );

    const machine_id =
      req.body.machine_id ??
      req.body.machineId;

    const engineer_id =
      req.body.engineer_id ??
      req.body.engineerId ??
      req.body.user_id ??
      req.body.userId;

    const report =
      req.body.report ??
      req.body.text ??
      req.body.maintenance_report;

    const problem =
      req.body.problem ?? "";

    const solution =
      req.body.solution ?? "";

    const maintenance_status =
      req.body.maintenance_status ?? "";

    const maintenance_time =
      req.body.maintenance_time ?? "";

    const original_text =
      req.body.original_text ??
      req.body.originalText ??
      report;

    const source_language =
      req.body.source_language ??
      req.body.sourceLanguage ??
      "en-US";

    const translated_report =
      req.body.translated_report ??
      req.body.translatedReport ??
      report;

    const cleaned_report =
      req.body.cleaned_report ??
      req.body.cleanedReport ??
      report;

    if (
      machine_id === undefined ||
      machine_id === null ||
      machine_id === ""
    ) {
      return res.status(400).json({
        message:
          "machine_id is required",
      });
    }

    if (
      engineer_id === undefined ||
      engineer_id === null ||
      engineer_id === ""
    ) {
      return res.status(400).json({
        message:
          "engineer_id is required",
      });
    }

    if (
      report === undefined ||
      report === null ||
      report === ""
    ) {
      return res.status(400).json({
        message:
          "report is required",
      });
    }

    const machineIdNumber =
      Number(machine_id);

    if (
      Number.isNaN(machineIdNumber)
    ) {
      return res.status(400).json({
        message:
          "machine_id must be a valid number",
      });
    }

    // ----------------------------------------
    // CHECK MACHINE
    // ----------------------------------------
    const machineSnapshot =
      await db
        .collection("machines")
        .where(
          "machine_id",
          "==",
          machineIdNumber
        )
        .limit(1)
        .get();

    if (machineSnapshot.empty) {
      return res.status(404).json({
        message:
          "Machine not found",
      });
    }

    const machineData =
      machineSnapshot.docs[0].data();

    const createdAt = new Date();

    // ----------------------------------------
    // SAVE REPORT
    // ----------------------------------------
    const reportRef =
      await db
        .collection(
          "maintenance_reports"
        )
        .add({
          machine_id:
            machineIdNumber,

          machine_code:
            req.body.machine_code ??
            machineData.machine_code ??
            "",

          machine_name:
            req.body.machine_name ??
            machineData.machine_name ??
            "",

          engineer_id:
            String(engineer_id),

          original_text:
            String(original_text),

          source_language:
            String(source_language),

          translated_report:
            String(translated_report),

          cleaned_report:
            String(cleaned_report),

          report:
            String(cleaned_report || report),

          problem:
            String(problem),

          solution:
            String(solution),

          maintenance_status:
            String(
              maintenance_status
            ),

          maintenance_time:
            String(
              maintenance_time
            ),

          created_at:
            createdAt,
        });

    console.log(
      "Report saved successfully:",
      reportRef.id
    );

    res.status(201).json({
      id: reportRef.id,

      machine_id:
        machineIdNumber,

      machine_name:
        machineData.machine_name ||
        "Unknown Machine",

      machine_code:
        machineData.machine_code ||
        "N/A",

      engineer_id:
        String(engineer_id),

      original_text:
        String(original_text),

      source_language:
        String(source_language),

      translated_report:
        String(translated_report),

      cleaned_report:
        String(cleaned_report),

      report:
        String(cleaned_report || report),

      problem:
        String(problem),

      solution:
        String(solution),

      maintenance_status:
        String(
          maintenance_status
        ),

      maintenance_time:
        String(
          maintenance_time
        ),

      created_at:
        createdAt.toISOString(),
    });
  } catch (error) {
    console.error(
      "Save report error:",
      error
    );

    res.status(500).json({
      message:
        "Failed to save report",

      error:
        error.message,
    });
  }
});

// ==========================================
// GET ALL MAINTENANCE REPORTS
// ==========================================
app.get("/reports", async (req, res) => {
  try {
    const snapshot =
      await db
        .collection(
          "maintenance_reports"
        )
        .orderBy(
          "created_at",
          "desc"
        )
        .get();

    const reports = [];

    for (
      const doc of snapshot.docs
    ) {
      const data =
        doc.data();

      // --------------------------------------
      // MACHINE DETAILS
      // --------------------------------------
      const machineSnapshot =
        await db
          .collection("machines")
          .where(
            "machine_id",
            "==",
            Number(
              data.machine_id
            )
          )
          .limit(1)
          .get();

      let machineName =
        data.machine_name ||
        "Unknown Machine";

      let machineCode =
        data.machine_code ||
        "N/A";

      if (
        !machineSnapshot.empty
      ) {
        const machineData =
          machineSnapshot.docs[0].data();

        machineName =
          machineName !==
          "Unknown Machine"
            ? machineName
            : machineData.machine_name ||
              "Unknown Machine";

        machineCode =
          machineCode !== "N/A"
            ? machineCode
            : machineData.machine_code ||
              "N/A";
      }

      // --------------------------------------
      // CREATED AT
      // --------------------------------------
      const createdAt =
        convertTimestamp(
          data.created_at
        );

      // --------------------------------------
      // REPORT TEXT
      // --------------------------------------
      const reportText =
        safeValue(
          data.report
        );

      reports.push({
        id:
          String(doc.id),

        machine_id:
          data.machine_id ??
          null,

        machine_name:
          String(machineName),

        machine_code:
          String(machineCode),

        engineer_id:
          data.engineer_id ??
          null,

        original_text:
          safeValue(
            data.original_text
          ),

        source_language:
          safeValue(
            data.source_language
          ),

        translated_report:
          safeValue(
            data.translated_report
          ),

        cleaned_report:
          safeValue(
            data.cleaned_report || data.report
          ),

        report:
          reportText,

        problem:
          safeValue(
            data.problem
          ),

        solution:
          safeValue(
            data.solution
          ),

        maintenance_status:
          safeValue(
            data.maintenance_status
          ),

        maintenance_time:
          safeValue(
            data.maintenance_time
          ),

        created_at:
          createdAt,
      });
    }

    res.json(reports);
  } catch (error) {
    console.error(
      "Fetch reports error:",
      error
    );

    res.status(500).json({
      message:
        "Failed to fetch reports",

      error:
        error.message,
    });
  }
});

// ==========================================
// GET ALL MACHINES
// ==========================================
app.get("/machines", async (req, res) => {
  try {
    const snapshot =
      await db
        .collection("machines")
        .orderBy(
          "machine_id",
          "asc"
        )
        .get();

    const machines =
      snapshot.docs.map(
        (doc) => {
          const data =
            doc.data();

          return {
            id:
              String(doc.id),

            machine_id:
              data.machine_id,

            machine_name:
              String(
                data.machine_name ||
                ""
              ),

            machine_code:
              String(
                data.machine_code ||
                ""
              ),
          };
        }
      );

    res.json(machines);
  } catch (error) {
    console.error(
      "Fetch machines error:",
      error
    );

    res.status(500).json({
      message:
        "Failed to fetch machines",

      error:
        error.message,
    });
  }
});

// ==========================================
// VALIDATE MACHINE REFERENCE AGAINST FIRESTORE
// ==========================================
app.post("/validate-machine", async (req, res) => {
  try {
    const { machine_reference } = req.body;

    if (!machine_reference || !String(machine_reference).trim()) {
      return res.status(400).json({
        message: "machine_reference is required",
      });
    }

    const rawRef = String(machine_reference).trim();
    const refLower = rawRef.toLowerCase();

    // Fetch all registered machines from Firestore
    const snapshot = await db.collection("machines").get();
    let matchedMachine = null;

    for (const doc of snapshot.docs) {
      const data = doc.data();
      const code = String(data.machine_code || "").trim().toLowerCase();
      const name = String(data.machine_name || "").trim().toLowerCase();
      const idNum = data.machine_id !== undefined ? String(data.machine_id) : "";

      // 1. Direct machine_code match (e.g. "ML-06", "CNC-001", "HYD-002")
      if (
        code === refLower ||
        code.replace(/[-_\s]/g, "") === refLower.replace(/[-_\s]/g, "")
      ) {
        matchedMachine = {
          id: doc.id,
          machine_id: data.machine_id,
          machine_code: data.machine_code,
          machine_name: data.machine_name,
        };
        break;
      }

      // 2. Numeric machine_id match (e.g., ref is "2" or "Machine 2")
      const numericPart = refLower.replace(/[^0-9]/g, "");
      if (numericPart && numericPart === idNum) {
        matchedMachine = {
          id: doc.id,
          machine_id: data.machine_id,
          machine_code: data.machine_code,
          machine_name: data.machine_name,
        };
        break;
      }

      // 3. Exact machine_name match
      if (name === refLower) {
        matchedMachine = {
          id: doc.id,
          machine_id: data.machine_id,
          machine_code: data.machine_code,
          machine_name: data.machine_name,
        };
        break;
      }
    }

    if (matchedMachine) {
      return res.json({
        exists: true,
        machine: matchedMachine,
      });
    }

    return res.json({
      exists: false,
      machine_reference: rawRef,
    });
  } catch (error) {
    console.error("Machine validation error:", error);
    res.status(500).json({
      message: "Machine validation failed",
      error: error.message,
    });
  }
});

// ==========================================
// GEMINI MACHINE DETAILS EXTRACTION
// ==========================================
async function extractMachineDetails(reportText, machineCodeHint = "") {
  try {
    const prompt = `
You are an industrial equipment data analyst.
Analyze the following maintenance report for explicit machine specifications.

Extract only these fields into valid JSON:
{
  "machine_code": "",
  "machine_name": "",
  "machine_type": "",
  "manufacturer": "",
  "model_number": "",
  "serial_number": "",
  "location": ""
}

Rules:
- Never invent or hallucinate information.
- Never guess manufacturer, model, serial number, machine type, or location.
- If information is not explicitly stated in the text, leave it as an empty string "".
- If machine code is mentioned (e.g. "CMP-004", "CNC-001"), extract it into "machine_code". Use "${machineCodeHint}" as a priority hint if valid.
- If a descriptive machine name is mentioned (e.g. "Industrial Air Compressor"), extract it into "machine_name". If only a type or code is mentioned without a formal name, use the type or leave empty.
- Do NOT assume that CMP-004 is a compressor, CNC machine, etc. unless explicitly mentioned in the text.

Report text:
${reportText}
`;

    const response = await ai.models.generateContent({
      model: "gemini-3.6-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
      },
    });

    const resultText = response.text;
    if (!resultText) {
      throw new Error("Gemini returned empty response for machine details extraction");
    }

    const parsed = JSON.parse(resultText);
    return {
      machine_code: (parsed.machine_code || machineCodeHint || "").trim(),
      machine_name: (parsed.machine_name || "").trim(),
      machine_type: (parsed.machine_type || "").trim(),
      manufacturer: (parsed.manufacturer || "").trim(),
      model_number: (parsed.model_number || "").trim(),
      serial_number: (parsed.serial_number || "").trim(),
      location: (parsed.location || "").trim(),
    };
  } catch (err) {
    console.error("Error extracting machine details with Gemini:", err);
    return {
      machine_code: String(machineCodeHint).trim(),
      machine_name: "",
      machine_type: "",
      manufacturer: "",
      model_number: "",
      serial_number: "",
      location: "",
    };
  }
}

// ==========================================
// CREATE PENDING MACHINE REGISTRATION REQUEST
// ==========================================
app.post("/pending-machines", async (req, res) => {
  try {
    const { report_text, machine_code, requested_by, draft_report } = req.body;

    if (!machine_code || !String(machine_code).trim()) {
      return res.status(400).json({
        message: "machine_code is required",
      });
    }

    const rawCode = String(machine_code).trim();
    const codeLower = rawCode.toLowerCase();
    const codeNorm = codeLower.replace(/[-_\s]/g, "");

    // 1. Check if machine already exists in machines collection
    const machinesSnap = await db.collection("machines").get();
    for (const doc of machinesSnap.docs) {
      const data = doc.data();
      const c = String(data.machine_code || "").toLowerCase().trim();
      if (c === codeLower || c.replace(/[-_\s]/g, "") === codeNorm) {
        return res.json({
          status: "EXISTS",
          message: `Machine with code '${data.machine_code}' already exists in registered machines.`,
          machine: {
            id: doc.id,
            machine_id: data.machine_id,
            machine_code: data.machine_code,
            machine_name: data.machine_name,
          },
        });
      }
    }

    // 2. Check if a request for this machine code already exists in pending_machine_requests
    const pendingSnap = await db.collection("pending_machine_requests").get();
    for (const doc of pendingSnap.docs) {
      const data = doc.data();
      const c = String(data.machine_code || "").toLowerCase().trim();
      if (c === codeLower || c.replace(/[-_\s]/g, "") === codeNorm) {
        if (data.status === "PENDING") {
          return res.json({
            status: "ALREADY_PENDING",
            message: `A registration request for machine '${data.machine_code}' is already pending Head Officer approval.`,
            request: {
              id: doc.id,
              ...data,
            },
          });
        }
        if (data.status === "APPROVED") {
          return res.json({
            status: "APPROVED",
            message: `Machine '${data.machine_code}' was previously approved.`,
            request: {
              id: doc.id,
              ...data,
            },
          });
        }
      }
    }

    // 3. Extract machine details using Gemini
    const textToAnalyze =
      report_text ||
      draft_report?.cleaned_report ||
      draft_report?.original_text ||
      rawCode;
    const extractedDetails = await extractMachineDetails(textToAnalyze, rawCode);

    // 4. Create document in pending_machine_requests
    const newRequest = {
      machine_code: extractedDetails.machine_code || rawCode,
      machine_name: extractedDetails.machine_name || "",
      machine_type: extractedDetails.machine_type || "",
      manufacturer: extractedDetails.manufacturer || "",
      model_number: extractedDetails.model_number || "",
      serial_number: extractedDetails.serial_number || "",
      location: extractedDetails.location || "",
      source_report_id: "",
      requested_by: String(
        requested_by || draft_report?.engineer_id || "engineer"
      ),
      status: "PENDING",
      created_at: new Date(),
      draft_report: draft_report || null,
    };

    const docRef = await db
      .collection("pending_machine_requests")
      .add(newRequest);

    console.log(
      `Created pending machine request: ID ${docRef.id}, Code ${newRequest.machine_code}`
    );

    res.status(201).json({
      success: true,
      status: "CREATED",
      message: `Machine request for '${newRequest.machine_code}' sent to Head Officer for approval.`,
      request: {
        id: docRef.id,
        ...newRequest,
      },
    });
  } catch (error) {
    console.error("Error creating pending machine request:", error);
    res.status(500).json({
      message: "Failed to create pending machine request",
      error: error.message,
    });
  }
});

// ==========================================
// GET PENDING MACHINE REQUESTS
// ==========================================
app.get("/pending-machines", async (req, res) => {
  try {
    const { status } = req.query;
    let query = db.collection("pending_machine_requests");

    if (status) {
      query = query.where("status", "==", String(status).toUpperCase());
    }

    const snapshot = await query.get();
    const requests = snapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        ...data,
        created_at: convertTimestamp(data.created_at),
        approved_at: convertTimestamp(data.approved_at),
        rejected_at: convertTimestamp(data.rejected_at),
      };
    });

    // Sort newest first
    requests.sort((a, b) => {
      const dateA = getTimestamp(a.created_at);
      const dateB = getTimestamp(b.created_at);
      return dateB - dateA;
    });

    res.json(requests);
  } catch (error) {
    console.error("Fetch pending machine requests error:", error);
    res.status(500).json({
      message: "Failed to fetch pending machine requests",
      error: error.message,
    });
  }
});

// ==========================================
// APPROVE PENDING MACHINE (HEAD OFFICER ONLY)
// ==========================================
app.post("/pending-machines/:id/approve", async (req, res) => {
  try {
    const userRole = (
      req.headers["x-user-role"] ||
      req.body.role ||
      ""
    ).toUpperCase();

    if (userRole !== "OFFICER") {
      return res.status(403).json({
        message:
          "Access denied. Only Head Officers are authorized to approve machine requests.",
      });
    }

    const { id } = req.params;
    const officerId =
      req.headers["x-user-id"] || req.body.officer_id || "officer1";

    const requestRef = db.collection("pending_machine_requests").doc(id);
    const requestSnap = await requestRef.get();

    if (!requestSnap.exists) {
      return res.status(404).json({
        message: "Pending machine request not found.",
      });
    }

    const requestData = requestSnap.data();
    if (requestData.status === "APPROVED") {
      return res.status(400).json({
        message: "This machine request has already been approved.",
      });
    }

    const trimmedCode = String(requestData.machine_code).trim();
    const trimmedName = String(
      req.body.machine_name || requestData.machine_name || trimmedCode
    ).trim();

    // 1. Re-check duplicates in machines collection and calculate next sequential numeric machine_id
    const machinesSnap = await db.collection("machines").get();
    let maxId = 0;

    for (const doc of machinesSnap.docs) {
      const data = doc.data();
      const currentCode = String(data.machine_code || "").trim().toLowerCase();
      if (currentCode === trimmedCode.toLowerCase()) {
        // Machine already exists! Update request status and return it
        await requestRef.update({
          status: "APPROVED",
          approved_by: String(officerId),
          approved_at: new Date(),
          created_machine_id: data.machine_id,
        });

        return res.json({
          success: true,
          message: `Machine '${trimmedCode}' already exists in registered machines.`,
          machine: {
            id: doc.id,
            machine_id: data.machine_id,
            machine_code: data.machine_code,
            machine_name: data.machine_name,
          },
        });
      }

      const currentId = Number(data.machine_id);
      if (!Number.isNaN(currentId) && currentId > maxId) {
        maxId = currentId;
      }
    }

    const nextId = maxId + 1;
    const newMachineData = {
      machine_id: nextId,
      machine_code: trimmedCode,
      machine_name: trimmedName,
      created_at: new Date(),
    };

    // 2. Add machine to machines collection
    const machineDocRef = await db.collection("machines").add(newMachineData);
    console.log(
      `Head Officer approved & added machine: ID ${nextId}, Code ${trimmedCode}`
    );

    // 3. If draft_report is attached and no source_report_id exists yet, finalize maintenance report!
    let createdReportId = "";
    if (requestData.draft_report && !requestData.source_report_id) {
      try {
        const draft = requestData.draft_report;
        const reportText = draft.cleaned_report || draft.original_text || "";

        // Run Gemini analysis on draft report text
        let analysis = {
          problem: "",
          solution: "",
          maintenance_status: "Completed",
          maintenance_time: "",
        };
        if (reportText) {
          try {
            const analysisRes = await ai.models.generateContent({
              model: "gemini-3.6-flash",
              contents: `Analyze this maintenance report. Extract problem, solution, maintenance_status (Completed, Pending, In Progress), maintenance_time into JSON: { "problem": "", "solution": "", "maintenance_status": "", "maintenance_time": "" }\nReport:\n${reportText}`,
              config: { responseMimeType: "application/json" },
            });
            if (analysisRes.text) {
              analysis = JSON.parse(analysisRes.text);
            }
          } catch (e) {
            console.warn("Could not auto-analyze report on approval:", e.message);
          }
        }

        const reportDocRef = await db.collection("maintenance_reports").add({
          machine_id: nextId,
          machine_code: trimmedCode,
          machine_name: trimmedName,
          engineer_id: String(
            draft.engineer_id || requestData.requested_by || "engineer"
          ),
          original_text: String(draft.original_text || reportText),
          source_language: String(draft.source_language || "en-US"),
          translated_report: String(draft.translated_report || reportText),
          cleaned_report: String(draft.cleaned_report || reportText),
          report: String(draft.cleaned_report || reportText),
          problem: String(analysis.problem || ""),
          solution: String(analysis.solution || ""),
          maintenance_status: String(analysis.maintenance_status || "Completed"),
          maintenance_time: String(analysis.maintenance_time || ""),
          created_at: new Date(),
        });

        createdReportId = reportDocRef.id;
        console.log(
          `Finalized maintenance report ${createdReportId} for newly approved machine ${trimmedCode}`
        );
      } catch (repErr) {
        console.error("Error finalizing report for approved machine:", repErr);
      }
    }

    // 4. Update request status in pending_machine_requests
    await requestRef.update({
      status: "APPROVED",
      approved_by: String(officerId),
      approved_at: new Date(),
      created_machine_id: nextId,
      source_report_id: createdReportId || requestData.source_report_id || "",
    });

    res.json({
      success: true,
      message: `Machine '${trimmedCode}' approved and registered successfully.`,
      machine: {
        id: machineDocRef.id,
        machine_id: nextId,
        machine_code: trimmedCode,
        machine_name: trimmedName,
      },
      source_report_id: createdReportId,
    });
  } catch (error) {
    console.error("Error approving machine request:", error);
    res.status(500).json({
      message: "Failed to approve machine request",
      error: error.message,
    });
  }
});

// ==========================================
// REJECT PENDING MACHINE (HEAD OFFICER ONLY)
// ==========================================
app.post("/pending-machines/:id/reject", async (req, res) => {
  try {
    const userRole = (
      req.headers["x-user-role"] ||
      req.body.role ||
      ""
    ).toUpperCase();

    if (userRole !== "OFFICER") {
      return res.status(403).json({
        message:
          "Access denied. Only Head Officers are authorized to reject machine requests.",
      });
    }

    const { id } = req.params;
    const officerId =
      req.headers["x-user-id"] || req.body.officer_id || "officer1";
    const rejectionReason =
      req.body.reason ||
      req.body.rejection_reason ||
      "Rejected by Head Officer";

    const requestRef = db.collection("pending_machine_requests").doc(id);
    const requestSnap = await requestRef.get();

    if (!requestSnap.exists) {
      return res.status(404).json({
        message: "Pending machine request not found.",
      });
    }

    await requestRef.update({
      status: "REJECTED",
      rejected_by: String(officerId),
      rejected_at: new Date(),
      rejection_reason: String(rejectionReason),
    });

    console.log(
      `Head Officer rejected machine request ${id}: ${rejectionReason}`
    );

    res.json({
      success: true,
      message: "Machine request has been rejected.",
    });
  } catch (error) {
    console.error("Error rejecting machine request:", error);
    res.status(500).json({
      message: "Failed to reject machine request",
      error: error.message,
    });
  }
});

// ==========================================
// CREATE NEW MACHINE (HEAD OFFICER ONLY)
// ==========================================
app.post("/machines", async (req, res) => {
  try {
    // ----------------------------------------
    // ROLE RESTRICTION CHECK
    // ----------------------------------------
    const userRole = (
      req.headers["x-user-role"] ||
      req.body.role ||
      ""
    ).toUpperCase();

    if (userRole !== "OFFICER") {
      return res.status(403).json({
        message: "Access denied. Only Head Officers are authorized to register new machines.",
      });
    }

    const { machine_code, machine_name, machine_id } = req.body;

    if (!machine_code || !String(machine_code).trim()) {
      return res.status(400).json({
        message: "machine_code is required",
      });
    }

    if (!machine_name || !String(machine_name).trim()) {
      return res.status(400).json({
        message: "machine_name is required",
      });
    }

    const trimmedCode = String(machine_code).trim();
    const trimmedName = String(machine_name).trim();

    // Check for duplicate machine codes and calculate max ID in Firestore
    const snapshot = await db.collection("machines").get();
    let maxId = 0;
    let customId = null;

    if (machine_id !== undefined && machine_id !== null && String(machine_id).trim() !== "") {
      const parsedId = Number(machine_id);
      if (Number.isNaN(parsedId) || parsedId <= 0) {
        return res.status(400).json({
          message: "machine_id must be a valid positive number",
        });
      }
      customId = parsedId;
    }

    for (const doc of snapshot.docs) {
      const data = doc.data();
      const currentCode = String(data.machine_code || "").trim().toLowerCase();
      const currentId = Number(data.machine_id);

      if (currentCode === trimmedCode.toLowerCase()) {
        return res.status(409).json({
          message: `Machine with code '${trimmedCode}' already exists.`,
          machine: {
            id: doc.id,
            machine_id: data.machine_id,
            machine_code: data.machine_code,
            machine_name: data.machine_name,
          },
        });
      }

      if (customId !== null && currentId === customId) {
        return res.status(409).json({
          message: `Machine with ID '${customId}' already exists.`,
          machine: {
            id: doc.id,
            machine_id: data.machine_id,
            machine_code: data.machine_code,
            machine_name: data.machine_name,
          },
        });
      }

      if (!Number.isNaN(currentId) && currentId > maxId) {
        maxId = currentId;
      }
    }

    // Assign custom ID or next sequential numeric machine_id
    const assignedId = customId !== null ? customId : maxId + 1;
    const newMachineData = {
      machine_id: assignedId,
      machine_code: trimmedCode,
      machine_name: trimmedName,
      created_at: new Date(),
    };

    const docRef = await db.collection("machines").add(newMachineData);

    console.log(`Created new machine by Officer: ID ${assignedId}, Code ${trimmedCode}, Name ${trimmedName}`);

    res.status(201).json({
      success: true,
      machine: {
        id: docRef.id,
        machine_id: assignedId,
        machine_code: trimmedCode,
        machine_name: trimmedName,
      },
    });
  } catch (error) {
    console.error("Create machine error:", error);
    res.status(500).json({
      message: "Failed to create machine",
      error: error.message,
    });
  }
});

// ==========================================
// DELETE REPORT
// ==========================================
app.delete(
  "/reports/:id",
  async (req, res) => {
    try {
      const { id } =
        req.params;

      const reportRef =
        db
          .collection(
            "maintenance_reports"
          )
          .doc(id);

      const reportSnapshot =
        await reportRef.get();

      if (
        !reportSnapshot.exists
      ) {
        return res.status(404).json({
          message:
            "Report not found",
        });
      }

      const reportData =
        reportSnapshot.data();

      await reportRef.delete();

      res.json({
        message:
          "Report deleted successfully",

        report: {
          id,

          ...reportData,
        },
      });
    } catch (error) {
      console.error(
        "Delete report error:",
        error
      );

      res.status(500).json({
        message:
          "Failed to delete report",

        error:
          error.message,
      });
    }
  }
);

// ==========================================
// LOGIN
// ==========================================
app.post("/login", async (req, res) => {
  try {
    const {
      email,
      password,
    } = req.body;

    if (
      !email ||
      !password
    ) {
      return res.status(400).json({
        message:
          "Email and password are required",
      });
    }

    const snapshot =
      await db
        .collection("users")
        .where(
          "email",
          "==",
          email
        )
        .where(
          "password",
          "==",
          password
        )
        .limit(1)
        .get();

    if (
      snapshot.empty
    ) {
      return res.status(401).json({
        message:
          "Invalid email or password",
      });
    }

    const userDoc =
      snapshot.docs[0];

    const userData =
      userDoc.data();

    res.json({
      message:
        "Login successful",

      user: {
        id:
          String(userDoc.id),

        name:
          String(
            userData.name ||
            ""
          ),

        email:
          String(
            userData.email ||
            ""
          ),

        role:
          String(
            userData.role ||
            ""
          ),
      },
    });
  } catch (error) {
    console.error(
      "Login error:",
      error
    );

    res.status(500).json({
      message:
        "Login failed",

      error:
        error.message,
    });
  }
});

// ==========================================
// HELPER FUNCTIONS
// ==========================================

function safeValue(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return "";
  }

  if (
    typeof value ===
      "string" ||
    typeof value ===
      "number" ||
    typeof value ===
      "boolean"
  ) {
    return String(value);
  }

  if (
    typeof value ===
      "object" &&
    value._seconds !==
      undefined
  ) {
    return new Date(
      Number(
        value._seconds
      ) * 1000
    ).toISOString();
  }

  if (
    typeof value ===
      "object" &&
    value.seconds !==
      undefined
  ) {
    return new Date(
      Number(
        value.seconds
      ) * 1000
    ).toISOString();
  }

  try {
    return JSON.stringify(
      value
    );
  } catch {
    return "";
  }
}

function convertTimestamp(
  value
) {
  if (!value) {
    return null;
  }

  if (
    typeof value.toDate ===
    "function"
  ) {
    return value
      .toDate()
      .toISOString();
  }

  if (
    value instanceof Date
  ) {
    return value.toISOString();
  }

  if (
    value._seconds !==
    undefined
  ) {
    return new Date(
      Number(
        value._seconds
      ) * 1000
    ).toISOString();
  }

  if (
    value.seconds !==
    undefined
  ) {
    return new Date(
      Number(
        value.seconds
      ) * 1000
    ).toISOString();
  }

  if (
    typeof value ===
    "string"
  ) {
    const parsed =
      new Date(value);

    if (
      !Number.isNaN(
        parsed.getTime()
      )
    ) {
      return parsed.toISOString();
    }

    return value;
  }

  return null;
}

function getTimestamp(
  value
) {
  if (!value) {
    return 0;
  }

  if (
    typeof value.toDate ===
    "function"
  ) {
    return value
      .toDate()
      .getTime();
  }

  if (
    value instanceof Date
  ) {
    return value.getTime();
  }

  if (
    value._seconds !==
    undefined
  ) {
    return (
      Number(
        value._seconds
      ) * 1000
    );
  }

  if (
    value.seconds !==
    undefined
  ) {
    return (
      Number(
        value.seconds
      ) * 1000
    );
  }

  if (
    typeof value ===
    "string"
  ) {
    const parsed =
      new Date(value);

    if (
      !Number.isNaN(
        parsed.getTime()
      )
    ) {
      return parsed.getTime();
    }
  }

  return 0;
}

// ==========================================
// START SERVER
// ==========================================
const PORT = process.env.PORT || 5000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});