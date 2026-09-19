import { Navigate } from "react-router-dom";

function ProtectedRoute({ children, allowedRole }) {
  const isLoggedIn =
    localStorage.getItem("isLoggedIn");

  const userRole =
    localStorage.getItem("userRole");

  // Check login
  if (isLoggedIn !== "true") {
    return <Navigate to="/" replace />;
  }

  // Check user role
  if (
    allowedRole &&
    userRole !== allowedRole
  ) {
    if (userRole === "ENGINEER") {
      return (
        <Navigate
          to="/engineer/dashboard"
          replace
        />
      );
    }

    if (userRole === "OFFICER") {
      return (
        <Navigate
          to="/officer/dashboard"
          replace
        />
      );
    }

    return <Navigate to="/" replace />;
  }

  return children;
}

export default ProtectedRoute;