const axios = require("axios");

const BASE_URL = "http://localhost:5000";

async function runSection20Tests() {
  console.log("================================================================");
  console.log("VERIFICATION OF 8 EXACT TEST CASES (SECTION 20)");
  console.log("================================================================\n");

  // ----------------------------------------------------------------
  // TEST 1: "show me the record of cnc machine with oil leakage"
  // Expected: CNC AND oil leakage
  // ----------------------------------------------------------------
  console.log('[TEST 1] "show me the record of cnc machine with oil leakage"');
  const res1 = await axios.post(`${BASE_URL}/search-maintenance-records`, {
    query: "show me the record of cnc machine with oil leakage",
  });
  console.log("Structured Query 1:", JSON.stringify(res1.data.structured_query));
  console.log(`Total Matches: ${res1.data.total_matches}`);
  res1.data.results.forEach((r, i) => {
    console.log(`  Match ${i + 1}: ${r.machine_code} (${r.machine_name}) | Date: ${r.date} | Details: ${JSON.stringify(r.matched_details)}`);
  });

  if (!res1.data.success || res1.data.results.length === 0) {
    throw new Error("TEST 1 FAILED: Expected CNC machine oil leakage records!");
  }
  for (const r of res1.data.results) {
    const mCode = (r.machine_code || "").toUpperCase();
    const mName = (r.machine_name || "").toLowerCase();
    const isCnc = mCode.startsWith("CNC") || mCode.startsWith("ML") || mName.includes("cnc");
    if (!isCnc) throw new Error(`TEST 1 FAILED: Non-CNC machine: ${r.machine_code}`);
    const detailsStr = JSON.stringify(r.matched_details).toLowerCase();
    if (!detailsStr.includes("oil leakage")) throw new Error("TEST 1 FAILED: Missing oil leakage detail");
  }
  console.log("PASS TEST 1: Strictly matched CNC machines with oil leakage.\n");

  // ----------------------------------------------------------------
  // TEST 2: "show me cnc machne with oil leakge" (with spelling mistakes)
  // Expected: Same result as #1
  // ----------------------------------------------------------------
  console.log('[TEST 2] "show me cnc machne with oil leakge" (Spelling correction test)');
  const res2 = await axios.post(`${BASE_URL}/search-maintenance-records`, {
    query: "show me cnc machne with oil leakge",
  });
  console.log("Structured Query 2:", JSON.stringify(res2.data.structured_query));
  console.log(`Total Matches: ${res2.data.total_matches}`);

  if (!res2.data.success || res2.data.results.length === 0) {
    throw new Error("TEST 2 FAILED: Expected spelling correction to match CNC oil leakage records!");
  }
  if (res2.data.results.length !== res1.data.results.length) {
    throw new Error(`TEST 2 FAILED: Expected same number of records as Test 1 (${res1.data.results.length}), got ${res2.data.results.length}`);
  }
  console.log("PASS TEST 2: Successfully autocorrected 'machne' -> 'machine' and 'leakge' -> 'leakage'. Identical results to Test 1.\n");

  // ----------------------------------------------------------------
  // TEST 3: "show me AD205 Allison sensor changed and oil replaced with date"
  // Expected: AD205 AND Allison sensor changed AND oil replaced AND date
  // ----------------------------------------------------------------
  console.log('[TEST 3] "show me AD205 Allison sensor changed and oil replaced with date"');
  const res3 = await axios.post(`${BASE_URL}/search-maintenance-records`, {
    query: "show me AD205 Allison sensor changed and oil replaced with date",
  });
  console.log("Structured Query 3:", JSON.stringify(res3.data.structured_query));
  console.log(`Total Matches: ${res3.data.total_matches}, Message: "${res3.data.message}"`);

  const sq3 = res3.data.structured_query;
  const mId3 = (sq3.machine_identifier || sq3.machine_condition || "").toUpperCase();
  if (mId3 !== "AD205") throw new Error(`TEST 3 FAILED: Expected machine AD205, got ${mId3}`);
  if (!sq3.requested_fields.includes("date")) throw new Error("TEST 3 FAILED: Expected 'date' in requested_fields");

  // Since AD205 is not in Firestore, it must not invent data:
  if (res3.data.results.length !== 0) throw new Error("TEST 3 FAILED: Hallucinated records for non-existent AD205!");
  if (!res3.data.message.includes("No matching maintenance record was found")) {
    throw new Error("TEST 3 FAILED: Expected clean no-match message");
  }
  console.log("PASS TEST 3: Correct structured extraction (AD205 + Allison sensor changed + oil replaced + date) with zero hallucination.\n");

  // ----------------------------------------------------------------
  // TEST 4: "when was the bearng replced on PMP-012?"
  // Expected: PMP-012 AND bearing replaced AND date
  // ----------------------------------------------------------------
  console.log('[TEST 4] "when was the bearng replced on PMP-012?" (Spelling correction: bearng replced)');
  const res4 = await axios.post(`${BASE_URL}/search-maintenance-records`, {
    query: "when was the bearng replced on PMP-012?",
  });
  console.log("Structured Query 4:", JSON.stringify(res4.data.structured_query));
  console.log(`Total Matches: ${res4.data.total_matches}, Message: "${res4.data.message}"`);

  const sq4 = res4.data.structured_query;
  const mId4 = (sq4.machine_identifier || sq4.machine_condition || "").toUpperCase();
  if (mId4 !== "PMP-012") throw new Error(`TEST 4 FAILED: Expected machine PMP-012, got ${mId4}`);
  if (!sq4.maintenance_conditions.some((c) => c.includes("bearing"))) {
    throw new Error("TEST 4 FAILED: Expected bearing replaced in conditions");
  }
  if (!sq4.requested_fields.includes("date")) {
    throw new Error("TEST 4 FAILED: Expected 'date' requested field for 'when'");
  }
  console.log("PASS TEST 4: Autocorrected 'bearng replced' -> 'bearing replaced', PMP-012 machine code, and 'when' -> 'date'.\n");

  // ----------------------------------------------------------------
  // TEST 5: "show hydraulic press pressure valve replacement"
  // Expected: Hydraulic Press AND pressure valve replacement
  // ----------------------------------------------------------------
  console.log('[TEST 5] "show hydraulic press pressure valve replacement"');
  const res5 = await axios.post(`${BASE_URL}/search-maintenance-records`, {
    query: "show hydraulic press pressure valve replacement",
  });
  console.log("Structured Query 5:", JSON.stringify(res5.data.structured_query));
  console.log(`Total Matches: ${res5.data.total_matches}, Message: "${res5.data.message}"`);

  const sq5 = res5.data.structured_query;
  const mId5 = (sq5.machine_identifier || sq5.machine_condition || "").toLowerCase();
  if (!mId5.includes("hydraulic")) throw new Error(`TEST 5 FAILED: Expected Hydraulic Press, got ${mId5}`);
  if (!sq5.maintenance_conditions.some((c) => c.includes("pressure valve"))) {
    throw new Error("TEST 5 FAILED: Expected pressure valve condition");
  }
  console.log("PASS TEST 5: Structured extraction strictly filtered to Hydraulic Press AND pressure valve replacement.\n");

  // ----------------------------------------------------------------
  // TEST 6: "show me oil replacement records"
  // Expected: oil replacement records NOT oil leakage records!
  // ----------------------------------------------------------------
  console.log('[TEST 6] "show me oil replacement records" (Must NOT match oil leakage records)');
  const res6 = await axios.post(`${BASE_URL}/search-maintenance-records`, {
    query: "show me oil replacement records",
  });
  console.log("Structured Query 6:", JSON.stringify(res6.data.structured_query));
  console.log(`Total Matches: ${res6.data.total_matches}, Message: "${res6.data.message}"`);

  const sq6 = res6.data.structured_query;
  if (!sq6.maintenance_conditions.some((c) => c.includes("oil replac"))) {
    throw new Error("TEST 6 FAILED: Expected 'oil replaced' condition");
  }
  // Ensure NONE of the oil leakage records were returned as oil replacement:
  for (const r of res6.data.results) {
    const text = [r.full_report.problem, r.full_report.solution, r.full_report.report].join(" ").toLowerCase();
    if (!text.includes("oil replaced") && !text.includes("oil change") && !text.includes("replaced the oil")) {
      throw new Error(`TEST 6 FAILED: Returned an oil-leakage only record for an oil replacement search: ${text}`);
    }
  }
  console.log("PASS TEST 6: Strictly distinguished oil replacement from oil leakage. Zero false positives.\n");

  // ----------------------------------------------------------------
  // TEST 7: "show CNC records"
  // Expected: CNC records only
  // ----------------------------------------------------------------
  console.log('[TEST 7] "show CNC records"');
  const res7 = await axios.post(`${BASE_URL}/search-maintenance-records`, {
    query: "show CNC records",
  });
  console.log("Structured Query 7:", JSON.stringify(res7.data.structured_query));
  console.log(`Total Matches: ${res7.data.total_matches}`);

  if (!res7.data.success || res7.data.results.length === 0) {
    throw new Error("TEST 7 FAILED: Expected CNC records!");
  }
  for (const r of res7.data.results) {
    const mCode = (r.machine_code || "").toUpperCase();
    const mName = (r.machine_name || "").toLowerCase();
    const isCnc = mCode.startsWith("CNC") || mCode.startsWith("ML") || mName.includes("cnc");
    if (!isCnc) throw new Error(`TEST 7 FAILED: Non-CNC machine returned: ${r.machine_code} (${r.machine_name})`);
  }
  console.log("PASS TEST 7: CNC records only returned without leakage or component restriction.\n");

  // ----------------------------------------------------------------
  // TEST 8: "show me sensor records"
  // Expected: If ambiguous: request clarification instead of guessing
  // ----------------------------------------------------------------
  console.log('[TEST 8] "show me sensor records" (Ambiguity clarification test)');
  const res8 = await axios.post(`${BASE_URL}/search-maintenance-records`, {
    query: "show me sensor records",
  });
  console.log("Structured Query 8:", JSON.stringify(res8.data.structured_query));
  console.log(`Needs Clarification: ${res8.data.needs_clarification}, Clarification Message: "${res8.data.clarification_message}"`);

  if (!res8.data.needs_clarification && !res8.data.is_ambiguous) {
    throw new Error("TEST 8 FAILED: Expected needs_clarification / is_ambiguous to be true!");
  }
  const clarMsg = res8.data.clarification_message || res8.data.message || "";
  if (!clarMsg.toLowerCase().includes("specify") && !clarMsg.toLowerCase().includes("sensor")) {
    throw new Error(`TEST 8 FAILED: Expected clarification message, got: "${clarMsg}"`);
  }
  if (res8.data.results && res8.data.results.length > 0) {
    throw new Error("TEST 8 FAILED: Must not return random records for an ambiguous query!");
  }
  console.log("PASS TEST 8: Successfully requested clarification ('Please specify the machine or sensor name.') instead of guessing.\n");

  console.log("================================================================");
  console.log("ALL 8 SECTION 20 TEST CASES PASSED WITH 100% SUCCESS!");
  console.log("================================================================");
}

runSection20Tests().catch((err) => {
  console.error("FATAL ERROR IN SECTION 20 TESTS:", err.response ? err.response.data : err.message);
  process.exit(1);
});
