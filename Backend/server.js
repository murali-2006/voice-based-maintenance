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

const GEMINI_MODELS = [
  "gemini-3.5-flash",
  "gemini-3.7-flash",
  "gemini-flash-latest",
  "gemini-3.8-flash",
  "gemini-3.6-flash",
];

async function callGeminiWithFallback(contents, config = {}) {
  let lastErr = null;
  for (const modelName of GEMINI_MODELS) {
    try {
      const callPromise = ai.models.generateContent({
        model: modelName,
        contents,
        config,
      });
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Gemini API call timed out after 8s")), 8000)
      );
      const response = await Promise.race([callPromise, timeoutPromise]);
      if (response && response.text) {
        return { text: response.text, model: modelName };
      }
    } catch (err) {
      console.warn(
        `Gemini model ${modelName} unavailable or rate-limited (${err.message.slice(0, 80)}), trying next model...`
      );
      lastErr = err;
    }
  }
  throw lastErr || new Error("All Gemini candidate models failed");
}

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
// ==========================================
// OFFLINE SEMANTIC NORMALIZER (Thanglish / Indian English)
// ==========================================
function offlineSemanticNormalize(text) {
  if (!text || typeof text !== "string") return "";
  let norm = text.trim();

  // 1. Remove verbal fillers and hesitation
  norm = norm.replace(/\b(actually|like|okay|seri|aprom|then|so)\b/gi, "");
  norm = norm.replace(/\b(ah|um|uh)\b/gi, "");
  norm = norm.replace(/\s+/g, " ").trim();

  // 2. Standard context patterns for maintenance speech
  const contextPatterns = [
    {
      regex: /\b(?:intha|indha)\s+(?:machine\s+)?motor\s+(?:romba\s+)?heat\s+aaguthu\b/i,
      repl: "The machine motor is overheating."
    },
    {
      regex: /\b(?:machine\s+oda\s+)?bearing\s+la\s+abnormal\s+sound\s+varuthu\b/i,
      repl: "An abnormal sound is present in the machine bearing."
    },
    {
      regex: /\bpump\s+start\s+aagala[,\s]+(?:so\s+)?fuse\s+check\s+panni\s+replace\s+pannom\b/i,
      repl: "The pump was not starting, so the fuse was checked and replaced."
    },
    {
      regex: /\bcompressor\s+la\s+vibration\s+jasthi\s+irukku[,\s]+coupling\s+tighten\s+panniten\b/i,
      repl: "The compressor has excessive vibration, so the coupling was tightened."
    },
    {
      regex: /\b(?:intha|indha)\s+machine\s+yesterday\s+service\s+pannom[,\s]+but\s+innaiku\s+again\s+problem\s+vandhuruchu\b/i,
      repl: "This machine was serviced yesterday, but the problem occurred again today."
    },
    {
      regex: /\bmotor\s+overheating\s+aaguthu\s+and\s+oil\s+leakage\s*(?:um)?\s*irukku\b/i,
      repl: "The motor is overheating and an oil leakage is present."
    },
    {
      regex: /\bmotor\s+(?:abnormal\s+)?sound\s+varuthu[,\s]+bearing\s+check\s+pannanum\b/i,
      repl: "An abnormal sound is present in the motor; the bearing needs to be checked."
    },
    {
      regex: /\bmachine\s+service\s+panniten[,\s]+(?:ippo|epunomal|epu)\s*(?:normal)?\s*(?:ah)?\s+work\s+aaguthu\b/i,
      repl: "The machine was serviced and is now functioning normally."
    }
  ];

  for (const { regex, repl } of contextPatterns) {
    if (regex.test(norm)) return repl;
  }

  // 3. Phrasal normalization
  let res = norm
    .replace(/\bthe\s+anti[-_\s]?machine\b/gi, "the machine")
    .replace(/\banti[-_\s]?machine\b/gi, "the machine")
    .replace(/\bthe\s+entire\s+machine\s+problem\s+was\s+completely\s+fixed\b/gi, "the machine problem was completely fixed")
    .replace(/\bthe\s+anti[-_\s]?machine\s+problem\s+was\s+completely\s+fixed\b/gi, "the machine problem was completely fixed")
    .replace(/\b(?:intha|indha|antha|andha)\s+machine\b/gi, "the machine")
    .replace(/\bnon-temperature\s+sensor\b/gi, "temperature sensor")
    .replace(/\bADR[-_]?(?:Boojiam|Boogem)[^\s.,;]*\b/gi, "ADR-009")
    .replace(/\bCMP[-_]?(?:HIFAN|BOOGEM)[^\s.,;]*\b/gi, "CMP-004")
    .replace(/\btrending\s+condition\b/gi, "operating, but further observation is required")
    .replace(/\bwas\s+in\s+a\s+trending\s+condition\b/gi, "was operating, but further observation is required")
    .replace(/\bExistive\s+vibration\b/gi, "excessive vibration")
    .replace(/\b(?:your\s+)?manishavil\s+sound\b/gi, "an unusual sound")
    .replace(/\b(?:a-seq[,\s]+)?sekkumbothu\b/gi, "upon checking")
    .replace(/\baarnthu\b/gi, "was")
    .replace(/\bloose[,\s]+aarnthu\b/gi, "was loose")
    .replace(/\bso\s+coupling[,\s]+I\s+tightened\b/gi, "so the coupling was tightened")
    .replace(/\bmudichathukku\s+piragu\b/gi, "after completing the maintenance")
    .replace(/\bwork\s+aagudhu\b/gi, "operating normally")
    .replace(/\banoil\b/gi, "and oil")
    .replace(/\b(?:jam|um)\s+irukku\b/gi, "is present")
    .replace(/\bin aiku\b/gi, "today")
    .replace(/\binnaiku\b/gi, "Today")
    .replace(/\binspect\s+panninen\b/gi, "inspected")
    .replace(/\bmachine-a\b/gi, "the machine")
    .replace(/\bcoupling-a\b/gi, "the coupling")
    .replace(/\bkonjam\b/gi, "some")
    .replace(/\bunusual\s+sound\s*(?:um)?\s*irundhuchu\b/gi, "an unusual sound was present")
    .replace(/\birundhuchu\b/gi, "was present")
    .replace(/\bcheck\s+pannumbothu\b/gi, "upon checking,")
    .replace(/\bloose-ah\s+irundhuchu\b/gi, "was loose")
    .replace(/\bso\s+coupling-a\s+tighten\s+panninen\b/gi, "so the coupling was tightened")
    .replace(/\btighten\s+panninen\b/gi, "was tightened")
    .replace(/\bcondition-um\b/gi, "condition")
    .replace(/\bmudichathukku\s+apram\b/gi, "after completing")
    .replace(/\breduce\s+aayiduchu\b/gi, "was reduced")
    .replace(/\bfinal\s+inspection-la\b/gi, "during final inspection")
    .replace(/\bvera\s+endha\s+problem-um\s+observe\s+aagala\b/gi, "no other problems were observed")
    .replace(/\bobserve\s+aagala\b/gi, "observed")
    .replace(/\b(?:vannuruchu|problem vannuruchu)\b/gi, "the problem occurred again")
    .replace(/\bmachine\s+(?:oda|order)\b/gi, "the machine's")
    .replace(/\bbearinglar\b/gi, "in the bearing")
    .replace(/\b(?:intha|indha)\b/gi, "The")
    .replace(/\boverheating\s+aaguthu\b/gi, "is overheating")
    .replace(/\bheat\s+aaguthu\b/gi, "is overheating")
    .replace(/\babnormal\s+sound\s+varuthu\b/gi, "an abnormal sound is present")
    .replace(/\bsound\s+varuthu\b/gi, "an abnormal sound is present")
    .replace(/\bvibration\s+jasthi(?:\s+irukku)?\b/gi, "excessive vibration is present")
    .replace(/\bjasthi\s+irukku\b/gi, "is excessive")
    .replace(/\bstart\s+aagala\b/gi, "is not starting")
    .replace(/\bwork\s+aagala\b/gi, "is not functioning")
    .replace(/\bleak\s+aaguthu\b/gi, "is leaking")
    .replace(/\breplace\s+pannom\b/gi, "was replaced")
    .replace(/\btighten\s+panniten\b/gi, "was tightened")
    .replace(/\bcheck\s+panni\b/gi, "checked and")
    .replace(/\bcheck\s+pannom\b/gi, "was checked")
    .replace(/\bcheck\s+pannanum\b/gi, "needs to be checked")
    .replace(/\bcheck\s+panninom\b/gi, "was checked")
    .replace(/\bservice\s+pannom\b/gi, "was serviced")
    .replace(/\bservice\s+panniten\b/gi, "was serviced")
    .replace(/\bproblem\s+vandhuruchu\b/gi, "the problem occurred again")
    .replace(/\bnormal\s+ah\s+work\s+aaguthu\b/gi, "is functioning normally")
    .replace(/\babnormal\s+(?:ah\s+)?work\s+aaguthu\b/gi, "is functioning abnormally")
    .replace(/\boil\s+leakage\s*(?:um|jam)?\s*irukku\b/gi, "oil leakage is present")
    .replace(/\bla\b/gi, "in the")
    .replace(/\bippo\b/gi, "now");

  // Clean spacing and punctuation
  res = res.replace(/[,\s]{2,}/g, ", ").replace(/\s+/g, " ").trim();
  res = deduplicateRepeatedSentences(res);
  if (res && !/[.!?]$/.test(res)) res += ".";
  return res.charAt(0).toUpperCase() + res.slice(1);
}

function deduplicateRepeatedSentences(text) {
  if (!text || typeof text !== "string") return "";
  let cleaned = text.trim();
  cleaned = cleaned.replace(/([^\n.!?]{8,}?)(?:[,\s]+\1){1,}/gi, "$1");
  const parts = cleaned.split(/(?<=[.!?\n])\s+/);
  const seen = [];
  for (const p of parts) {
    const pClean = p.trim();
    if (!pClean) continue;
    const pNorm = pClean.replace(/[^\w\s]/g, "").toLowerCase();
    if (seen.length === 0) {
      seen.push(pClean);
    } else {
      const prevNorm = seen[seen.length - 1].replace(/[^\w\s]/g, "").toLowerCase();
      if (pNorm !== prevNorm) {
        seen.push(pClean);
      }
    }
  }
  let res = seen.join(" ").trim();
  res = res.replace(/(\S+)(?:\s+\1){2,}/gi, "$1");
  return res.trim();
}

function isTranscriptRepetitive(text) {
  if (!text || !text.trim()) return false;
  const words = text.toLowerCase().match(/\b\w+\b/g) || [];
  if (words.length >= 4) {
    const counts = {};
    for (const w of words) counts[w] = (counts[w] || 0) + 1;
    const maxCount = Math.max(...Object.values(counts));
    if (maxCount / words.length > 0.40) return true;
  }
  if (/(.)\1{4,}/.test(text)) return true;
  if (words.length >= 6) {
    const unique = new Set(words);
    if (unique.size / words.length < 0.25) return true;
  }
  return false;
}

// ==========================================
// VALIDATE GEMINI REPORT OUTPUT
// ==========================================
function isValidGeminiReport(reportString) {
  if (!reportString || typeof reportString !== "string") return false;
  const s = reportString.trim();
  if (s.length < 20) return false;
  if (/^(\[|\{)/.test(s)) return false;
  if (/^(error|exception|failed|null|undefined)/i.test(s)) return false;
  if (isTranscriptRepetitive(s)) return false;

  // Reject malformed comma-separated token fragments without sentence periods
  const commaCount = (s.match(/,/g) || []).length;
  const periodCount = (s.match(/\./g) || []).length;
  if (commaCount > 8 && periodCount === 0) return false;

  return true;
}

// ==========================================
// EXTRACT REPORT FIELDS FROM FINAL CLEANED REPORT (GENERIC)
// ==========================================
function extractFieldsFromCleanedReport(reportText, preExtracted = {}) {
  let problem = (preExtracted.problem || "").trim();
  let solution = (preExtracted.solution || "").trim();
  let status = preExtracted.maintenance_status || "Completed";
  let maintenanceTime = preExtracted.maintenance_time || "";

  // Clean obvious speech/translation artifacts
  const cleanArtifacts = (str) => {
    return (str || "")
      .replace(/\bthe\s+anti[-_\s]?machine\b/gi, "the machine")
      .replace(/\banti[-_\s]?machine\b/gi, "the machine")
      .replace(/\bthe\s+entire\s+machine\s+problem\s+was\s+completely\s+fixed\b/gi, "the machine problem was completely fixed")
      .replace(/\bthe\s+anti[-_\s]?machine\s+problem\s+was\s+completely\s+fixed\b/gi, "the machine problem was completely fixed")
      .replace(/\bnon-temperature\s+sensor\b/gi, "temperature sensor")
      .trim();
  };

  problem = cleanArtifacts(problem);
  solution = cleanArtifacts(solution);

  const text = (reportText || "").trim();
  const lower = text.toLowerCase();

  // Determine status generically
  if (
    lower.includes("further observation is required") ||
    lower.includes("further observation") ||
    lower.includes("under observation") ||
    lower.includes("needs observation") ||
    lower.includes("trending condition")
  ) {
    status = "Operating - Further Observation Required";
  } else if (
    lower.includes("completely fixed") ||
    lower.includes("completely resolved") ||
    lower.includes("resolved") ||
    lower.includes("completely repaired") ||
    lower.includes("repaired") ||
    lower.includes("operating normally") ||
    lower.includes("completed")
  ) {
    status = "Completed";
  }

  // Duration extraction
  const timeMatch = text.match(/\b(\d+\s*(?:hours?|hrs?|minutes?|mins?))\b/i);
  if (timeMatch && !maintenanceTime) {
    maintenanceTime = timeMatch[1];
  }

  // Check if preExtracted problem/solution are generic, uninformative, or missing
  const isGenericProblem =
    !problem ||
    problem === "Equipment anomaly" ||
    problem === "Problem occurred" ||
    problem.length < 5 ||
    /not specified|none reported|unknown|n\/a/i.test(problem);

  const isGenericSolution =
    !solution ||
    solution === "Maintenance performed" ||
    solution === "Component inspected and replaced." ||
    solution.length < 5 ||
    /not specified|none reported|unknown|n\/a/i.test(solution);

  // If both are already specific, return them
  if (!isGenericProblem && !isGenericSolution) {
    return {
      problem,
      solution,
      maintenance_status: status,
      maintenance_time: maintenanceTime,
    };
  }

  // Generic sentence-level extraction from the cleaned report text
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const problemKeywords = [
    "malfunction",
    "pressure drop",
    "temperature fluctuation",
    "vibration",
    "unusual sound",
    "abnormal sound",
    "sound",
    "noise",
    "overheating",
    "overheat",
    "heat",
    "oil leakage",
    "leakage",
    "leak",
    "loose",
    "damaged",
    "defect",
    "broken",
    "fault",
    "failure",
    "not starting",
    "not functioning",
    "problem",
    "issue",
  ];

  if (isGenericProblem) {
    const problemSentences = [];
    for (const s of sentences) {
      const sLower = s.toLowerCase();
      const hasProblemKeyword = problemKeywords.some((k) => sLower.includes(k));
      const isNegative =
        sLower.includes("no other issues") ||
        sLower.includes("no other problems") ||
        sLower.includes("problem was completely fixed") ||
        sLower.includes("problem resolved");
      if (hasProblemKeyword && !isNegative) {
        problemSentences.push(s);
      }
    }

    if (problemSentences.length > 0) {
      let combinedProblem = problemSentences.slice(0, 2).join(" ");
      combinedProblem = cleanArtifacts(combinedProblem);
      if (combinedProblem) {
        problem = combinedProblem;
      }
    } else {
      problem = "Equipment anomaly detected during inspection.";
    }
  }

  if (isGenericSolution) {
    const actionSentences = [];
    for (const s of sentences) {
      const sLower = s.toLowerCase();
      if (
        sLower.includes("machine was operating") ||
        sLower.includes("further observation is required") ||
        sLower.includes("no other issues")
      ) {
        continue;
      }
      const hasCorrective = /\b(replaced|tightened|secured|repaired|adjusted|tested|lubricated|serviced)\b/i.test(sLower);
      const hasInspect = /\b(inspected|checked|monitored)\b/i.test(sLower);
      if (hasCorrective || hasInspect) {
        actionSentences.push({ text: s, priority: hasCorrective ? 2 : 1 });
      }
    }

    actionSentences.sort((a, b) => b.priority - a.priority);

    if (actionSentences.length > 0) {
      const chosen = actionSentences.slice(0, 2).map((a) => a.text).join(" ");
      solution = cleanArtifacts(chosen);
    } else {
      solution = "Maintenance and inspection performed.";
    }
  }

  return {
    problem: cleanArtifacts(problem) || "Equipment anomaly detected during inspection.",
    solution: cleanArtifacts(solution) || "Maintenance performed.",
    maintenance_status: status,
    maintenance_time: maintenanceTime,
  };
}

// ==========================================
// GENERIC SAFE FALLBACK GENERATOR
// ==========================================
function generateGenericSafeFallback(inputText, authoritativeCode, authoritativeName) {
  let cleaned = offlineSemanticNormalize(inputText || "");

  // Clean obvious speech recognition artifacts
  cleaned = cleaned
    .replace(/\bthe\s+anti[-_\s]?machine\b/gi, "the machine")
    .replace(/\banti[-_\s]?machine\b/gi, "the machine")
    .replace(/\bthe\s+entire\s+machine\s+problem\s+was\s+completely\s+fixed\b/gi, "the machine problem was completely fixed")
    .replace(/\bthe\s+anti[-_\s]?machine\s+problem\s+was\s+completely\s+fixed\b/gi, "the machine problem was completely fixed")
    .replace(/\bnon-temperature\s+sensor\b/gi, "temperature sensor")
    .replace(/\btrending\s+condition\b/gi, "operating, but further observation is required")
    .replace(/\bwas\s+in\s+a\s+trending\s+condition\b/gi, "was operating, but further observation is required");

  // Preserve authoritative machine identity accurately if provided
  if (authoritativeCode) {
    cleaned = cleaned
      .replace(/\bADR[-_]?(?:Boojiam|Boogem)[^\s.,;]*\b/gi, authoritativeCode)
      .replace(/\bCMP[-_]?(?:HIFAN|BOOGEM)[^\s.,;]*\b/gi, authoritativeCode)
      .replace(/\bHPR[-_]?(?:Boojiam|Boogem)[^\s.,;]*\b/gi, authoritativeCode)
      .replace(/\bPMP[-_]?(?:1-?2|Boojiam)[^\s.,;]*\b/gi, authoritativeCode);
  }

  // Preserve uncertain status and final inspection observation
  const hasObservation =
    /further observation (?:is )?required|under observation|needs observation/i.test(inputText) ||
    /further observation (?:is )?required|under observation|needs observation/i.test(cleaned);

  if (hasObservation) {
    cleaned = cleaned.replace(
      /(?:During (?:the )?final inspection[,\s]*)?(?:the machine was in a trending condition|the machine remained under observation|the machine was operating normally(?:, and no other issues were observed)?)\.?/gi,
      "During the final inspection, the machine was operating, but further observation is required."
    );
    if (!/operating[,\s]+but further observation is required/i.test(cleaned)) {
      cleaned = cleaned.replace(
        /\.?$/,
        ". During the final inspection, the machine was operating, but further observation is required."
      );
    }
  }

  cleaned = deduplicateRepeatedSentences(cleaned);
  cleaned = cleaned.replace(/[,\s]{2,}/g, ", ").replace(/\s+/g, " ").trim();
  if (cleaned && !/[.!?]$/.test(cleaned)) {
    cleaned += ".";
  }
  if (cleaned) {
    cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  }

  const detectedCode = authoritativeCode || ((inputText.match(/\b([A-Z]{2,4}-?\d{2,4})\b/i) || [])[1] || "").toUpperCase();
  const extracted = extractFieldsFromCleanedReport(cleaned, {
    maintenance_status: hasObservation ? "Operating - Further Observation Required" : "Completed",
  });

  return {
    cleaned_report: cleaned,
    report: cleaned,
    detected_machine: authoritativeCode || detectedCode || "",
    problem: extracted.problem,
    solution: extracted.solution,
    maintenance_status: extracted.maintenance_status,
    maintenance_time: extracted.maintenance_time,
  };
}

// ==========================================
// CLEAN & PROFESSIONALIZE MAINTENANCE REPORT
// ==========================================
app.post("/clean-report", async (req, res) => {
  try {
    const {
      text,
      original_text,
      is_code_mixed,
      authoritative_machine_code,
      authoritative_machine_name,
    } = req.body;
    const inputText = (text || original_text || "").trim();

    if (!inputText) {
      return res.status(400).json({
        success: false,
        stage: "transcription",
        message: "Text is required for cleanup",
      });
    }

    const machineContext = authoritative_machine_code
      ? `AUTHORITATIVE MACHINE IDENTITY:
- Machine Name: "${authoritative_machine_name || authoritative_machine_code}"
- Machine Code: "${authoritative_machine_code}"
- You MUST preserve "${authoritative_machine_code}" as the machine code and "${authoritative_machine_name || authoritative_machine_code}" as the machine name. Never alter, guess, or replace with speech recognition errors or hallucinations.\n`
      : "";

    let isAiFallback = false;
    let finalReport = "";
    let finalProblem = "";
    let finalSolution = "";
    let parsedStatus = "Completed";
    let maintenanceTime = "";
    let detectedMachine = authoritative_machine_code || "";
    let modelUsed = "";

    // Attempt Gemini cleanup
    try {
      const prompt = `
You are an expert bilingual industrial maintenance report editor and technical translator.
Clean, translate, and professionalize this raw speech transcript into a fluent, professional English maintenance log.

${machineContext}
RAW TRANSCRIPT TO CLEAN & TRANSLATE:
"${inputText}"

CRITICAL INSTRUCTIONS & RULES:
1. STRICT MACHINE IDENTITY PRESERVATION:
   ${authoritative_machine_code ? `- The machine code MUST strictly remain "${authoritative_machine_code}" and machine name MUST remain "${authoritative_machine_name || authoritative_machine_code}".
   - Output "${authoritative_machine_code}" exactly in "detected_machine".` : "- Preserve the machine code and name accurately without hallucinations."}

2. STRICT TECHNICAL COMPONENT NAMES:
   - Technical component names such as "temperature sensor", "pressure valve", "control wiring", and "display panel" MUST be strictly preserved.
   - If the transcript says "non-temperature sensor", correct it to "temperature sensor".

3. STRICT PRESERVATION OF UNCERTAIN STATUS & FINAL INSPECTION:
   - Uncertain statuses such as "further observation is required" MUST be strictly preserved.
   - NEVER convert "further observation is required" into "normal", "resolved", "fixed", "operating normally", or unrelated phrases.
   - If the speech states that further observation is required or monitoring is ongoing, the final status MUST explicitly indicate that the machine is operating but further observation is required.
     Example final sentence: "During the final inspection, the machine was operating, but further observation is required."
   - In "maintenance_status", output "Operating - Further Observation Required" when observation is required.

4. TRANSLATE MEANING, NOT WORDS:
   - Translate colloquial Thanglish or Tamil into clear, natural, professional technical English:
     * "anti-machine" / "antha machine" / "the anti-machine" -> "the machine" or "machine" (e.g., "The anti-machine problem was completely fixed." -> "The machine problem was completely fixed.")

5. STAGE GOAL - 100% ENGLISH ONLY:
   - The final "cleaned_report" MUST BE STRICTLY 100% ENGLISH.

6. PRESERVE EXACT LEVEL OF CERTAINTY:
   - Strictly preserve the exact level of certainty from the engineer's speech.
   - NEVER upgrade: "reduced" -> "resolved", "improved" -> "fixed", "lessened" -> "eliminated".

7. CAUSALITY RULE:
   - Never infer or state a cause unless the engineer explicitly states it.
   - When the engineer states a cause, preserve and extract it accurately.
   - In "problem": State the problem and confirmed cause if stated.
   - In "solution": Include all meaningful actions taken. Never leave problem or solution empty when reported.

8. OUTPUT FORMAT:
   Return ONLY a valid JSON object matching this schema:
   {
     "cleaned_report": "A cohesive, professional English paragraph strictly faithful to the engineer's exact words.",
     "detected_machine": "${authoritative_machine_code || ""}",
     "problem": "...",
     "solution": "...",
     "maintenance_status": "Completed or Operating - Further Observation Required"
   }
`;

      const response = await callGeminiWithFallback(prompt, {
        responseMimeType: "application/json",
      });

      const resultText = response && response.text;
      if (resultText) {
        const parsed = JSON.parse(resultText);
        let candidateReport = (parsed.cleaned_report || "").trim();

        if (isValidGeminiReport(candidateReport)) {
          modelUsed = response.model || "gemini";
          detectedMachine = authoritative_machine_code || parsed.detected_machine || "";
          finalProblem = parsed.problem || "";
          finalSolution = parsed.solution || "";
          parsedStatus = parsed.maintenance_status || "Completed";

          // Clean obvious transcription/translation artifacts
          candidateReport = candidateReport
            .replace(/\bthe\s+anti[-_\s]?machine\b/gi, "the machine")
            .replace(/\banti[-_\s]?machine\b/gi, "the machine")
            .replace(/\bthe\s+entire\s+machine\s+problem\s+was\s+completely\s+fixed\b/gi, "the machine problem was completely fixed")
            .replace(/\bthe\s+anti[-_\s]?machine\s+problem\s+was\s+completely\s+fixed\b/gi, "the machine problem was completely fixed")
            .replace(/\bnon-temperature\s+sensor\b/gi, "temperature sensor")
            .replace(/\btrending\s+condition\b/gi, "operating, but further observation is required")
            .replace(/\bwas\s+in\s+a\s+trending\s+condition\b/gi, "was operating, but further observation is required");

          if (authoritative_machine_code) {
            candidateReport = candidateReport
              .replace(/\bADR[-_]?(?:Boojiam|Boogem)[^\s.,;]*\b/gi, authoritative_machine_code)
              .replace(/\bCMP[-_]?(?:HIFAN|BOOGEM)[^\s.,;]*\b/gi, authoritative_machine_code)
              .replace(/\bHPR[-_]?(?:Boojiam|Boogem)[^\s.,;]*\b/gi, authoritative_machine_code);
          }

          const hasObservation =
            /further observation (?:is )?required|under observation|needs observation/i.test(inputText) ||
            /further observation (?:is )?required|under observation|needs observation/i.test(candidateReport);

          if (hasObservation) {
            candidateReport = candidateReport.replace(
              /(?:During (?:the )?final inspection[,\s]*)?(?:the machine was in a trending condition|the machine remained under observation|the machine was operating normally(?:, and no other issues were observed)?)\.?/gi,
              "During the final inspection, the machine was operating, but further observation is required."
            );
            if (!/operating[,\s]+but further observation is required/i.test(candidateReport)) {
              candidateReport = candidateReport.replace(
                /\.?$/,
                ". During the final inspection, the machine was operating, but further observation is required."
              );
            }
            parsedStatus = "Operating - Further Observation Required";
          }

          candidateReport = deduplicateRepeatedSentences(candidateReport);
          finalReport = candidateReport;
        } else {
          console.warn("[CLEAN-REPORT] Gemini output failed validity check, activating generic fallback.");
          isAiFallback = true;
        }
      } else {
        isAiFallback = true;
      }
    } catch (aiError) {
      console.warn("[CLEAN-REPORT] Gemini models unavailable or rate-limited (HTTP 429), activating generic fallback:", aiError.message);
      isAiFallback = true;
    }

    // If Gemini failed or output was invalid, use the generic safe fallback
    if (isAiFallback || !finalReport) {
      const fallbackObj = generateGenericSafeFallback(
        inputText,
        authoritative_machine_code,
        authoritative_machine_name
      );
      finalReport = fallbackObj.cleaned_report;
      detectedMachine = fallbackObj.detected_machine;
      finalProblem = fallbackObj.problem;
      finalSolution = fallbackObj.solution;
      parsedStatus = fallbackObj.maintenance_status;
      maintenanceTime = fallbackObj.maintenance_time;
    }

    // Extract / refine fields from the final report text
    const extractedFields = extractFieldsFromCleanedReport(finalReport, {
      problem: finalProblem,
      solution: finalSolution,
      maintenance_status: parsedStatus,
      maintenance_time: maintenanceTime,
    });

    return res.json({
      success: true,
      ai_fallback: isAiFallback,
      report: finalReport,
      cleaned_report: finalReport,
      detected_machine: authoritative_machine_code || detectedMachine,
      problem: extractedFields.problem,
      solution: extractedFields.solution,
      maintenance_status: extractedFields.maintenance_status,
      maintenance_time: extractedFields.maintenance_time,
      is_code_mixed: Boolean(is_code_mixed),
      model_used: isAiFallback ? "local_semantic_fallback" : modelUsed,
      message: isAiFallback
        ? "Report processed using local semantic engine (AI fallback)."
        : "Report professionalized with Gemini AI.",
    });
  } catch (error) {
    console.error("Report cleanup error:", error);
    res.status(500).json({
      success: false,
      stage: "backend",
      message: "Report processing failed.",
      error: error.message,
    });
  }
});

// ==========================================
// ANALYZE ENGLISH MAINTENANCE REPORT
// ==========================================
app.post("/analyze-report", async (req, res) => {
  try {
    const { report, problem, solution, maintenance_status } = req.body;

    if (!report || !report.trim()) {
      return res.status(400).json({
        message: "English report is required",
      });
    }

    const cleanedInputReport = report
      .replace(/\bthe\s+anti[-_\s]?machine\b/gi, "the machine")
      .replace(/\banti[-_\s]?machine\b/gi, "the machine")
      .replace(/\bthe\s+entire\s+machine\s+problem\s+was\s+completely\s+fixed\b/gi, "the machine problem was completely fixed")
      .replace(/\bthe\s+anti[-_\s]?machine\s+problem\s+was\s+completely\s+fixed\b/gi, "the machine problem was completely fixed");

    let cleanProblem = (problem || "")
      .replace(/\bthe\s+anti[-_\s]?machine\b/gi, "the machine")
      .replace(/\banti[-_\s]?machine\b/gi, "the machine")
      .replace(/\bthe\s+entire\s+machine\s+problem\s+was\s+completely\s+fixed\b/gi, "the machine problem was completely fixed")
      .replace(/\bthe\s+anti[-_\s]?machine\s+problem\s+was\s+completely\s+fixed\b/gi, "the machine problem was completely fixed")
      .trim();

    let cleanSolution = (solution || "")
      .replace(/\bthe\s+anti[-_\s]?machine\b/gi, "the machine")
      .replace(/\banti[-_\s]?machine\b/gi, "the machine")
      .replace(/\bthe\s+entire\s+machine\s+problem\s+was\s+completely\s+fixed\b/gi, "the machine problem was completely fixed")
      .replace(/\bthe\s+anti[-_\s]?machine\s+problem\s+was\s+completely\s+fixed\b/gi, "the machine problem was completely fixed")
      .trim();

    // Check if pre-extracted problem & solution are specific and non-generic
    const isGenericProb = !cleanProblem || cleanProblem === "Equipment anomaly" || /not specified/i.test(cleanProblem);
    const isGenericSol = !cleanSolution || cleanSolution === "Maintenance performed" || solution === "Component inspected and replaced." || /not specified/i.test(cleanSolution);

    if (!isGenericProb && !isGenericSol && maintenance_status) {
      return res.json({
        success: true,
        analysis: {
          problem: cleanProblem,
          solution: cleanSolution,
          maintenance_status,
          maintenance_time: "",
        },
      });
    }

    try {
      const response = await callGeminiWithFallback(
        `
Analyze this English industrial maintenance report.

Extract only these fields:
{
  "problem": "",
  "solution": "",
  "maintenance_status": "",
  "maintenance_time": ""
}

STRICT ANALYSIS RULES:
1. FAITHFUL PROBLEM & CAUSALITY EXTRACTION:
   - When the report explicitly states a problem and cause (e.g. "Machine malfunction and pressure drop caused by a damaged pressure valve"), extract that faithfully into "problem".
   - Never leave "problem" empty when a problem is clearly described.
   - Do not infer causes that are not explicitly stated.
2. COMPLETE MAINTENANCE SOLUTION:
   - Extract the specific maintenance actions into "solution" (e.g. "Replaced the damaged pressure valve and tested the system pressure").
   - Never leave "solution" empty when maintenance actions are described.
3. PRESERVE TECHNICAL COMPONENT NAMES:
   - Component names such as "temperature sensor", "pressure valve", "coupling", etc. MUST be strictly preserved.
   - Non-temperature sensor must be corrected to temperature sensor.
4. PRESERVE EXACT LEVEL OF CERTAINTY & UNCERTAIN STATUS:
   - Never upgrade "reduced" to "resolved", "fixed", or "eliminated".
   - If the report states that "further observation is required" or the machine is operating under observation:
     maintenance_status MUST be: "Operating - Further Observation Required".
   - If the problem was completely fixed/resolved, maintenance_status MUST be: "Completed".
5. MAINTENANCE TIME:
   - maintenance_time MUST remain empty ("") if the engineer did not explicitly mention a duration. Never invent a maintenance duration.
6. CLEAN SPEECH ARTIFACTS:
   - Speech artifacts such as "anti-machine" must be translated to "machine".

Maintenance report:
${cleanedInputReport}
`,
        { responseMimeType: "application/json" }
      );

      const resultText = response.text;
      if (resultText) {
        const analysis = JSON.parse(resultText);
        const extracted = extractFieldsFromCleanedReport(cleanedInputReport, {
          problem: analysis.problem,
          solution: analysis.solution,
          maintenance_status: analysis.maintenance_status,
          maintenance_time: analysis.maintenance_time,
        });

        return res.json({
          success: true,
          analysis: {
            problem: extracted.problem,
            solution: extracted.solution,
            maintenance_status: extracted.maintenance_status,
            maintenance_time: extracted.maintenance_time,
          },
        });
      }
    } catch (aiErr) {
      console.warn("Gemini analyze failed/rate-limited, using extraction from cleaned report:", aiErr.message);
    }

    // Heuristic extraction based directly on the final cleaned professional report
    const fallbackAnalysis = extractFieldsFromCleanedReport(cleanedInputReport, {
      problem: cleanProblem,
      solution: cleanSolution,
      maintenance_status,
    });

    return res.json({
      success: true,
      analysis: {
        problem: fallbackAnalysis.problem,
        solution: fallbackAnalysis.solution,
        maintenance_status: fallbackAnalysis.maintenance_status,
        maintenance_time: fallbackAnalysis.maintenance_time,
      },
    });
  } catch (error) {
    console.error("Report analysis error:", error);
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
            machineData.machine_code ||
            req.body.machine_code ||
            "",

          machine_name:
            machineData.machine_name ||
            req.body.machine_name ||
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

          source_type:
            String(
              req.body.source_type || "microphone"
            ),

          is_code_mixed:
            Boolean(
              req.body.is_code_mixed
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

// ======================================================
// READ-ONLY NATURAL LANGUAGE MAINTENANCE RECORD SEARCH
// Converts natural language/voice query to structured
// parameters via Gemini, queries Firestore maintenance_reports,
// and returns ONLY requested details based on actual data.
// ======================================================
function formatDisplayDate(dateVal) {
  if (!dateVal) return "Date not available";
  try {
    const d = new Date(dateVal);
    if (isNaN(d.getTime())) return "Date not available";
    const day = d.getDate();
    const months = [
      "Jan", "Feb", "Mar", "Apr", "May", "Jun",
      "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
    ];
    const month = months[d.getMonth()];
    const year = d.getFullYear();
    return `${day} ${month} ${year}`;
  } catch {
    return "Date not available";
  }
}

// ------------------------------------------------------
// DOMAIN SPELLING CORRECTION & NORMALIZATION (SECTION 2, 13)
// ------------------------------------------------------
function normalizeAndCorrectSpelling(text) {
  if (!text || typeof text !== "string") return "";
  let s = text;

  const corrections = [
    // Machine words & variations
    [/\bmachne\b/gi, "machine"],
    [/\bmashine\b/gi, "machine"],
    [/\bmchine\b/gi, "machine"],
    [/\bmachin\b/gi, "machine"],
    [/\bhydralic\b/gi, "hydraulic"],
    [/\bhydroulic\b/gi, "hydraulic"],
    [/\bhydrallic\b/gi, "hydraulic"],
    [/\bhydrolic\b/gi, "hydraulic"],
    [/\bcompresor\b/gi, "compressor"],
    [/\bcompreser\b/gi, "compressor"],
    [/\bconveor\b/gi, "conveyor"],
    [/\bconvyer\b/gi, "conveyor"],
    [/\bconveyer\b/gi, "conveyor"],

    // Component words & variations
    [/\bbearng\b/gi, "bearing"],
    [/\bbaering\b/gi, "bearing"],
    [/\bbering\b/gi, "bearing"],
    [/\bcouping\b/gi, "coupling"],
    [/\bcouplin\b/gi, "coupling"],
    [/\bcupling\b/gi, "coupling"],
    [/\bpresure\b/gi, "pressure"],
    [/\bpresur\b/gi, "pressure"],
    [/\bvalv\b/gi, "valve"],
    [/\bvalev\b/gi, "valve"],
    [/\bsensr\b/gi, "sensor"],
    [/\bsenzor\b/gi, "sensor"],
    [/\balison\b/gi, "allison"],
    [/\btemperatue\b/gi, "temperature"],
    [/\btemprature\b/gi, "temperature"],
    [/\bproximty\b/gi, "proximity"],

    // Action & condition words
    [/\bfailur\b/gi, "failure"],
    [/\bfalure\b/gi, "failure"],
    [/\bleakge\b/gi, "leakage"],
    [/\bleackage\b/gi, "leakage"],
    [/\bleakege\b/gi, "leakage"],
    [/\bleekage\b/gi, "leakage"],
    [/\bleakag\b/gi, "leakage"],
    [/\breplced\b/gi, "replaced"],
    [/\breplacd\b/gi, "replaced"],
    [/\brelpaced\b/gi, "replaced"],
    [/\brepalced\b/gi, "replaced"],
    [/\breplacment\b/gi, "replacement"],
    [/\brepalcement\b/gi, "replacement"],
    [/\bvibraton\b/gi, "vibration"],
    [/\bvibretion\b/gi, "vibration"],
    [/\btigtened\b/gi, "tightened"],
    [/\btightend\b/gi, "tightened"],
    [/\btigten\b/gi, "tightened"],
    [/\blubricat\b/gi, "lubricated"],
    [/\blubricashun\b/gi, "lubricated"],
    [/\binspcted\b/gi, "inspected"],
    [/\boverheting\b/gi, "overheating"],
  ];

  for (const [pattern, rep] of corrections) {
    s = s.replace(pattern, rep);
  }

  return s;
}

function localFallbackParse(query) {
  const normalized = normalizeAndCorrectSpelling((query || "").trim());
  const qLower = normalized.toLowerCase();

  let machine_identifier = null;
  const conditions = {
    problem: [],
    solution: [],
    status: [],
    component: [],
  };
  const maintenance_conditions = [];
  const requested_fields = [];
  let is_latest_only = false;
  let needs_clarification = false;
  let clarification_message = "";

  // 1. Ambiguous Query Check (e.g. "show me sensor records" without machine or specific sensor/action)
  const isGenericSensorOnly =
    /(^|\b)(show\s+me\s+)?(the\s+)?sensor\s+records?(\b|$)/i.test(qLower) ||
    (qLower.includes("sensor") &&
      !/\b([A-Z]{2,4}[-_]?[0-9]{2,4})\b/i.test(qLower) &&
      !/allison|temperature|proximity|pressure|vibration|oil|bearing|valve|failure|failed|replaced/i.test(qLower) &&
      !/cnc|hydraulic|conveyor|compressor|dryer|pump|lathe/i.test(qLower));

  if (isGenericSensorOnly) {
    return {
      normalized_query: normalized,
      machine_identifier: null,
      machine_condition: null,
      conditions,
      maintenance_conditions: [],
      requested_fields: [],
      is_latest_only: false,
      needs_clarification: true,
      clarification_message: "Please specify the machine or sensor name.",
    };
  }

  // 2. Machine Extraction
  const isAllMachinesQuery = /\b(all\s+machines|every\s+machine|machines\s+that)\b/i.test(qLower);
  let is_category_search = false;

  if (!isAllMachinesQuery) {
    if (/\b(all\s+cnc(\s+machines?)?|any\s+cnc\s+machine|cnc\s+machines|cnc\s+category)\b/i.test(qLower)) {
      is_category_search = true;
      machine_identifier = "CNC";
    } else if (/\b(all\s+compressors?|compressors)\b/i.test(qLower)) {
      is_category_search = true;
      machine_identifier = "Compressor";
    } else if (/\b(all\s+hydraulic\s+presses?|hydraulic\s+presses)\b/i.test(qLower)) {
      is_category_search = true;
      machine_identifier = "Hydraulic Press";
    } else if (/\b(all\s+conveyors?|conveyor\s+systems)\b/i.test(qLower)) {
      is_category_search = true;
      machine_identifier = "Conveyor System";
    } else {
      const codeMatch = normalized.match(/\b([A-Z]{2,4}[-_]?[0-9]{2,4})\b/i);
      if (codeMatch) {
        machine_identifier = codeMatch[1].toUpperCase();
      } else if (/cnc\s+milling(\s+machine)?/i.test(qLower)) {
        machine_identifier = "CNC Milling Machine";
      } else if (/cnc\s+machine|\bcnc\b/i.test(qLower)) {
        machine_identifier = "CNC Machine";
      } else if (/hydraulic\s+press|\bhpr\b|\bhyd\b/i.test(qLower)) {
        machine_identifier = "Hydraulic Press";
      } else if (/conveyor\s+system|\bconveyor\b/i.test(qLower)) {
        machine_identifier = "Conveyor System";
      } else if (/reciprocating\s+compressor/i.test(qLower)) {
        machine_identifier = "Industrial Reciprocating Compressor";
      } else if (/air\s+compressor|\bcompressor\b/i.test(qLower)) {
        machine_identifier = "Industrial Air Compressor";
      } else if (/air\s+dryer|\bdryer\b/i.test(qLower)) {
        machine_identifier = "Industrial Air Dryer";
      } else if (/centrifugal\s+pump|\bpump\b/i.test(qLower)) {
        machine_identifier = "Centrifugal Water Pump";
      } else if (/lathe/i.test(qLower)) {
        machine_identifier = "High-Speed Lathe";
      }
    }
  }

  // 3. Problem / Condition Extraction (Multi-word preserved)
  if (/sensor\s+(fail(ure|ed|ing)?|fault|issue|problem)/i.test(qLower) || /fail(ed|ure)?\s+sensor/i.test(qLower)) {
    conditions.problem.push("sensor failure");
    maintenance_conditions.push("sensor failure");
  }

  if (/oil\s+leak(age|ing|s)?/i.test(qLower)) {
    conditions.problem.push("oil leakage");
    maintenance_conditions.push("oil leakage");
  }

  if (/motor\s+overheat(ing|ed)?|overheat(ing|ed)?/i.test(qLower)) {
    conditions.problem.push("motor overheating");
    maintenance_conditions.push("motor overheating");
  }

  if (/bearing\s+noise|abnormal\s+sound|bearing\s+sound/i.test(qLower)) {
    conditions.problem.push("bearing noise");
    maintenance_conditions.push("bearing noise");
  }

  if (/conveyor\s+belt\s+slipping|belt\s+slipping|belt\s+slip/i.test(qLower)) {
    conditions.problem.push("conveyor belt slipping");
    maintenance_conditions.push("conveyor belt slipping");
  }

  if (/hydraulic\s+pressure\s+low|low\s+hydraulic\s+pressure|low\s+pressure|pressure\s+drop/i.test(qLower)) {
    conditions.problem.push("hydraulic pressure low");
    maintenance_conditions.push("hydraulic pressure low");
  }

  if (/temperature\s+fluctuat(ion|ing)?/i.test(qLower)) {
    conditions.problem.push("temperature fluctuation");
    maintenance_conditions.push("temperature fluctuation");
  }

  if (/high\s+discharge\s+pressure/i.test(qLower)) {
    conditions.problem.push("high discharge pressure");
    maintenance_conditions.push("high discharge pressure");
  }

  if (/electrical\s+fault/i.test(qLower)) {
    conditions.problem.push("electrical fault");
    maintenance_conditions.push("electrical fault");
  }

  if (/vibration|excessive\s+vibration/i.test(qLower)) {
    if (!conditions.problem.includes("vibration") && !maintenance_conditions.includes("vibration")) {
      conditions.problem.push("vibration");
      maintenance_conditions.push("vibration");
    }
  }

  // 4. Solution / Action Extraction (Multi-word preserved)
  if (/sensor\s+(was\s+)?(replace(d|ment)?|change(d)?)/i.test(qLower) || /(replace(d|ment)?|change(d)?)\s+(the\s+)?sensor/i.test(qLower)) {
    conditions.solution.push("sensor replaced");
    if (!maintenance_conditions.includes("sensor replaced")) {
      maintenance_conditions.push("sensor replaced");
    }
  }

  if (/oil\s+(was\s+)?(replace(d|ment)?|change(d)?)/i.test(qLower) || /(replace(d|ment)?|change(d)?)\s+(the\s+)?oil/i.test(qLower)) {
    conditions.solution.push("oil replaced");
    if (!maintenance_conditions.includes("oil replaced")) {
      maintenance_conditions.push("oil replaced");
    }
  }

  if (/bearing\s+(was\s+)?(replace(d|ment)?|change(d)?)/i.test(qLower) || /(replace(d|ment)?|change(d)?)\s+(the\s+)?bearing/i.test(qLower)) {
    conditions.solution.push("bearing replaced");
    if (!maintenance_conditions.includes("bearing replaced")) {
      maintenance_conditions.push("bearing replaced");
    }
  } else if (/bearing\s+(was\s+)?lubricat(ed)?/i.test(qLower) || /lubricat(ed)?\s+(the\s+)?bearing/i.test(qLower)) {
    conditions.solution.push("bearing lubricated");
    if (!maintenance_conditions.includes("bearing lubricated")) {
      maintenance_conditions.push("bearing lubricated");
    }
  }

  if (/allison\s+sensor/i.test(qLower)) {
    conditions.solution.push("Allison sensor changed");
    if (!maintenance_conditions.includes("Allison sensor changed")) {
      maintenance_conditions.push("Allison sensor changed");
    }
  }

  if (/pressure\s+valve\s+(replace|change|replacement)/i.test(qLower) || /valve\s+(replace|change|replacement)/i.test(qLower)) {
    conditions.solution.push("pressure valve replacement");
    if (!maintenance_conditions.includes("pressure valve replacement")) {
      maintenance_conditions.push("pressure valve replacement");
    }
  } else if (/pressure\s+valve\s+(adjust|calibrat)/i.test(qLower)) {
    conditions.solution.push("pressure valve adjusted");
    if (!maintenance_conditions.includes("pressure valve adjusted")) {
      maintenance_conditions.push("pressure valve adjusted");
    }
  }

  if (/loose\s+coupling|coupling\s+(tighten|adjust)/i.test(qLower)) {
    conditions.solution.push("coupling tightened");
    if (!maintenance_conditions.includes("loose coupling")) {
      maintenance_conditions.push("loose coupling");
    }
  }

  // 5. Status Condition
  if (/\b(completed|resolved|repaired)\b/i.test(qLower) && !/\b(status)\b/i.test(qLower)) {
    conditions.status.push("Completed");
  } else if (/\b(observation|further observation)\b/i.test(qLower)) {
    conditions.status.push("Operating - Further Observation Required");
  }

  // 6. Requested Display Fields
  if (/\b(with\s+date|show\s+date|when|which\s+date|date)\b/i.test(qLower)) {
    requested_fields.push("date");
  }

  if (/\b(with\s+time|show\s+time|\btime\b)\b/i.test(qLower)) {
    requested_fields.push("time");
  }

  if (/\b(with\s+status|show\s+status|\bstatus\b)\b/i.test(qLower)) {
    requested_fields.push("status");
  }

  if (/\b(with\s+solution|show\s+solution)\b/i.test(qLower)) {
    requested_fields.push("solution");
  }

  if (requested_fields.length === 0) {
    requested_fields.push("matching records");
  }

  // 7. Latest Flag
  if (/\b(latest|last|recent|kadasiya)\b/i.test(qLower)) {
    is_latest_only = true;
  }

  return {
    normalized_query: normalized,
    machine_identifier,
    machine_condition: machine_identifier,
    is_category_search,
    conditions,
    maintenance_conditions,
    requested_fields,
    is_latest_only,
    needs_clarification,
    clarification_message,
  };
}

// Complete semantic condition matching function
function doesReportMatchQuery(r, parsedParams) {
  const probText = (r.problem || "").toLowerCase();
  const solText = (r.solution || "").toLowerCase();
  const statusText = (r.maintenance_status || "").toLowerCase();
  const fullText = [
    r.problem,
    r.solution,
    r.cleaned_report,
    r.report,
    r.translated_report,
    r.original_text,
  ].filter(Boolean).join(". ").toLowerCase();

  // 1. Problem Conditions (ALL must match!)
  if (parsedParams.conditions && parsedParams.conditions.problem && parsedParams.conditions.problem.length > 0) {
    for (const probCond of parsedParams.conditions.problem) {
      if (probCond === "sensor failure") {
        const hasSensor = probText.includes("sensor") || fullText.includes("sensor");
        const hasFailure =
          /fail(ure|ed)?|fault|malfunction|not\s+detect/i.test(probText) ||
          /fail(ure|ed)?|fault|malfunction|not\s+detect/i.test(fullText);
        if (!hasSensor || !hasFailure) return false;
      } else if (probCond === "oil leakage") {
        const hasOil = probText.includes("oil") || fullText.includes("oil");
        const hasLeak = /leak(age|ing|s|ed)?/i.test(probText) || /leak(age|ing|s|ed)?/i.test(fullText);
        if (!hasOil || !hasLeak) return false;
      } else if (probCond === "motor overheating") {
        const hasMotor = probText.includes("motor") || fullText.includes("motor");
        const hasHeat = /overheat(ing|ed)?|heating/i.test(probText) || /overheat(ing|ed)?|heating/i.test(fullText);
        if (!hasMotor || !hasHeat) return false;
      } else if (probCond === "bearing noise") {
        const hasBearing = probText.includes("bearing") || fullText.includes("bearing");
        const hasNoise = /noise|sound/i.test(probText) || /noise|sound/i.test(fullText);
        if (!hasBearing || !hasNoise) return false;
      } else if (probCond === "conveyor belt slipping") {
        const hasBelt = probText.includes("belt") || fullText.includes("belt");
        const hasSlip = probText.includes("slip") || fullText.includes("slip");
        if (!hasBelt || !hasSlip) return false;
      } else if (probCond === "hydraulic pressure low") {
        const hasPressure = probText.includes("pressure") || fullText.includes("pressure");
        const hasLow = /low|drop|loss/i.test(probText) || /low|drop|loss/i.test(fullText);
        if (!hasPressure || !hasLow) return false;
      } else if (probCond === "temperature fluctuation") {
        const hasTemp = probText.includes("temperature") || fullText.includes("temperature");
        const hasFluct = /fluctuat/i.test(probText) || /fluctuat/i.test(fullText);
        if (!hasTemp || !hasFluct) return false;
      } else {
        if (!probText.includes(probCond) && !fullText.includes(probCond)) return false;
      }
    }
  }

  // 2. Solution Conditions (ALL must match!)
  if (parsedParams.conditions && parsedParams.conditions.solution && parsedParams.conditions.solution.length > 0) {
    for (const solCond of parsedParams.conditions.solution) {
      if (solCond === "sensor replaced") {
        const hasSensor = solText.includes("sensor") || fullText.includes("sensor");
        const hasRepl =
          /replac(ed|ement|ing)?|chang(ed|ing)?/i.test(solText) ||
          /replac(ed|ement|ing)?|chang(ed|ing)?/i.test(fullText);
        if (!hasSensor || !hasRepl) return false;
      } else if (solCond === "oil replaced") {
        const hasOilReplaced =
          /\b(oil\s+(was\s+|is\s+)?(replac(ed|ement|ing)?|chang(ed|ing|e)?)|(replac(ed|ement|ing)?|chang(ed|ing|e)?)\s+(the\s+)?oil\b(?!\s+(leak|seal|pump|filter|sensor|pressure|joint)))\b/i.test(fullText);
        if (!hasOilReplaced) return false;
      } else if (solCond === "bearing replaced") {
        const hasBearing = solText.includes("bearing") || fullText.includes("bearing");
        const hasRepl =
          /replac(ed|ement|ing)?|chang(ed|ing)?/i.test(solText) ||
          /replac(ed|ement|ing)?|chang(ed|ing)?/i.test(fullText);
        if (!hasBearing || !hasRepl) return false;
      } else if (solCond === "bearing lubricated") {
        const hasBearing = solText.includes("bearing") || fullText.includes("bearing");
        const hasLub = solText.includes("lubricat") || fullText.includes("lubricat");
        if (!hasBearing || !hasLub) return false;
      } else if (solCond === "Allison sensor changed") {
        if (!fullText.includes("allison")) return false;
      } else if (solCond === "pressure valve replacement") {
        const hasValve = fullText.includes("valve") || fullText.includes("pressure");
        const hasRepl = /replac(ed|ement|ing)?/i.test(solText) || /replac(ed|ement|ing)?/i.test(fullText);
        if (!hasValve || !hasRepl) return false;
      } else if (solCond === "pressure valve adjusted") {
        const hasValve = fullText.includes("valve") || fullText.includes("pressure");
        const hasAdj = /adjust/i.test(solText) || /adjust/i.test(fullText);
        if (!hasValve || !hasAdj) return false;
      } else if (solCond === "coupling tightened") {
        const hasCoupling = solText.includes("coupling") || fullText.includes("coupling");
        const hasTighten = solText.includes("tighten") || fullText.includes("tighten");
        if (!hasCoupling || !hasTighten) return false;
      } else {
        if (!solText.includes(solCond) && !fullText.includes(solCond)) return false;
      }
    }
  }

  // 3. Status Conditions
  if (parsedParams.conditions && parsedParams.conditions.status && parsedParams.conditions.status.length > 0) {
    for (const statCond of parsedParams.conditions.status) {
      if (statCond === "Completed" && !statusText.includes("completed")) return false;
      if (statCond.includes("Observation") && !statusText.includes("observation")) return false;
    }
  }

  // 4. Fallback maintenance_conditions check
  if (
    (!parsedParams.conditions ||
      ((!parsedParams.conditions.problem || parsedParams.conditions.problem.length === 0) &&
        (!parsedParams.conditions.solution || parsedParams.conditions.solution.length === 0))) &&
    parsedParams.maintenance_conditions &&
    parsedParams.maintenance_conditions.length > 0
  ) {
    for (const cond of parsedParams.maintenance_conditions) {
      const condLower = cond.toLowerCase().trim();
      if (/oil\s+leak/i.test(condLower)) {
        if (!fullText.includes("oil") || !/leak/i.test(fullText)) return false;
      } else if (/oil\s+(replace|change)/i.test(condLower)) {
        const hasOilReplaced =
          /\b(oil\s+(was\s+|is\s+)?(replac(ed|ement|ing)?|chang(ed|ing|e)?)|(replac(ed|ement|ing)?|chang(ed|ing|e)?)\s+(the\s+)?oil\b(?!\s+(leak|seal|pump|filter|sensor|pressure|joint)))\b/i.test(fullText);
        if (!hasOilReplaced) return false;
      } else if (/bearing\s+(replace|change)/i.test(condLower)) {
        if (!fullText.includes("bearing") || !/replac|chang/i.test(fullText)) return false;
      } else if (/pressure\s+valve/i.test(condLower)) {
        if (!fullText.includes("valve") && !fullText.includes("pressure")) return false;
      } else if (!fullText.includes(condLower)) {
        return false;
      }
    }
  }

  return true;
}

app.post("/search-maintenance-records", async (req, res) => {
  try {
    const rawQuery = req.body && typeof req.body.query === "string" ? req.body.query.trim() : "";

    if (!rawQuery) {
      return res.status(400).json({
        success: false,
        message: "Enter or speak a maintenance query.",
      });
    }

    // ----------------------------------------------------
    // STEP 1: UNDERSTAND QUERY VIA GEMINI (OR DETERMINISTIC FALLBACK)
    // ----------------------------------------------------
    let parsedParams = localFallbackParse(rawQuery);

    const parsePrompt = `
You are an expert industrial maintenance query analyzer and spell corrector.
Analyze the Head Officer's natural-language query (in English, Tamil, or Thanglish, typed or voice-transcribed, possibly containing typos or speech errors).

GEMINI'S ROLE:
1. Understand the user's intended meaning and ALL search conditions.
2. Correct obvious spelling mistakes (e.g., "machne" -> "machine", "leakge" -> "leakage", "bearng" -> "bearing", "replced" -> "replaced", "failur" -> "failure").
3. Distinguish SEARCH FILTERS (e.g. machine, problem, action) from REQUESTED OUTPUT FIELDS (e.g. date, time, status, solution).
4. Extract structured search parameters. Do NOT invent maintenance records or answer the query directly.

SCHEMA (Valid JSON ONLY):
{
  "normalized_query": "show me the sensor failure problem of cnc machine with date",
  "machine_identifier": "CNC machine",
  "conditions": {
    "problem": ["sensor failure"],
    "solution": [],
    "status": [],
    "component": []
  },
  "maintenance_conditions": ["sensor failure"],
  "requested_fields": ["date"],
  "is_latest_only": false,
  "needs_clarification": false,
  "clarification_message": ""
}

RULES:
1. "machine_identifier":
   - Machine name, machine code, or machine family (e.g. "CNC machine", "AD205", "PMP-012", "CNC-001", "Hydraulic Press", "Conveyor System", "Air Compressor", "Air Dryer", "Centrifugal Pump").
   - If user asks for "all machines" (e.g. "show me all machines that had an oil leakage problem"), machine_identifier MUST be null.
   - If no machine is mentioned, return null.

2. "conditions":
   - "problem": Specific problem, fault, issue, or symptom (e.g. "sensor failure", "oil leakage", "motor overheating", "bearing noise", "conveyor belt slipping", "hydraulic pressure low").
   - "solution": Specific maintenance action or repair performed (e.g. "sensor replaced", "oil replaced", "bearing replaced", "hydraulic pump replaced", "pressure valve adjusted").
   - "status": Maintenance status (e.g. "Completed", "Operating - Further Observation Required").
   - "component": Relevant component name if mentioned (e.g. "sensor", "bearing", "valve").
   - "maintenance_conditions": Combined flat array of all condition phrases.

3. "requested_fields":
   - Words like "date", "time", "status", "solution" when requested for display ("with date", "show date", "when", "with time", "with status") MUST be listed in "requested_fields" and NOT treated as search filter values!
   - Default to ["matching records"] if no specific output fields are requested.

4. "is_latest_only":
   - true if user asks for "latest", "last", or "recent" maintenance record.

5. "needs_clarification":
   - true if the query is too ambiguous (e.g., "show me sensor records" with no machine code and no specific sensor type or action).
   - "clarification_message": "Please specify the machine or sensor name."

6. "is_category_search":
   - true ONLY if user explicitly asks for all machines in a category or plural category (e.g. "all CNC machines", "CNC machines", "any CNC machine", "CNC category", "all compressors").
   - If user asks for an exact machine name like "CNC machine" (singular), "is_category_search" MUST be false and "machine_identifier" MUST be "CNC Machine".

User Query: "${rawQuery.replace(/"/g, '\\"')}"
`;

    try {
      const geminiRes = await callGeminiWithFallback(parsePrompt, {
        responseMimeType: "application/json",
      });

      if (geminiRes && geminiRes.text) {
        const parsed = JSON.parse(geminiRes.text);

        if (parsed.needs_clarification !== undefined) {
          parsedParams.needs_clarification = Boolean(parsed.needs_clarification);
          if (parsed.clarification_message) {
            parsedParams.clarification_message = String(parsed.clarification_message);
          }
        }

        if (parsed.normalized_query) {
          parsedParams.normalized_query = String(parsed.normalized_query);
        }

        if (parsed.is_category_search !== undefined) {
          parsedParams.is_category_search = Boolean(parsed.is_category_search);
        }

        if (parsed.machine_identifier !== undefined) {
          parsedParams.machine_identifier = parsed.machine_identifier
            ? String(parsed.machine_identifier).trim()
            : null;
          parsedParams.machine_condition = parsedParams.machine_identifier;
        }

        if (parsed.conditions && typeof parsed.conditions === "object") {
          if (Array.isArray(parsed.conditions.problem) && parsed.conditions.problem.length > 0) {
            parsedParams.conditions.problem = parsed.conditions.problem.map(String);
          }
          if (Array.isArray(parsed.conditions.solution) && parsed.conditions.solution.length > 0) {
            parsedParams.conditions.solution = parsed.conditions.solution.map(String);
          }
          if (Array.isArray(parsed.conditions.status) && parsed.conditions.status.length > 0) {
            parsedParams.conditions.status = parsed.conditions.status.map(String);
          }
        }

        if (Array.isArray(parsed.maintenance_conditions) && parsed.maintenance_conditions.length > 0) {
          parsedParams.maintenance_conditions = parsed.maintenance_conditions.map(String).filter(Boolean);
        }

        if (Array.isArray(parsed.requested_fields) && parsed.requested_fields.length > 0) {
          parsedParams.requested_fields = parsed.requested_fields.map(String).filter(Boolean);
        }

        if (parsed.is_latest_only !== undefined) {
          parsedParams.is_latest_only = Boolean(parsed.is_latest_only);
        }
      }
    } catch (parseErr) {
      console.warn("Gemini query parser fallback used:", parseErr.message);
    }

    // Backwards compatibility for UI intent display chips
    parsedParams.machine_condition = parsedParams.machine_identifier || parsedParams.machine_condition;
    parsedParams.components = parsedParams.maintenance_conditions;

    // ----------------------------------------------------
    // STEP 1.5: HANDLE AMBIGUOUS / CLARIFICATION QUERIES
    // ----------------------------------------------------
    if (parsedParams.needs_clarification) {
      return res.json({
        success: true,
        needs_clarification: true,
        clarification_message:
          parsedParams.clarification_message || "Please specify the machine or sensor name.",
        structured_query: {
          normalized_query: parsedParams.normalized_query || rawQuery,
          machine_identifier: null,
          machine_condition: null,
          conditions: { problem: [], solution: [], status: [], component: [] },
          maintenance_conditions: [],
          requested_fields: [],
          needs_clarification: true,
          clarification_message:
            parsedParams.clarification_message || "Please specify the machine or sensor name.",
        },
        total_matches: 0,
        results: [],
        message:
          parsedParams.clarification_message || "Please specify the machine or sensor name.",
      });
    }

    // ----------------------------------------------------
    // STEP 2: QUERY FIRESTORE & RESOLVE REGISTERED MACHINES
    // ----------------------------------------------------
    const machinesSnapshot = await db.collection("machines").get();
    const registeredMachines = machinesSnapshot.docs.map((d) => d.data());

    const reportsSnapshot = await db.collection("maintenance_reports").get();
    let allReports = reportsSnapshot.docs.map((doc) => {
      const data = doc.data();
      const createdAt = convertTimestamp(data.created_at);

      let machineId =
        data.machine_id !== undefined && data.machine_id !== null ? Number(data.machine_id) : null;
      let machineCode = data.machine_code;
      let machineName = data.machine_name;

      if (machineId !== null) {
        const regMachine = registeredMachines.find((m) => Number(m.machine_id) === machineId);
        if (regMachine) {
          if (!machineCode || machineCode === "undefined" || machineCode === "N/A") {
            machineCode = regMachine.machine_code;
          }
          if (!machineName || machineName === "undefined" || machineName === "Unknown Machine") {
            machineName = regMachine.machine_name;
          }
        }
      }

      return {
        id: String(doc.id),
        machine_id: machineId,
        machine_name: machineName || "Unknown Machine",
        machine_code: machineCode || "N/A",
        engineer_id: data.engineer_id || null,
        original_text: safeValue(data.original_text),
        translated_report: safeValue(data.translated_report),
        cleaned_report: safeValue(data.cleaned_report || data.report),
        report: safeValue(data.report),
        problem: safeValue(data.problem),
        solution: safeValue(data.solution),
        maintenance_status: safeValue(data.maintenance_status),
        maintenance_time: safeValue(data.maintenance_time),
        created_at: createdAt,
      };
    });

    // ----------------------------------------------------
    // STEP 3: APPLY MACHINE FILTER (IF SPECIFIED)
    // ----------------------------------------------------
    if (parsedParams.machine_identifier) {
      const mCond = parsedParams.machine_identifier.trim();
      const mCondLower = mCond.toLowerCase();
      const mCondNorm = mCondLower.replace(/[-_\s]/g, "");

      const isCategory =
        Boolean(parsedParams.is_category_search) ||
        /\b(all\s+cnc|cnc\s+machines|any\s+cnc|cnc\s+category|all\s+compressors?|all\s+hydraulic|all\s+conveyors?|all\s+lathes?)\b/i.test(rawQuery);

      let matchedMachines = [];

      if (isCategory) {
        // Broader category matching allowed
        matchedMachines = registeredMachines.filter((m) => {
          const mCode = String(m.machine_code || "").toLowerCase();
          const mName = String(m.machine_name || "").toLowerCase();
          if (mCondLower.includes("cnc") || mCondLower === "cnc") {
            return mCode.startsWith("cnc") || mCode.startsWith("ml-06") || mName.includes("cnc");
          }
          if (mCondLower.includes("hydraulic")) {
            return mName.includes("hydraulic") || mCode.startsWith("hyd") || mCode.startsWith("hpr");
          }
          if (mCondLower.includes("compressor")) {
            return mName.includes("compressor") || mCode.startsWith("cmp");
          }
          if (mCondLower.includes("conveyor")) {
            return mName.includes("conveyor") || mCode.startsWith("con");
          }
          if (mCondLower.includes("pump")) {
            return mName.includes("pump") || mCode.startsWith("pmp");
          }
          if (mCondLower.includes("lathe")) {
            return mName.includes("lathe") || mCode.startsWith("ml-99");
          }
          if (mCondLower.includes("dryer")) {
            return mName.includes("dryer") || mCode.startsWith("adr");
          }
          return mName.includes(mCondLower);
        });
      } else {
        // EXACT MATCHING ONLY:
        // 1. Check if user provided an exact machine code (e.g. CNC-001, ML-06, PMP-012, HYD-002)
        const matchedByCode = registeredMachines.filter((m) => {
          const mCode = String(m.machine_code || "").toLowerCase();
          const mCodeNorm = mCode.replace(/[-_\s]/g, "");
          return mCode === mCondLower || mCodeNorm === mCondNorm;
        });

        if (matchedByCode.length > 0) {
          matchedMachines = matchedByCode;
        } else {
          // 2. Match exact canonical machine name (NOT substring or category expansion)
          // "CNC Machine" matches "CNC Machine" (CNC-001), but NOT "CNC Milling Machine" (ML-06)
          matchedMachines = registeredMachines.filter((m) => {
            const mName = String(m.machine_name || "").trim().toLowerCase();
            return mName === mCondLower;
          });

          // If no match, check normalized (ignoring spaces/hyphens) exact match
          if (matchedMachines.length === 0) {
            matchedMachines = registeredMachines.filter((m) => {
              const mNameNorm = String(m.machine_name || "").replace(/[-_\s]/g, "").toLowerCase();
              return mNameNorm === mCondNorm;
            });
          }
        }
      }

      const matchedMachineIds = matchedMachines.map((m) => Number(m.machine_id));
      const matchedMachineCodes = matchedMachines.map((m) => String(m.machine_code || "").toUpperCase());
      const matchedMachineNames = matchedMachines.map((m) => String(m.machine_name || "").toLowerCase().trim());

      allReports = allReports.filter((r) => {
        if (r.machine_id !== null && matchedMachineIds.includes(Number(r.machine_id))) return true;
        const rCode = String(r.machine_code || "").toUpperCase();
        if (rCode && matchedMachineCodes.includes(rCode)) return true;
        const rName = String(r.machine_name || "").toLowerCase().trim();
        if (rName && matchedMachineNames.includes(rName)) return true;
        return false;
      });

      if (allReports.length === 0) {
        return res.json({
          success: true,
          structured_query: parsedParams,
          total_matches: 0,
          results: [],
          message: "No matching maintenance record was found for the requested details.",
        });
      }
    }

    // ----------------------------------------------------
    // STEP 4: APPLY MULTI-CONDITION SEMANTIC FILTERING (STRICT AND LOGIC)
    // ----------------------------------------------------
    let matchedReports = allReports.filter((r) => doesReportMatchQuery(r, parsedParams));

    // Sort by created_at descending (latest first)
    matchedReports.sort((a, b) => {
      const timeA = a.created_at ? new Date(a.created_at).getTime() : 0;
      const timeB = b.created_at ? new Date(b.created_at).getTime() : 0;
      return timeB - timeA;
    });

    // If latest only requested, take top 1
    if (parsedParams.is_latest_only && matchedReports.length > 0) {
      matchedReports = [matchedReports[0]];
    }

    if (matchedReports.length === 0) {
      return res.json({
        success: true,
        structured_query: parsedParams,
        total_matches: 0,
        results: [],
        message: "No matching maintenance record was found for the requested details.",
      });
    }

    // ----------------------------------------------------
    // STEP 5: FORMAT REQUESTED OUTPUT DETAILS
    // ----------------------------------------------------
    const formattedResults = matchedReports.map((r) => {
      const displayDate = formatDisplayDate(r.created_at || r.maintenance_time);
      const matchedDetails = [];

      // Add matched problem details
      if (parsedParams.conditions && parsedParams.conditions.problem && parsedParams.conditions.problem.length > 0) {
        for (const p of parsedParams.conditions.problem) {
          const pTitle = p.charAt(0).toUpperCase() + p.slice(1);
          matchedDetails.push({
            item: pTitle,
            action: r.solution || "Reported",
            display: p === "oil leakage" ? "Oil leakage" : `${pTitle} — ${r.solution || r.problem}`,
          });
        }
      }

      // Add matched solution details
      if (parsedParams.conditions && parsedParams.conditions.solution && parsedParams.conditions.solution.length > 0) {
        for (const s of parsedParams.conditions.solution) {
          const sTitle = s.charAt(0).toUpperCase() + s.slice(1);
          matchedDetails.push({
            item: sTitle,
            action: r.solution || "Completed",
            display: `${sTitle} — ${r.solution || "Completed"}`,
          });
        }
      }

      // Fallback details from maintenance_conditions if empty
      if (matchedDetails.length === 0 && parsedParams.maintenance_conditions && parsedParams.maintenance_conditions.length > 0) {
        for (const cond of parsedParams.maintenance_conditions) {
          const condTrimmed = cond.trim();
          const condTitle = condTrimmed.charAt(0).toUpperCase() + condTrimmed.slice(1);
          if (/oil\s+leak(age|ing|s)?/i.test(condTrimmed)) {
            matchedDetails.push({
              item: "Oil leakage",
              action: r.solution || "Reported",
              display: "Oil leakage",
            });
          } else {
            matchedDetails.push({
              item: condTitle,
              action: r.solution || r.problem || "Maintained",
              display: `${condTitle} — ${r.solution || r.problem || "Maintained"}`,
            });
          }
        }
      }

      // If still empty (e.g. general "show CNC records"), display problem and solution
      if (matchedDetails.length === 0) {
        if (r.problem) {
          matchedDetails.push({
            item: "Problem",
            action: r.problem,
            display: `Problem: ${r.problem}`,
          });
        }
        if (r.solution) {
          matchedDetails.push({
            item: "Solution",
            action: r.solution,
            display: `Solution: ${r.solution}`,
          });
        }
      }

      // Requested output fields (time, status, solution, etc.)
      const additionalDetails = {};
      if (r.engineer_id) {
        additionalDetails.engineer = r.engineer_id;
      }
      if (r.maintenance_status) {
        additionalDetails.maintenance_status = r.maintenance_status;
      }
      if (r.maintenance_time) {
        additionalDetails.maintenance_time = r.maintenance_time;
      }
      if (r.solution) {
        additionalDetails.solution = r.solution;
      }
      if (r.problem) {
        additionalDetails.problem = r.problem;
      }

      // If user specifically requested time, ensure it appears in matched details
      if (parsedParams.requested_fields && parsedParams.requested_fields.includes("time") && r.maintenance_time) {
        matchedDetails.push({
          item: "Time",
          action: r.maintenance_time,
          display: `Maintenance Time: ${r.maintenance_time}`,
        });
      }

      // If user specifically requested status, ensure it appears in matched details
      if (parsedParams.requested_fields && parsedParams.requested_fields.includes("status") && r.maintenance_status) {
        matchedDetails.push({
          item: "Status",
          action: r.maintenance_status,
          display: `Status: ${r.maintenance_status}`,
        });
      }

      return {
        id: r.id,
        machine_code: r.machine_code,
        machine_name: r.machine_name,
        date: displayDate,
        matched_details: matchedDetails,
        additional_details: additionalDetails,
        full_report: r,
      };
    });

    return res.json({
      success: true,
      structured_query: parsedParams,
      total_matches: formattedResults.length,
      results: formattedResults,
    });
  } catch (error) {
    console.error("Maintenance search error:", error);
    res.status(500).json({
      success: false,
      message: "Internal error during maintenance record search.",
      error: error.message,
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
// AUTOMATIC MACHINE IDENTIFICATION FROM VOICE REPORT
// ==========================================
app.post("/identify-machine", async (req, res) => {
  try {
    const { text, original_text, engineer_id, draft_report } = req.body;
    const combinedText = `${text || ""} ${original_text || ""}`.trim();

    if (!combinedText) {
      return res.status(400).json({
        exists: false,
        message: "No text provided for machine identification",
      });
    }

    // 1. Phonetic normalizations for Whisper speech recognition artifacts
    let normalized = combinedText
      .replace(/\bADR[-_]?(?:Boojiam|Boogem)[^\s.,;]*\b/gi, "ADR-009")
      .replace(/\bCMP[-_]?(?:HIFAN|BOOGEM)[^\s.,;]*\b/gi, "CMP-004");

    // 2. Extract machine code and machine name using regex
    let extractedCode = "";
    let extractedName = "";

    // Convert spoken digit words e.g. "PMP one two" -> "PMP 1 2"
    const wordToDigitMap = { zero: "0", one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9" };
    let normForCode = normalized.replace(/\b(zero|one|two|three|four|five|six|seven|eight|nine)\b/gi, (m) => wordToDigitMap[m.toLowerCase()] || m);

    // Check explicit machine code mentions: "Machine code CMP-004", "code ADR-009", "PMP-1-2", "PMP 1 2"
    const explicitCodeMatch = normForCode.match(/(?:machine\s+(?:code\s+)?|code\s+|inspected\s+)([A-Za-z]{2,4}[-_\s]?(?:\d[-_\s]?)+\d)\b/i) ||
                              normalized.match(/(?:machine\s+(?:code\s+)?|code\s+|inspected\s+)([A-Za-z]{2,4}[-_\s]?(?:\d[-_\s]?)+\d)\b/i);
    if (explicitCodeMatch) {
      extractedCode = explicitCodeMatch[1].toUpperCase().replace(/\s+/g, "-");
    } else {
      const codeMatch = normForCode.match(/\b([A-Za-z]{2,4}[-_\s]?(?:\d[-_\s]?)+\d)\b/i) ||
                        normalized.match(/\b([A-Za-z]{2,4}[-_\s]?(?:\d[-_\s]?)+\d)\b/i);
      if (codeMatch) {
        extractedCode = codeMatch[1].toUpperCase().replace(/\s+/g, "-");
      }
    }

    // Known equipment name mappings
    if (/industrial\s+air\s+compressor/i.test(normalized)) {
      extractedName = "Industrial Air Compressor";
      if (!extractedCode) extractedCode = "CMP-004";
    } else if (/industrial\s+air\s+dryer|air\s+dryer/i.test(normalized)) {
      extractedName = "Industrial Air Dryer";
      if (!extractedCode) extractedCode = "ADR-009";
    } else if (/hydraulic\s+press/i.test(normalized)) {
      extractedName = "Hydraulic Press";
      if (!extractedCode && /HPR/i.test(normalized)) extractedCode = "HPR-025";
      else if (!extractedCode) extractedCode = "HYD-002";
    } else if (/cnc\s+milling\s+machine/i.test(normalized)) {
      extractedName = "CNC Milling Machine";
      if (!extractedCode) extractedCode = "ML-06";
    } else if (/cnc\s+machine/i.test(normalized)) {
      extractedName = "CNC Machine";
      if (!extractedCode) extractedCode = "CNC-001";
    } else if (/conveyor\s+system/i.test(normalized)) {
      extractedName = "Conveyor System";
      if (!extractedCode) extractedCode = "CON-003";
    } else if (/high-speed\s+lathe|lathe/i.test(normalized)) {
      extractedName = "High-Speed Lathe";
      if (!extractedCode) extractedCode = "ML-99";
    } else if (/centrifugal\s+(?:water\s+)?pump|water\s+pump|pump/i.test(normalized)) {
      extractedName = "Centrifugal Water Pump";
      if (!extractedCode) extractedCode = "PMP-012";
    } else {
      const nameMatch = normalized.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\s+(?:Compressor|Dryer|Press|Machine|Milling|Lathe|Pump|Conveyor|Generator|Turbine|Boiler))\b/);
      if (nameMatch) {
        extractedName = nameMatch[1].trim();
      }
    }

    // 3. Query Firestore machines collection
    const machinesSnap = await db.collection("machines").get();
    let matchedMachine = null;

    const codeNorm = extractedCode.toLowerCase().replace(/[-_\s]/g, "");
    const nameLower = extractedName.toLowerCase().trim();

    const extractedLetters = (extractedCode.toLowerCase().match(/[a-z]+/g) || []).join("");
    const extractedDigits = (extractedCode.match(/\d+/g) || []).join("");
    const extractedNum = extractedDigits ? parseInt(extractedDigits, 10) : -1;

    for (const doc of machinesSnap.docs) {
      const data = doc.data();
      const currentCode = String(data.machine_code || "").trim().toLowerCase();
      const currentName = String(data.machine_name || "").trim().toLowerCase();

      // Check by code if code was extracted
      if (extractedCode) {
        const curLetters = (currentCode.match(/[a-z]+/g) || []).join("");
        const curDigits = (currentCode.match(/\d+/g) || []).join("");
        const curNum = curDigits ? parseInt(curDigits, 10) : -1;

        const isExactOrHyphenMatch =
          currentCode === extractedCode.toLowerCase() ||
          currentCode.replace(/[-_\s]/g, "") === codeNorm;

        const isNormalizedNumericMatch =
          extractedLetters &&
          curLetters &&
          extractedLetters === curLetters &&
          extractedNum !== -1 &&
          extractedNum === curNum;

        if (isExactOrHyphenMatch || isNormalizedNumericMatch) {
          matchedMachine = {
            id: doc.id,
            machine_id: data.machine_id,
            machine_code: data.machine_code,
            machine_name: data.machine_name,
          };
          break;
        }
      } else if (nameLower) {
        // Check by name ONLY if no machine code was extracted from speech
        if (currentName === nameLower || currentName.includes(nameLower) || nameLower.includes(currentName)) {
          matchedMachine = {
            id: doc.id,
            machine_id: data.machine_id,
            machine_code: data.machine_code,
            machine_name: data.machine_name,
          };
          break;
        }
      }
    }

    // ==========================================
    // CASE 1: MACHINE EXISTS IN FIRESTORE
    // ==========================================
    if (matchedMachine) {
      console.log(`[IDENTIFY MACHINE] Matched existing Firestore machine: ${matchedMachine.machine_code} (${matchedMachine.machine_name})`);
      return res.json({
        exists: true,
        machine: matchedMachine,
        extracted_code: matchedMachine.machine_code,
        extracted_name: matchedMachine.machine_name,
      });
    }

    // ==========================================
    // CASE 2: MACHINE NOT FOUND -> PENDING WORKFLOW
    // ==========================================
    if (!extractedCode && !extractedName) {
      return res.json({
        exists: false,
        no_machine_detected: true,
        message: "No machine identity was detected in the voice report.",
      });
    }

    const finalUnknownCode = extractedCode || "UNKNOWN-MACHINE";
    const finalUnknownName = extractedName || finalUnknownCode;

    // Check if a PENDING request already exists in pending_machine_requests (Requirement 11)
    const pendingSnap = await db.collection("pending_machine_requests").get();
    let existingPendingDoc = null;

    for (const pDoc of pendingSnap.docs) {
      const pData = pDoc.data();
      const pCode = String(pData.machine_code || "").trim().toLowerCase().replace(/[-_\s]/g, "");
      if (pCode === finalUnknownCode.toLowerCase().replace(/[-_\s]/g, "") && pData.status === "PENDING") {
        existingPendingDoc = pDoc;
        break;
      }
    }

    const currentUserId = String(engineer_id || draft_report?.engineer_id || "engineer1");

    if (existingPendingDoc) {
      // Reuse / update existing pending request (do not duplicate!)
      await existingPendingDoc.ref.update({
        original_report: combinedText,
        draft_report: draft_report || existingPendingDoc.data().draft_report || null,
        updated_at: new Date(),
      });
      console.log(`[IDENTIFY MACHINE] Reused existing pending request ${existingPendingDoc.id} for ${finalUnknownCode}`);
      return res.json({
        exists: false,
        machine_code: finalUnknownCode,
        machine_name: finalUnknownName,
        request_id: existingPendingDoc.id,
        status: "ALREADY_PENDING",
        message: "Machine not registered. A request has been sent to the Head Officer for approval.",
      });
    }

    // Create new record in pending_machine_requests
    // Only store information that is actually present in the voice report. Do NOT hallucinate missing details!
    const newPendingRequest = {
      machine_code: finalUnknownCode,
      machine_name: finalUnknownName,
      machine_type: "",
      manufacturer: "",
      model_number: "",
      serial_number: "",
      location: "",
      reported_by: currentUserId,
      original_report: combinedText,
      draft_report: draft_report || null,
      status: "PENDING",
      created_at: new Date(),
    };

    const docRef = await db.collection("pending_machine_requests").add(newPendingRequest);
    console.log(`[IDENTIFY MACHINE] Created new pending request ${docRef.id} for ${finalUnknownCode}`);

    return res.json({
      exists: false,
      machine_code: finalUnknownCode,
      machine_name: finalUnknownName,
      request_id: docRef.id,
      status: "PENDING",
      message: "Machine not registered. A request has been sent to the Head Officer for approval.",
    });
  } catch (error) {
    console.error("Machine identification error:", error);
    res.status(500).json({
      message: "Failed to identify machine",
      error: error.message,
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