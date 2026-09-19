import { useEffect, useState } from "react";
import OfficerSidebar from "../../components/OfficerSidebar";
import "./OfficerReports.css";
import { API_BASE_URL } from "../../config/api";

function OfficerReports() {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadReports = async () => {
      try {
        const response = await fetch(
          `${API_BASE_URL}/reports`
        );

        if (!response.ok) {
          throw new Error(
            "Failed to fetch reports"
          );
        }

        const data = await response.json();

        setReports(data);
      } catch (error) {
        console.error(
          "Error fetching reports:",
          error
        );
      } finally {
        setLoading(false);
      }
    };

    loadReports();
  }, []);

  return (
    <div className="officer-reports-layout">

      <OfficerSidebar />

      <main className="officer-reports-main">

        <div className="officer-reports-page">

          {/* HEADER */}

          <div className="officer-reports-header">

            <div>
              <h1>
                Maintenance Reports
              </h1>

              <p>
                View and monitor all submitted
                maintenance reports.
              </p>
            </div>

            <div className="reports-count">
              {reports.length} Reports
            </div>

          </div>

          {/* CONTENT */}

          {loading ? (
            <div className="reports-message">
              Loading reports...
            </div>
          ) : reports.length === 0 ? (

            <div className="reports-empty-state">

              <div className="empty-icon">
                📄
              </div>

              <h3>
                No Reports Available
              </h3>

              <p>
                No maintenance reports have
                been submitted yet.
              </p>

            </div>

          ) : (

            <div className="officer-reports-grid">

              {reports.map((item, index) => (

                <div
                  className="officer-report-card"
                  key={item.id || index}
                >

                  {/* CARD HEADER */}

                  <div className="officer-report-card-header">

                    <div>
                      <h2>
                        {item.machine_name ||
                          `Machine ID: ${item.machine_id}`}
                      </h2>

                      {item.machine_code && (
                        <span className="machine-code">
                          {item.machine_code}
                        </span>
                      )}
                    </div>

                    <span className="report-date">
                      {item.created_at
                        ? new Date(
                            item.created_at
                          ).toLocaleString()
                        : "Date unavailable"}
                    </span>

                  </div>

                  {/* REPORT DETAILS */}

                  <div className="officer-report-details">

                    <div className="officer-report-row">
                      <span>
                        Machine ID
                      </span>

                      <strong>
                        {item.machine_id ||
                          "Not available"}
                      </strong>
                    </div>

                    <div className="officer-report-row">
                      <span>
                        Engineer ID
                      </span>

                      <strong>
                        {item.engineer_id ||
                          "Not available"}
                      </strong>
                    </div>

                    <div className="officer-report-row">
                      <span>
                        Problem
                      </span>

                      <strong>
                        {item.problem ||
                          "Not available"}
                      </strong>
                    </div>

                    <div className="officer-report-row">
                      <span>
                        Solution
                      </span>

                      <strong>
                        {item.solution ||
                          "Not available"}
                      </strong>
                    </div>

                    <div className="officer-report-row">
                      <span>
                        Status
                      </span>

                      <strong
                        className="officer-report-status"
                      >
                        {item.maintenance_status ||
                          "Unknown"}
                      </strong>
                    </div>

                    <div className="officer-report-row">
                      <span>
                        Maintenance Time
                      </span>

                      <strong>
                        {item.maintenance_time ||
                          "Not available"}
                      </strong>
                    </div>

                  </div>

                  {/* FULL REPORT */}

                  <div className="officer-full-report">

                    <h3>
                      Report
                    </h3>

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

      </main>

    </div>
  );
}

export default OfficerReports;