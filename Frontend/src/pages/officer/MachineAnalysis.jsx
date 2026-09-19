import { useEffect, useState } from "react";
import {
  PlusCircle,
  X,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
} from "lucide-react";
import OfficerSidebar from "../../components/OfficerSidebar";
import "./MachineAnalysis.css";
import { API_BASE_URL } from "../../config/api";

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

        </div>

      </main>

    </div>
  );
}

export default MachineAnalysis;