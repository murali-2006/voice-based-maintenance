const axios = require("axios");

async function test() {
  const query = "show me the maintenance of cnc milling machine with oil leakage problem";
  console.log(`Query: "${query}"\n`);
  const res = await axios.post("http://localhost:5000/search-maintenance-records", {
    query,
  });

  console.log("Structured query:", JSON.stringify(res.data.structured_query));
  console.log("Total matches:", res.data.total_matches);

  res.data.results.forEach((r, idx) => {
    console.log(`\n--- Result #${idx + 1} ---`);
    console.log(`ID: ${r.id}`);
    console.log(`Machine Code: ${r.machine_code}`);
    console.log(`Machine Name: ${r.machine_name}`);
    console.log(`Date: ${r.date}`);
    console.log(`Problem: ${r.full_report ? r.full_report.problem : "N/A"}`);
    console.log(`Solution: ${r.full_report ? r.full_report.solution : "N/A"}`);
    console.log(`Report: ${r.full_report ? (r.full_report.cleaned_report || r.full_report.report).slice(0, 80) + '...' : "N/A"}`);
  });
}

test().catch(console.error);
