const axios = require("axios");
const db = require("./firebaseAdmin");

const BASE_URL = "http://localhost:5000";

async function runTestSuite() {
  console.log("==================================================");
  console.log("TEST SUITE: AUTOMATIC VOICE MACHINE IDENTIFICATION");
  console.log("==================================================");

  // Clean up any previous test records for HPR-025 to ensure clean test runs
  const prevMachines = await db.collection("machines").where("machine_code", "==", "HPR-025").get();
  for (const doc of prevMachines.docs) await doc.ref.delete();
  const prevPending = await db.collection("pending_machine_requests").where("machine_code", "==", "HPR-025").get();
  for (const doc of prevPending.docs) await doc.ref.delete();

  // ----------------------------------------------------
  // TEST 1: Registered Machine CMP-004
  // ----------------------------------------------------
  console.log("\n[TEST 1] Automatic Machine Identification for Registered Machine CMP-004");
  const speech1 = "Innaiku Industrial Air Compressor machine-a inspect panninen. Machine code CMP-004. Motor side-la excessive vibration irundhuchu.";
  const res1 = await axios.post(`${BASE_URL}/identify-machine`, {
    text: speech1,
    original_text: speech1,
    engineer_id: "engineer1",
  });

  console.log("Result 1:", res1.data);
  if (!res1.data.exists) {
    throw new Error("TEST 1 FAILED: CMP-004 should exist in registered machines!");
  }
  if (res1.data.machine.machine_code !== "CMP-004") {
    throw new Error(`TEST 1 FAILED: Expected machine_code CMP-004, got ${res1.data.machine.machine_code}`);
  }
  console.log("PASS: CMP-004 automatically identified from voice without manual dropdown selection!");

  // ----------------------------------------------------
  // TEST 2: Current Test Case ADR-009 (Air Dryer, Temperature Sensor, Further Observation Required)
  // ----------------------------------------------------
  console.log("\n[TEST 2] Automatic Machine Identification & Strict Preservation for ADR-009");
  const speech2 = "I inspected the air dryer machine. With the machine, I inspected ADR-Boojiam-Boojiam-1 and observed the temperature fluctuation in the display panel. I inspected the non-temperature sensor and control wiring. The sensor connection was loose but I did not replace it immediately. I secured the connection and monitored the machine. The temperature fluctuation was reduced a bit but further observation is required. The machine was in a trending condition during the final inspection.";

  const res2 = await axios.post(`${BASE_URL}/identify-machine`, {
    text: speech2,
    original_text: speech2,
    engineer_id: "engineer1",
  });

  console.log("Identify Result 2:", res2.data);
  if (!res2.data.exists) {
    throw new Error("TEST 2 FAILED: ADR-009 should exist in registered machines!");
  }
  if (res2.data.machine.machine_code !== "ADR-009") {
    throw new Error(`TEST 2 FAILED: Expected machine_code ADR-009, got ${res2.data.machine.machine_code}`);
  }
  console.log("PASS: ADR-009 automatically identified and mapped from voice!");

  // Now test /clean-report with authoritative machine identity
  console.log("\n[TEST 2B] Testing /clean-report for ADR-009 strict preservation");
  const cleanRes2 = await axios.post(`${BASE_URL}/clean-report`, {
    text: speech2,
    original_text: speech2,
    authoritative_machine_code: res2.data.machine.machine_code,
    authoritative_machine_name: res2.data.machine.machine_name,
  });

  console.log("Cleaned Report 2B Result:", JSON.stringify(cleanRes2.data, null, 2));
  const repText = cleanRes2.data.cleaned_report;

  // 1. Machine code must strictly remain ADR-009
  if (!repText.includes("ADR-009")) {
    throw new Error("TEST 2B FAILED: Cleaned report must contain ADR-009!");
  }
  if (/ADR-Boojiam/i.test(repText)) {
    throw new Error("TEST 2B FAILED: Cleaned report must not contain hallucinated ADR-Boojiam!");
  }
  if (cleanRes2.data.detected_machine !== "ADR-009") {
    throw new Error(`TEST 2B FAILED: detected_machine must be ADR-009, got ${cleanRes2.data.detected_machine}`);
  }
  console.log("PASS: Machine code strictly preserved as ADR-009.");

  // 2. Component must remain temperature sensor
  if (!repText.toLowerCase().includes("temperature sensor")) {
    throw new Error("TEST 2B FAILED: Component must remain temperature sensor!");
  }
  if (repText.toLowerCase().includes("non-temperature sensor")) {
    throw new Error("TEST 2B FAILED: non-temperature sensor was not normalized to temperature sensor!");
  }
  console.log("PASS: Technical component strictly preserved as temperature sensor.");

  // 3. Final status must indicate that the machine is operating but further observation is required
  const repLower = repText.toLowerCase();
  const hasOperatingObservation =
    repLower.includes("operating, but further observation is required") ||
    (repLower.includes("operating") && repLower.includes("further observation is required"));

  if (!hasOperatingObservation) {
    throw new Error(`TEST 2B FAILED: Final status must indicate machine is operating but further observation is required. Got: "${repText}"`);
  }
  if (repLower.includes("operating normally") || repLower.includes("resolved") || repLower.includes("eliminated")) {
    throw new Error(`TEST 2B FAILED: Must not upgrade uncertain status to operating normally/resolved! Got: "${repText}"`);
  }
  if (!cleanRes2.data.maintenance_status.toLowerCase().includes("observation")) {
    throw new Error(`TEST 2B FAILED: maintenance_status must indicate observation required, got "${cleanRes2.data.maintenance_status}"`);
  }
  console.log("PASS: Final status indicates machine is operating but further observation is required.");

  // ----------------------------------------------------
  // TEST 3: Unknown Machine HPR-025 (Pending Request Flow)
  // ----------------------------------------------------
  console.log("\n[TEST 3] Unknown Machine HPR-025: Automatic Pending Request Generation");
  const speech3 = "Innaiku Hydraulic Press HPR-025-a inspect panninen. Pressure dropping intermittently.";
  const res3 = await axios.post(`${BASE_URL}/identify-machine`, {
    text: speech3,
    original_text: speech3,
    engineer_id: "engineer1",
  });

  console.log("Result 3 (Unknown Machine):", res3.data);
  if (res3.data.exists) {
    throw new Error("TEST 3 FAILED: HPR-025 should NOT exist in registered machines!");
  }
  if (res3.data.machine_code !== "HPR-025") {
    throw new Error(`TEST 3 FAILED: Expected machine_code HPR-025, got ${res3.data.machine_code}`);
  }
  if (!res3.data.message.includes("Machine not registered")) {
    throw new Error("TEST 3 FAILED: Expected 'Machine not registered' message!");
  }
  console.log("PASS: Pending request created for HPR-025 without manual registration!");

  // Test duplicate request prevention
  console.log("\n[TEST 3B] Duplicate Request Prevention for HPR-025");
  const res3B = await axios.post(`${BASE_URL}/identify-machine`, {
    text: speech3,
    original_text: speech3,
    engineer_id: "engineer1",
  });

  console.log("Result 3B (Duplicate Check):", res3B.data);
  if (res3B.data.status !== "ALREADY_PENDING" && res3B.data.status !== "PENDING") {
    throw new Error("TEST 3B FAILED: Should detect existing pending request!");
  }
  console.log("PASS: Duplicate pending request prevented (existing request reused)!");

  // ----------------------------------------------------
  // TEST 4: Head Officer Approval of HPR-025
  // ----------------------------------------------------
  console.log("\n[TEST 4] Head Officer Approval for HPR-025");
  const pendingRequestsRes = await axios.get(`${BASE_URL}/pending-machines?status=PENDING`);
  const hprReq = pendingRequestsRes.data.find((r) => r.machine_code === "HPR-025");
  if (!hprReq) {
    throw new Error("TEST 4 FAILED: Could not find HPR-025 in pending requests!");
  }

  const approveRes = await axios.post(
    `${BASE_URL}/pending-machines/${hprReq.id}/approve`,
    { machine_name: "Hydraulic Press" },
    { headers: { "x-user-role": "OFFICER", "x-user-id": "officer1" } }
  );

  console.log("Approve Result:", approveRes.data);
  if (!approveRes.data.success) {
    throw new Error("TEST 4 FAILED: Officer approval failed!");
  }
  console.log(`PASS: HPR-025 approved by Head Officer and assigned machine_id: ${approveRes.data.machine.machine_id}`);

  // Re-verify that HPR-025 now exists in Firestore machines
  const recheckRes = await axios.post(`${BASE_URL}/identify-machine`, {
    text: speech3,
    original_text: speech3,
    engineer_id: "engineer1",
  });

  console.log("Recheck HPR-025 after approval:", recheckRes.data);
  if (!recheckRes.data.exists) {
    throw new Error("TEST 4 FAILED: HPR-025 should now exist after approval!");
  }
  console.log("PASS: Newly approved machine now automatically identifies as registered!");

  // ----------------------------------------------------
  // TEST 5: Report Submission to Firestore
  // ----------------------------------------------------
  console.log("\n[TEST 5] Submitting Maintenance Report for ADR-009 to Firestore");
  const reportPayload = {
    machine_id: 11,
    machine_code: "ADR-009",
    machine_name: "Industrial Air Dryer",
    engineer_id: "engineer1",
    original_text: speech2,
    translated_report: speech2,
    cleaned_report: cleanRes2.data.cleaned_report,
    report: cleanRes2.data.cleaned_report,
    problem: cleanRes2.data.problem,
    solution: cleanRes2.data.solution,
    maintenance_status: cleanRes2.data.maintenance_status,
    maintenance_time: "",
    source_language: "en",
    source_type: "microphone",
  };

  const submitRes = await axios.post(`${BASE_URL}/reports`, reportPayload);
  if (submitRes.status !== 201) {
    throw new Error(`TEST 5 FAILED: Expected 201 Created, got ${submitRes.status}`);
  }
  console.log("Report Saved Successfully. ID:", submitRes.data.id);
  if (submitRes.data.machine_code !== "ADR-009") {
    throw new Error(`TEST 5 FAILED: Expected machine_code ADR-009 in saved report, got ${submitRes.data.machine_code}`);
  }
  console.log("PASS: Report saved to Firestore strictly preserving ADR-009!");

  console.log("\n==================================================");
  console.log("ALL 5 TESTS PASSED WITH 100% SUCCESS RATE!");
  console.log("==================================================");
}

runTestSuite().catch((err) => {
  console.error("FATAL TEST ERROR:", err.response ? err.response.data : err.message);
  process.exit(1);
});
