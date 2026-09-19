import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  FileText,
  Wrench,
  Clock,
  Mic,
  History,
} from "lucide-react";

import DashboardLayout from "../../layouts/DashboardLayout";
import "./EngineerDashboard.css";
import { API_BASE_URL } from "../../config/api";

function EngineerDashboard() {
  const navigate = useNavigate();

  const [reports, setReports] = useState([]);

  // Get reports from the backend API
  useEffect(() => {
    fetch(`${API_BASE_URL}/reports`)
      .then((response) => response.json())
      .then((data) => {
        setReports(data);
      })
      .catch((error) => {
        console.error(
          "Error fetching reports:",
          error
        );
      });
  }, []);

  const totalReports = reports.length;

  const machines = [
    ...new Set(
      reports.map((item) => item.machine_id)
    ),
  ];

  // Pending or In-Progress maintenance reports
  const pendingReports = reports.filter(
    (item) =>
      String(item.maintenance_status || "")
        .toLowerCase()
        .includes("pending") ||
      String(item.maintenance_status || "")
        .toLowerCase()
        .includes("progress")
  ).length;

  return (
    <DashboardLayout>
      <div className="engineer-dashboard">

        <div className="dashboard-header">
          <div>
            <h1>Dashboard</h1>

            <p>
              Welcome back! Here's your maintenance activity overview.
            </p>
          </div>
        </div>

        {/* Dashboard Cards */}
        <div className="dashboard-cards">

          <div className="dashboard-card">
            <FileText
              size={32}
              className="card-icon"
            />

            <div>
              <h3>Total Reports</h3>
              <h2>{totalReports}</h2>
            </div>
          </div>

          <div className="dashboard-card">
            <Wrench
              size={32}
              className="card-icon"
            />

            <div>
              <h3>Machines Checked</h3>
              <h2>{machines.length}</h2>
            </div>
          </div>

          <div className="dashboard-card">
            <Clock
              size={32}
              className="card-icon"
            />

            <div>
              <h3>Pending Reports</h3>
              <h2>{pendingReports}</h2>
            </div>
          </div>

        </div>

        {/* Quick Actions */}
        <div className="quick-actions">

          <h2>Quick Actions</h2>

          <div className="action-buttons">

            <button
              className="primary-action"
              onClick={() =>
                navigate("/engineer/report")
              }
            >
              <Mic size={18} />
              New Voice Report
            </button>

            <button
              className="secondary-action"
              onClick={() =>
                navigate("/engineer/history")
              }
            >
              <History size={18} />
              Report History
            </button>

          </div>

        </div>

      </div>
    </DashboardLayout>
  );
}

export default EngineerDashboard;