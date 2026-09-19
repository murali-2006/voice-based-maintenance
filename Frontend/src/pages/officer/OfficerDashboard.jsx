import { useEffect, useState } from "react";
import OfficerSidebar from "../../components/OfficerSidebar";
import {
  Check,
  X,
  RefreshCw,
  AlertTriangle,
  Clock,
  Wrench,
  Building,
  Hash,
  Cpu,
  MapPin,
  User,
  FileText,
  CheckCircle2,
  AlertCircle,
  Inbox,
  ShieldCheck,
} from "lucide-react";
import "./OfficerDashboard.css";
import { API_BASE_URL } from "../../config/api";

function OfficerDashboard() {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);

  // Pending Machine Requests
  const [pendingRequests, setPendingRequests] = useState([]);
  const [loadingPending, setLoadingPending] = useState(true);
  const [actionLoadingId, setActionLoadingId] = useState(null);
  const [actionFeedback, setActionFeedback] = useState(null);

  // Editable machine names per request ID (for officer adjustments before confirm)
  const [customMachineNames, setCustomMachineNames] = useState({});

  // =====================================================
  // FETCH ALL MAINTENANCE REPORTS
  // =====================================================
  const loadReports = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/reports`);
      if (!response.ok) {
        throw new Error("Failed to fetch reports");
      }
      const data = await response.json();
      setReports(data);
    } catch (error) {
      console.error("Error fetching reports:", error);
    } finally {
      setLoading(false);
    }
  };

  // =====================================================
  // FETCH PENDING MACHINE REQUESTS (HEAD OFFICER ONLY)
  // =====================================================
  const loadPendingRequests = async () => {
    try {
      setLoadingPending(true);
      const response = await fetch(
        `${API_BASE_URL}/pending-machines?status=PENDING`
      );
      if (!response.ok) {
        throw new Error("Failed to fetch pending machine requests");
      }
      const data = await response.json();
      setPendingRequests(data);

      // Initialize default names for editing
      const initialNames = {};
      data.forEach((req) => {
        initialNames[req.id] = req.machine_name || "";
      });
      setCustomMachineNames((prev) => ({ ...initialNames, ...prev }));
    } catch (error) {
      console.error("Error fetching pending requests:", error);
    } finally {
      setLoadingPending(false);
    }
  };

  useEffect(() => {
    loadReports();
    loadPendingRequests();
  }, []);

  // Clear action feedback after 6 seconds
  useEffect(() => {
    if (actionFeedback) {
      const timer = setTimeout(() => setActionFeedback(null), 6000);
      return () => clearTimeout(timer);
    }
  }, [actionFeedback]);

  // =====================================================
  // CONFIRM & ADD MACHINE (APPROVE)
  // =====================================================
  const handleApprove = async (request) => {
    try {
      setActionLoadingId(request.id);
      const officerId =
        localStorage.getItem("userId") ||
        localStorage.getItem("userName") ||
        "officer1";

      const finalName =
        (customMachineNames[request.id] || request.machine_name || "").trim() ||
        request.machine_code;

      const response = await fetch(
        `${API_BASE_URL}/pending-machines/${request.id}/approve`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-user-role": "OFFICER",
            "x-user-id": officerId,
          },
          body: JSON.stringify({
            role: "OFFICER",
            officer_id: officerId,
            machine_name: finalName,
          }),
        }
      );

      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.message || "Failed to approve machine request.");
      }

      setActionFeedback({
        type: "success",
        text: `Machine '${request.machine_code}' approved and registered! ID #${result.machine?.machine_id} assigned. Draft report finalized.`,
      });

      // Refresh both pending requests and reports
      await Promise.all([loadPendingRequests(), loadReports()]);
    } catch (error) {
      console.error("Error approving request:", error);
      setActionFeedback({
        type: "error",
        text: error.message || "Failed to approve machine request.",
      });
    } finally {
      setActionLoadingId(null);
    }
  };

  // =====================================================
  // REJECT MACHINE REQUEST
  // =====================================================
  const handleReject = async (request) => {
    if (
      !window.confirm(
        `Are you sure you want to reject registration for machine '${request.machine_code}'?`
      )
    ) {
      return;
    }

    try {
      setActionLoadingId(request.id);
      const officerId =
        localStorage.getItem("userId") ||
        localStorage.getItem("userName") ||
        "officer1";

      const response = await fetch(
        `${API_BASE_URL}/pending-machines/${request.id}/reject`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-user-role": "OFFICER",
            "x-user-id": officerId,
          },
          body: JSON.stringify({
            role: "OFFICER",
            officer_id: officerId,
            reason: "Rejected by Head Officer",
          }),
        }
      );

      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.message || "Failed to reject machine request.");
      }

      setActionFeedback({
        type: "info",
        text: `Registration request for machine '${request.machine_code}' has been rejected.`,
      });

      await loadPendingRequests();
    } catch (error) {
      console.error("Error rejecting request:", error);
      setActionFeedback({
        type: "error",
        text: error.message || "Failed to reject machine request.",
      });
    } finally {
      setActionLoadingId(null);
    }
  };

  /* =====================================================
     TOTAL REPORTS
     ===================================================== */
  const totalReports = reports.length;

  /* =====================================================
     UNIQUE MACHINES
     ===================================================== */
  const machines = [
    ...new Set(reports.map((item) => String(item.machine_id))),
  ];

  /* =====================================================
     REPEATED FAULT MACHINES
     ===================================================== */
  const repeatedMachines = machines
    .map((machineId) => {
      const machineReports = reports.filter(
        (item) => String(item.machine_id) === String(machineId)
      );

      const problemCounts = {};
      machineReports.forEach((item) => {
        if (item.problem && item.problem.trim() !== "") {
          const problem = item.problem.trim().toLowerCase();
          problemCounts[problem] = (problemCounts[problem] || 0) + 1;
        }
      });

      const repeatedProblems = Object.entries(problemCounts)
        .filter(([, count]) => count > 1)
        .map(([problem, count]) => ({
          problem,
          count,
        }));

      return {
        machineId,
        repeatedProblems,
      };
    })
    .filter((machine) => machine.repeatedProblems.length > 0);

  /* =====================================================
     RECENT REPORTS
     ===================================================== */
  const recentReports = reports.slice(0, 5);

  return (
    <div className="officer-layout">
      {/* SIDEBAR */}
      <OfficerSidebar />

      {/* MAIN CONTENT */}
      <main className="officer-main">
        <div className="officer-dashboard">
          {/* =================================================
              HEADER
              ================================================= */}
          <div className="officer-dashboard-header">
            <div>
              <h1>Head Officer Dashboard</h1>
              <p>
                Monitor maintenance reports, machine activities, and review new
                equipment registration requests.
              </p>
            </div>
          </div>

          {/* =================================================
              ACTION FEEDBACK BANNER
              ================================================= */}
          {actionFeedback && (
            <div className={`officer-action-banner banner-${actionFeedback.type}`}>
              {actionFeedback.type === "success" && <CheckCircle2 size={18} />}
              {actionFeedback.type === "error" && <AlertCircle size={18} />}
              {actionFeedback.type === "info" && <Inbox size={18} />}
              <span>{actionFeedback.text}</span>
            </div>
          )}

          {/* =================================================
              SUMMARY CARDS
              ================================================= */}
          <div className="officer-dashboard-cards">
            <div className="officer-dashboard-card reports-card">
              <h3>Total Reports</h3>
              <h2>{totalReports}</h2>
            </div>

            <div className="officer-dashboard-card machines-card">
              <h3>Machines Monitored</h3>
              <h2>{machines.length}</h2>
            </div>

            <div className="officer-dashboard-card pending-card">
              <h3>Pending Machine Requests</h3>
              <h2>{pendingRequests.length}</h2>
            </div>

            <div className="officer-dashboard-card faults-card">
              <h3>Repeated Fault Machines</h3>
              <h2>{repeatedMachines.length}</h2>
            </div>
          </div>

          {/* =================================================
              NEW MACHINE REQUESTS SECTION (HEAD OFFICER APPROVAL)
              ================================================= */}
          <div className="officer-section pending-section">
            <div className="officer-section-header">
              <div>
                <h2>New Machine Requests</h2>
                <p>
                  Equipment mentioned in service reports awaiting Head Officer
                  confirmation and registry addition.
                </p>
              </div>

              <div className="section-header-right">
                <span className="section-badge pending-badge">
                  {pendingRequests.length} Pending
                </span>
                <button
                  type="button"
                  className="officer-refresh-btn"
                  onClick={loadPendingRequests}
                  disabled={loadingPending}
                  title="Refresh pending machine requests"
                >
                  <RefreshCw
                    size={14}
                    className={loadingPending ? "spin-icon" : ""}
                  />
                  <span>{loadingPending ? "Refreshing..." : "Refresh"}</span>
                </button>
              </div>
            </div>

            {loadingPending ? (
              <div className="officer-empty-state">
                <span className="state-icon">⏳</span>
                <h3>Loading Machine Requests</h3>
                <p>Checking pending registration queue...</p>
              </div>
            ) : pendingRequests.length === 0 ? (
              <div className="officer-empty-state">
                <span className="state-icon success-icon">✓</span>
                <h3>No Pending Machine Requests</h3>
                <p>
                  All machine registration requests have been reviewed and
                  resolved.
                </p>
              </div>
            ) : (
              <div className="pending-requests-list">
                {pendingRequests.map((req) => {
                  const isActing = actionLoadingId === req.id;
                  const draft = req.draft_report || {};
                  const reportText =
                    draft.cleaned_report ||
                    draft.original_text ||
                    "Draft report details attached to this request.";

                  return (
                    <div
                      key={req.id}
                      className="officer-report-item pending-request-card"
                    >
                      {/* CARD HEADER */}
                      <div className="pending-card-top">
                        <div className="pending-code-wrap">
                          <span className="pending-status-pill">PENDING REVIEW</span>
                          <h3 className="pending-code-title">
                            Machine Code: <strong>{req.machine_code}</strong>
                          </h3>
                        </div>

                        <div className="pending-meta-right">
                          <span className="pending-date">
                            <Clock size={12} className="meta-icon" />
                            {req.created_at
                              ? new Date(req.created_at).toLocaleString()
                              : "Recently"}
                          </span>
                          <span className="pending-engineer">
                            <User size={12} className="meta-icon" />
                            Requested By: {req.requested_by || "Service Engineer"}
                          </span>
                        </div>
                      </div>

                      {/* DETECTED DETAILS GRID */}
                      <div className="pending-details-grid">
                        <div className="pending-detail-item editable-name-item">
                          <label>
                            <Cpu size={14} /> Machine Name:
                          </label>
                          <input
                            type="text"
                            value={
                              customMachineNames[req.id] !== undefined
                                ? customMachineNames[req.id]
                                : req.machine_name || ""
                            }
                            onChange={(e) =>
                              setCustomMachineNames({
                                ...customMachineNames,
                                [req.id]: e.target.value,
                              })
                            }
                            placeholder={req.machine_name || "Enter Machine Name"}
                            className="officer-input-name"
                            disabled={isActing}
                          />
                        </div>

                        <div className="pending-detail-item">
                          <label>
                            <Wrench size={14} /> Machine Type:
                          </label>
                          <span className="detail-value">
                            {req.machine_type || "Not specified"}
                          </span>
                        </div>

                        <div className="pending-detail-item">
                          <label>
                            <Building size={14} /> Manufacturer:
                          </label>
                          <span className="detail-value">
                            {req.manufacturer || "Not specified"}
                          </span>
                        </div>

                        <div className="pending-detail-item">
                          <label>
                            <Hash size={14} /> Model Number:
                          </label>
                          <span className="detail-value">
                            {req.model_number || "Not specified"}
                          </span>
                        </div>

                        <div className="pending-detail-item">
                          <label>
                            <Hash size={14} /> Serial Number:
                          </label>
                          <span className="detail-value">
                            {req.serial_number || "Not specified"}
                          </span>
                        </div>

                        <div className="pending-detail-item">
                          <label>
                            <MapPin size={14} /> Location:
                          </label>
                          <span className="detail-value">
                            {req.location || "Not specified"}
                          </span>
                        </div>
                      </div>

                      {/* ASSOCIATED DRAFT REPORT PREVIEW */}
                      <div className="pending-report-preview">
                        <div className="preview-label">
                          <FileText size={13} />
                          <span>Associated Maintenance Report:</span>
                        </div>
                        <p className="preview-text">{reportText}</p>
                      </div>

                      {/* ACTION BUTTONS: CONFIRM & ADD vs REJECT */}
                      <div className="pending-actions-row">
                        <button
                          type="button"
                          className="btn-confirm-add"
                          onClick={() => handleApprove(req)}
                          disabled={isActing}
                          title="Confirm and register machine, then finalize draft report"
                        >
                          {isActing ? (
                            <>
                              <RefreshCw size={15} className="spin-icon" />
                              <span>Processing...</span>
                            </>
                          ) : (
                            <>
                              <Check size={16} />
                              <span>Confirm &amp; Add</span>
                            </>
                          )}
                        </button>

                        <button
                          type="button"
                          className="btn-reject-request"
                          onClick={() => handleReject(req)}
                          disabled={isActing}
                          title="Reject this machine registration request"
                        >
                          <X size={16} />
                          <span>Reject</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* =================================================
              LOADING MAIN REPORTS
              ================================================= */}
          {loading ? (
            <div className="officer-section">
              <div className="officer-empty-state">
                <span className="state-icon">⏳</span>
                <h3>Loading Reports</h3>
                <p>Fetching maintenance data...</p>
              </div>
            </div>
          ) : (
            <>
              {/* =============================================
                  REPEATED FAULT MACHINES
                  ============================================= */}
              <div className="officer-section">
                <div className="officer-section-header">
                  <div>
                    <h2>Repeated Fault Machines</h2>
                    <p>
                      Machines with the same maintenance problem occurring
                      multiple times.
                    </p>
                  </div>

                  <span className="section-badge warning-badge">
                    {repeatedMachines.length}
                  </span>
                </div>

                {repeatedMachines.length === 0 ? (
                  <div className="officer-empty-state">
                    <span className="state-icon success-icon">✓</span>
                    <h3>No Repeated Faults</h3>
                    <p>No repeated machine problems detected.</p>
                  </div>
                ) : (
                  <div className="repeated-machines-list">
                    {repeatedMachines.map((machine) => (
                      <div
                        key={machine.machineId}
                        className="officer-report-item repeated-machine-item"
                      >
                        <div className="report-item-header">
                          <div>
                            <h3>Machine ID: {machine.machineId}</h3>
                          </div>

                          <span className="problem-count-badge">
                            {machine.repeatedProblems.length} Repeated
                          </span>
                        </div>

                        <div className="repeated-problems-dashboard">
                          {machine.repeatedProblems.map((problem, index) => (
                            <div className="dashboard-problem-row" key={index}>
                              <span>{problem.problem}</span>
                              <strong>{problem.count} times</strong>
                            </div>
                          ))}
                        </div>

                        <p className="warning-message">
                          ⚠ This machine has recurring maintenance problems.
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* =============================================
                  RECENT REPORTS
                  ============================================= */}
              <div className="officer-section">
                <div className="officer-section-header">
                  <div>
                    <h2>Recent Maintenance Reports</h2>
                    <p>Latest maintenance activity submitted by engineers.</p>
                  </div>

                  <span className="section-badge reports-badge">
                    {Math.min(reports.length, 5)}
                  </span>
                </div>

                {reports.length === 0 ? (
                  <div className="officer-empty-state">
                    <span className="state-icon">📄</span>
                    <h3>No Reports Available</h3>
                    <p>No maintenance reports have been submitted yet.</p>
                  </div>
                ) : (
                  <div className="recent-reports-list">
                    {recentReports.map((item, index) => (
                      <div
                        key={item.id || index}
                        className="officer-report-item recent-report-item"
                      >
                        <div className="report-item-header">
                          <div>
                            <h3>
                              {item.machine_name ||
                                `Machine ID: ${item.machine_id}`}
                            </h3>

                            {item.machine_code && (
                              <span className="machine-code">
                                {item.machine_code}
                              </span>
                            )}
                          </div>

                          <span className="report-date">
                            {item.created_at
                              ? new Date(item.created_at).toLocaleString()
                              : "Date unavailable"}
                          </span>
                        </div>

                        <div className="recent-report-details">
                          <div className="dashboard-detail-row">
                            <span>Problem</span>
                            <strong>{item.problem || "Not available"}</strong>
                          </div>

                          <div className="dashboard-detail-row">
                            <span>Solution</span>
                            <strong>{item.solution || "Not available"}</strong>
                          </div>

                          <div className="dashboard-detail-row">
                            <span>Status</span>
                            <strong className="status-completed">
                              {item.maintenance_status || "Unknown"}
                            </strong>
                          </div>
                        </div>

                        <div className="dashboard-report-preview">
                          <span>Report</span>
                          <p>
                            {item.report ||
                              item.translated_report ||
                              "No report text available"}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}

export default OfficerDashboard;