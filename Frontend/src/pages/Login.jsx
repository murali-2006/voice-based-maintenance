import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Factory,
  Eye,
  EyeOff,
} from "lucide-react";

import "./Login.css";
import { API_BASE_URL } from "../config/api";

function Login() {
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [showPassword, setShowPassword] =
    useState(false);

  const [error, setError] = useState("");

  const handleLogin = async (event) => {
    event.preventDefault();

    setError("");

    try {
      const response = await fetch(
        `${API_BASE_URL}/login`,
        {
          method: "POST",

          headers: {
            "Content-Type": "application/json",
          },

          body: JSON.stringify({
            email,
            password,
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        setError(
          data.message ||
          "Invalid email or password"
        );

        return;
      }

      // Save login information
      localStorage.setItem(
        "isLoggedIn",
        "true"
      );

      localStorage.setItem(
        "userId",
        data.user.id
      );

      localStorage.setItem(
        "userRole",
        data.user.role
      );

      localStorage.setItem(
        "userName",
        data.user.name
      );

      // Navigate based on user role
      if (data.user.role === "ENGINEER") {
        navigate("/engineer/dashboard");
      } else if (data.user.role === "OFFICER") {
        navigate("/officer/dashboard");
      }

    } catch (error) {
      console.error("Login error:", error);

      setError(
        "Unable to connect to the server. Please try again."
      );
    }
  };

  return (
    <div className="login-page">
      <div className="login-container">

        {/* Header */}
        <div className="login-header">

          <div className="login-logo">
            <Factory size={34} />
            <h1>Voice Based</h1>
          </div>

          <p>
            Maintenance Management System
          </p>

        </div>

        {/* Form */}
        <form
          className="login-form"
          onSubmit={handleLogin}
        >

          {/* Error Message */}
          {error && (
            <p className="login-error">
              {error}
            </p>
          )}

          {/* Email */}
          <div className="input-group">

            <label>Email</label>

            <input
              type="email"
              placeholder="Enter your email"
              value={email}
              onChange={(event) =>
                setEmail(event.target.value)
              }
              required
            />

          </div>

          {/* Password */}
          <div className="input-group">

            <label>Password</label>

            <div className="password-wrapper">

              <input
                type={
                  showPassword
                    ? "text"
                    : "password"
                }
                placeholder="Enter your password"
                value={password}
                onChange={(event) =>
                  setPassword(event.target.value)
                }
                autoComplete="current-password"
                required
              />

              <button
                type="button"
                className="password-toggle"
                onClick={() =>
                  setShowPassword(!showPassword)
                }
              >
                {showPassword ? (
                  <EyeOff size={20} />
                ) : (
                  <Eye size={20} />
                )}
              </button>

            </div>

          </div>

          <button
            type="submit"
            className="login-button"
          >
            Login
          </button>

        </form>

      </div>
    </div>
  );
}

export default Login;