import {
  NavLink,
  useNavigate,
} from "react-router-dom";

import {
  LayoutDashboard,
  FileText,
  TriangleAlert,
  LogOut,
} from "lucide-react";

import "./OfficerSidebar.css";

function OfficerSidebar() {
  const navigate = useNavigate();

const handleLogout = () => {
  localStorage.removeItem("isLoggedIn");
  localStorage.removeItem("userId");
  localStorage.removeItem("userRole");
  localStorage.removeItem("userName");

  navigate("/", { replace: true });
};

  return (
    <div className="officer-sidebar">

      <h2 className="officer-logo">
        Maintenance System
      </h2>

      <nav className="officer-nav">

        <NavLink
          to="/officer/dashboard"
          className={({ isActive }) =>
            isActive ? "active-link" : ""
          }
        >
          <LayoutDashboard size={20} />
          <span>Dashboard</span>
        </NavLink>

        <NavLink
          to="/officer/reports"
          className={({ isActive }) =>
            isActive ? "active-link" : ""
          }
        >
          <FileText size={20} />
          <span>All Reports</span>
        </NavLink>

        <NavLink
          to="/officer/analysis"
          className={({ isActive }) =>
            isActive ? "active-link" : ""
          }
        >
          <TriangleAlert size={20} />
          <span>Machine Analysis</span>
        </NavLink>

      </nav>

      <button
        className="officer-logout"
        onClick={handleLogout}
      >
        <LogOut size={20} />
        <span>Logout</span>
      </button>

    </div>
  );
}

export default OfficerSidebar;