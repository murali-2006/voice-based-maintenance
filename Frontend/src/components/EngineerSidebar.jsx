import { Link, useNavigate } from "react-router-dom";

import {
  LayoutDashboard,
  Mic,
  FileText,
  LogOut,
} from "lucide-react";

import "./EngineerSidebar.css";

function EngineerSidebar() {
  const navigate = useNavigate();

  const handleLogout = () => {
    localStorage.removeItem("isLoggedIn");
    localStorage.removeItem("userId");
    localStorage.removeItem("userRole");
    localStorage.removeItem("userName");

    navigate("/", { replace: true });
  };

  return (
    <aside className="engineer-sidebar">

      {/* Logo */}
      <h2 className="engineer-logo">
        Maintenance System
      </h2>

      {/* Navigation */}
      <nav className="engineer-nav">

        <Link to="/engineer/dashboard">
          <LayoutDashboard size={20} />
          <span>Dashboard</span>
        </Link>

        <Link to="/engineer/report">
          <Mic size={20} />
          <span>New Voice Report</span>
        </Link>

        <Link to="/engineer/history">
          <FileText size={20} />
          <span>Report History</span>
        </Link>

      </nav>

      {/* Logout at bottom */}
      <button
        type="button"
        className="engineer-logout"
        onClick={handleLogout}
      >
        <LogOut size={20} />
        <span>Logout</span>
      </button>

    </aside>
  );
}

export default EngineerSidebar;