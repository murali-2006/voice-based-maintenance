const { initializeApp, cert, getApps } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const fs = require("fs");
const path = require("path");

let credential;

// 1. Check for raw or base64 JSON string in FIREBASE_SERVICE_ACCOUNT (Render/Cloud)
if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  try {
    let raw = process.env.FIREBASE_SERVICE_ACCOUNT.trim();
    // Support base64 encoded JSON string if provided
    if (!raw.startsWith("{") && raw.length > 20) {
      raw = Buffer.from(raw, "base64").toString("utf-8");
    }
    const serviceAccount = JSON.parse(raw);
    credential = cert(serviceAccount);
    console.log("Firebase Admin initialized from FIREBASE_SERVICE_ACCOUNT environment variable.");
  } catch (err) {
    console.error("Failed to parse FIREBASE_SERVICE_ACCOUNT environment variable:", err.message);
  }
}

// 2. Check for individual environment variables
if (!credential && process.env.FIREBASE_PRIVATE_KEY && process.env.FIREBASE_CLIENT_EMAIL) {
  try {
    credential = cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    });
    console.log("Firebase Admin initialized from individual Firebase environment variables.");
  } catch (err) {
    console.error("Failed to initialize from individual Firebase environment variables:", err.message);
  }
}

// 3. Fallback to local serviceAccountKey.json for offline development
if (!credential) {
  const localKeyPath = path.join(__dirname, "serviceAccountKey.json");
  if (fs.existsSync(localKeyPath)) {
    try {
      const serviceAccount = require(localKeyPath);
      credential = cert(serviceAccount);
      console.log("Firebase Admin initialized from local serviceAccountKey.json file.");
    } catch (err) {
      console.error("Failed to load local serviceAccountKey.json:", err.message);
    }
  }
}

if (!credential) {
  console.warn("Warning: No Firebase credentials found. Database operations will fail unless credentials are provided.");
}

if (!getApps().length && credential) {
  initializeApp({
    credential,
  });
}

const db = getFirestore();

module.exports = db;