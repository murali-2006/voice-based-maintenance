import EngineerSidebar from "../components/EngineerSidebar";
import Navbar from "../components/Navbar";

import "./DashboardLayout.css";

function DashboardLayout({ children }) {
  return (
    <div className="dashboard-layout">

      <EngineerSidebar />

      <div className="dashboard-main">

        <Navbar />

        <main className="dashboard-content">
          {children}
        </main>

      </div>

    </div>
  );
}

export default DashboardLayout;