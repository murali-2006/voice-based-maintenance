import { useEffect, useState } from "react";
import {
  Trash2,
  FileText,
  RefreshCw,
} from "lucide-react";

import DashboardLayout from "../../layouts/DashboardLayout";
import "./ReportHistory.css";
import { API_BASE_URL } from "../../config/api";

function ReportHistory() {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // ==========================================
  // SAFE TEXT CONVERSION
  // ==========================================
  const safeText = (value) => {
    if (value === null || value === undefined) {
      return "N/A";
    }

    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      return String(value);
    }

    // Firestore timestamp object
    if (
      typeof value === "object" &&
      value._seconds !== undefined
    ) {
      return new Date(
        Number(value._seconds) * 1000
      ).toLocaleString();
    }

    if (
      typeof value === "object" &&
      value.seconds !== undefined
    ) {
      return new Date(
        Number(value.seconds) * 1000
      ).toLocaleString();
    }

    try {
      return JSON.stringify(value);
    } catch {
      return "N/A";
    }
  };

  // ==========================================
  // FORMAT DATE
  // ==========================================
  const formatDate = (date) => {
    if (!date) {
      return "N/A";
    }

    if (typeof date === "string") {
      const parsedDate = new Date(date);

      if (!Number.isNaN(parsedDate.getTime())) {
        return parsedDate.toLocaleString();
      }

      return date;
    }

    if (
      typeof date === "object" &&
      date._seconds !== undefined
    ) {
      return new Date(
        Number(date._seconds) * 1000
      ).toLocaleString();
    }

    if (
      typeof date === "object" &&
      date.seconds !== undefined
    ) {
      return new Date(
        Number(date.seconds) * 1000
      ).toLocaleString();
    }

    if (date instanceof Date) {
      return date.toLocaleString();
    }

    return safeText(date);
  };

  // ==========================================
  // LOAD REPORTS WHEN PAGE OPENS
  // ==========================================
  useEffect(() => {
    let cancelled = false;

    const loadReports = async () => {
      try {
        setLoading(true);
        setError("");

        const response = await fetch(
          `${API_BASE_URL}/reports`
        );

        const data = await response.json();

        console.log(
          "Reports API response:",
          data
        );

        if (!response.ok) {
          throw new Error(
            data.message ||
              "Failed to fetch reports"
          );
        }

        if (!Array.isArray(data)) {
          throw new Error(
            "Invalid reports data received from server"
          );
        }

        if (!cancelled) {
          setReports(data);
        }
      } catch (error) {
        console.error(
          "Error fetching reports:",
          error
        );

        if (!cancelled) {
          setReports([]);

          setError(
            error.message ||
              "Unable to load maintenance reports."
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    loadReports();

    return () => {
      cancelled = true;
    };
  }, []);

  // ==========================================
  // REFRESH REPORTS
  // ==========================================
  const handleRefresh = async () => {
    try {
      setLoading(true);
      setError("");

      const response = await fetch(
        `${API_BASE_URL}/reports`
      );

      const data = await response.json();

      console.log(
        "Reports refreshed:",
        data
      );

      if (!response.ok) {
        throw new Error(
          data.message ||
            "Failed to fetch reports"
        );
      }

      if (!Array.isArray(data)) {
        throw new Error(
          "Invalid reports data received from server"
        );
      }

      setReports(data);
    } catch (error) {
      console.error(
        "Refresh error:",
        error
      );

      setReports([]);

      setError(
        error.message ||
          "Unable to refresh reports."
      );
    } finally {
      setLoading(false);
    }
  };

  // ==========================================
  // DELETE REPORT
  // ==========================================
  const handleDelete = async (id) => {
    const confirmDelete = window.confirm(
      "Are you sure you want to delete this report?"
    );

    if (!confirmDelete) {
      return;
    }

    try {
      const response = await fetch(
        `${API_BASE_URL}/reports/${id}`,
        {
          method: "DELETE",
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.message ||
            "Failed to delete report"
        );
      }

      setReports((previousReports) =>
        previousReports.filter(
          (item) => item.id !== id
        )
      );

      alert(
        "Report deleted successfully!"
      );
    } catch (error) {
      console.error(
        "Error deleting report:",
        error
      );

      alert(
        error.message ||
          "Failed to delete report. Please try again."
      );
    }
  };

  // ==========================================
  // UI
  // ==========================================
  return (
    <DashboardLayout>
      <div className="report-history">

        {/* HEADER */}
        <div className="report-history-header">
          <div>
            <h1>
              Maintenance Report History
            </h1>

            <p>
              View your previously submitted
              maintenance reports.
            </p>
          </div>

          <button
            className="refresh-history-button"
            onClick={handleRefresh}
            disabled={loading}
          >
            <RefreshCw
              size={18}
              className={
                loading
                  ? "refresh-loading"
                  : ""
              }
            />

            Refresh
          </button>
        </div>

        {/* ERROR */}
        {error && (
          <div className="history-error">
            {safeText(error)}
          </div>
        )}

        {/* LOADING */}
        {loading ? (
          <div className="no-reports">
            <FileText
              size={40}
              className="no-reports-icon"
            />

            <h3>
              Loading reports...
            </h3>

            <p>
              Please wait while the reports
              are loaded.
            </p>
          </div>
        ) : reports.length === 0 ? (
          /* NO REPORTS */
          <div className="no-reports">
            <FileText
              size={40}
              className="no-reports-icon"
            />

            <h3>
              No Reports Found
            </h3>

            <p>
              No maintenance reports have
              been submitted yet.
            </p>
          </div>
        ) : (
          /* REPORT LIST */
          <div className="report-history-list">
            {reports.map((item) => (
              <div
                key={safeText(item.id)}
                className="history-card"
              >
                <div className="history-details">

                  {/* MACHINE */}
                  <h3>
                    {safeText(
                      item.machine_name ||
                        `Machine ID: ${safeText(
                          item.machine_id
                        )}`
                    )}
                  </h3>

                  <p>
                    <strong>
                      Machine Code:
                    </strong>{" "}
                    {safeText(
                      item.machine_code
                    )}
                  </p>

                  <p>
                    <strong>
                      Machine ID:
                    </strong>{" "}
                    {safeText(
                      item.machine_id
                    )}
                  </p>

                  <p>
                    <strong>
                      Engineer ID:
                    </strong>{" "}
                    {safeText(
                      item.engineer_id
                    )}
                  </p>

                  {/* ORIGINAL REPORT */}
                  <p>
                    <strong>
                      Report:
                    </strong>{" "}
                    {safeText(
                      item.report
                    )}
                  </p>

                  {/* ANALYZED DATA */}
                  <p>
                    <strong>
                      Problem:
                    </strong>{" "}
                    {safeText(
                      item.problem
                    ) !== "N/A"
                      ? safeText(item.problem)
                      : "Not identified"}
                  </p>

                  <p>
                    <strong>
                      Solution:
                    </strong>{" "}
                    {safeText(
                      item.solution
                    ) !== "N/A"
                      ? safeText(item.solution)
                      : "Not identified"}
                  </p>

                  <p>
                    <strong>
                      Status:
                    </strong>{" "}
                    {safeText(
                      item.maintenance_status
                    ) !== "N/A"
                      ? safeText(
                          item.maintenance_status
                        )
                      : "Not identified"}
                  </p>

                  <p>
                    <strong>
                      Maintenance Time:
                    </strong>{" "}
                    {safeText(
                      item.maintenance_time
                    ) !== "N/A"
                      ? safeText(
                          item.maintenance_time
                        )
                      : "Not identified"}
                  </p>

                  {/* DATE */}
                  <p>
                    <strong>
                      Date:
                    </strong>{" "}
                    {formatDate(
                      item.created_at
                    )}
                  </p>
                </div>

                {/* DELETE */}
                <button
                  onClick={() =>
                    handleDelete(item.id)
                  }
                  className="delete-button"
                >
                  <Trash2 size={18} />
                  Delete
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}

export default ReportHistory;