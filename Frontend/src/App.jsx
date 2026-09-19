import {
  BrowserRouter,
  Routes,
  Route,
} from "react-router-dom";

import Login from "./pages/Login";

import EngineerDashboard from "./pages/engineer/EngineerDashboard";
import VoiceReport from "./pages/engineer/VoiceReport";
import ReportHistory from "./pages/engineer/ReportHistory";

import OfficerDashboard from "./pages/officer/OfficerDashboard";
import OfficerReports from "./pages/officer/OfficerReports";
import MachineAnalysis from "./pages/officer/MachineAnalysis";

import ProtectedRoute from "./components/ProtectedRoute";
import NotFound from "./pages/NotFound";

function App() {
  return (
    <BrowserRouter>
      <Routes>

        {/* Login */}
        <Route
          path="/"
          element={<Login />}
        />

        {/* Engineer Routes */}

        <Route
          path="/engineer/dashboard"
          element={
            <ProtectedRoute
              allowedRole="ENGINEER"
            >
              <EngineerDashboard />
            </ProtectedRoute>
          }
        />

        <Route
          path="/engineer/report"
          element={
            <ProtectedRoute
              allowedRole="ENGINEER"
            >
              <VoiceReport />
            </ProtectedRoute>
          }
        />

        <Route
          path="/engineer/history"
          element={
            <ProtectedRoute
              allowedRole="ENGINEER"
            >
              <ReportHistory />
            </ProtectedRoute>
          }
        />

        {/* Officer Routes */}

        <Route
          path="/officer/dashboard"
          element={
            <ProtectedRoute
              allowedRole="OFFICER"
            >
              <OfficerDashboard />
            </ProtectedRoute>
          }
        />

        <Route
          path="/officer/reports"
          element={
            <ProtectedRoute
              allowedRole="OFFICER"
            >
              <OfficerReports />
            </ProtectedRoute>
          }
        />

        <Route
          path="/officer/analysis"
          element={
            <ProtectedRoute
              allowedRole="OFFICER"
            >
              <MachineAnalysis />
            </ProtectedRoute>
          }
        />

        {/* 404 Fallback */}
        <Route path="*" element={<NotFound />} />

      </Routes>
    </BrowserRouter>
  );
}

export default App;