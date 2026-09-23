import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import {
  LayoutDashboard,
  Mic,
  FileText,
  LogOut,
  Menu,
  X,
} from "lucide-react";

import "./EngineerSidebar.css";

function EngineerSidebar() {
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
        className="engineer-mobile-toggle"
        onClick={() => setIsOpen(true)}
        aria-label="Open sidebar"
      >
        <Menu size={22} />
      </button>

      {/* Backdrop Overlay */}
      {isOpen && (
        <div
          className="engineer-sidebar-overlay"
          onClick={closeSidebar}
          aria-hidden="true"
        />
      )}

      {/* Sidebar Drawer */}
      <aside className={`engineer-sidebar ${isOpen ? "open" : ""}`}>
        {/* Header with Logo and Close button */}
        <div className="engineer-sidebar-header">
          <h2 className="engineer-logo">Maintenance System</h2>
          <button
            type="button"
            className="engineer-sidebar-close"
            onClick={closeSidebar}
            aria-label="Close sidebar"
          >
            <X size={20} />
          </button>
        </div>

        {/* Navigation */}
        <nav className="engineer-nav">
          <Link to="/engineer/dashboard" onClick={closeSidebar}>
            <LayoutDashboard size={20} />
            <span>Dashboard</span>
          </Link>

          <Link to="/engineer/report" onClick={closeSidebar}>
            <Mic size={20} />
            <span>New Voice Report</span>
          </Link>

          <Link to="/engineer/history" onClick={closeSidebar}>
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
    </>
  );
}

export default EngineerSidebar;