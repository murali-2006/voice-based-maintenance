// Centralized API configuration for production deployment
// Reads dynamic URLs from environment variables with fallback to localhost

export const API_BASE_URL = (
  import.meta.env.VITE_API_URL || "http://localhost:5000"
).replace(/\/+$/, "");

export const ML_BASE_URL = (
  import.meta.env.VITE_ML_API_URL || "http://localhost:8000"
).replace(/\/+$/, "");
