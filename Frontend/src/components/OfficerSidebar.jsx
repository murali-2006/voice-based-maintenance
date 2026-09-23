import { useState } from "react";
import {
  NavLink,
  useNavigate,
} from "react-router-dom";

import {
  LayoutDashboard,
  FileText,
  TriangleAlert,
  LogOut,
  Menu,
  X,
} from "lucide-react";

import "./OfficerSidebar.css";

function OfficerSidebar() {
  const [isOpen, setIsOpen] = useState(false);
  const navigate = useNavigate();

  const handleLogout = () => {
    localStorage.removeItem("isLoggedIn");
    localStorage.removeItem("userId");
    localStorage.removeItem("userRole");
    localStorage.removeItem("userName");
    setIsOpen(false);
    navigate("/", { replace: true });
  };

  const closeSidebar = () => setIsOpen(false);

  return (
    <>
      {/* Mobile Hamburger Button */}
      <button
        type="button"
        className="officer-mobile-toggle"
        onClick={() => setIsOpen(true)}
        aria-label="Open sidebar"
      >
        <Menu size={22} />
      </button>

      {/* Backdrop Overlay */}
      {isOpen && (
        <div
          className="officer-sidebar-overlay"
          onClick={closeSidebar}
          aria-hidden="true"
        />
      )}

      {/* Sidebar Drawer */}
      <aside className={`officer-sidebar ${isOpen ? "open" : ""}`}>
        <div className="officer-sidebar-header">
          <h2 className="officer-logo">
            Maintenance System
          </h2>
          <button
            type="button"
            className="officer-sidebar-close"
            onClick={closeSidebar}
            aria-label="Close sidebar"
          >
            <X size={20} />
          </button>
        </div>

        <nav className="officer-nav">
          <NavLink
            to="/officer/dashboard"
            className={({ isActive }) =>
              isActive ? "active-link" : ""
            }
            onClick={closeSidebar}
          >
            <LayoutDashboard size={20} />
            <span>Dashboard</span>
          </NavLink>

          <NavLink
            to="/officer/reports"
            className={({ isActive }) =>
              isActive ? "active-link" : ""
            }
            onClick={closeSidebar}
          >
            <FileText size={20} />
            <span>All Reports</span>
          </NavLink>

          <NavLink
            to="/officer/analysis"
            className={({ isActive }) =>
              isActive ? "active-link" : ""
            }
            onClick={closeSidebar}
          >
            <TriangleAlert size={20} />
            <span>Machine Analysis</span>
          </NavLink>
        </nav>

        <button
          type="button"
          className="officer-logout"
          onClick={handleLogout}
        >
          <LogOut size={20} />
          <span>Logout</span>
        </button>
      </aside>
    </>
  );
}

export default OfficerSidebar;