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

// 3. Check for Secret File on Render or local filesystem
if (!credential) {
  const candidateKeyPaths = [
    process.env.FIREBASE_KEY_PATH,
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH,
    "/etc/secrets/serviceAccountKey.json",
    path.join(__dirname, "serviceAccountKey.json"),
    path.join(process.cwd(), "serviceAccountKey.json"),
    path.join(process.cwd(), "Backend", "serviceAccountKey.json"),
  ].filter(Boolean);

  for (const candidatePath of candidateKeyPaths) {
    if (fs.existsSync(candidatePath)) {
      try {
        const fileContent = fs.readFileSync(candidatePath, "utf-8");
        const serviceAccount = JSON.parse(fileContent);
        credential = cert(serviceAccount);
        console.log(`Firebase Admin initialized successfully from file: ${candidatePath}`);
        break;
      } catch (err) {
        console.error(`Failed to parse Firebase credential file at ${candidatePath}:`, err.message);
      }
    }
  }
}

if (!credential) {
  const errMsg =
    "FATAL ERROR: No Firebase credentials found! " +
    "Please provide FIREBASE_SERVICE_ACCOUNT environment variable or configure serviceAccountKey.json in Render Secret Files (/etc/secrets/serviceAccountKey.json).";
  console.error(errMsg);
  throw new Error(errMsg);
}

if (!getApps().length) {
  initializeApp({
    credential,
  });
  console.log("Firebase App initialized successfully.");
}

const db = getFirestore();

module.exports = db;