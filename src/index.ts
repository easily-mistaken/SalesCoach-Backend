import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import routes from "./routes";
import { authMiddleware } from "./middleware/auth";
import cookieParser from "cookie-parser";
import http from "http";
import https from "https";
import fs from "fs";

dotenv.config();

const app = express();

// Middleware
app.use(express.json());

// Use cookie-parser middleware
app.use(cookieParser());

// CORS configuration - update this with your frontend URL if needed
app.use(
  cors({
    origin: "https://prajjwal.site", // Your frontend domain
    credentials: true,
  })
);

// Use the routes
app.use("/api", routes);

// Middleware to check if the user is authenticated
app.get("/", authMiddleware, (req, res) => {
  res.status(200).json({ message: "API is running" });
});

// Create HTTP server for redirecting to HTTPS
const httpApp = express();
httpApp.use((req, res) => {
  res.redirect(`https://${req.headers.host}${req.url}`);
});

// Start HTTP server on port 80 (for redirects)
try {
  http.createServer(httpApp).listen(80, () => {
    console.log("HTTP server running on port 80 (redirecting to HTTPS)");
  });
} catch (error) {
  console.error("Failed to start HTTP server:", error);
}

// Start HTTPS server on port 443
try {
  const privateKey = fs.readFileSync(
    "/etc/letsencrypt/live/api.prajjwal.site/privkey.pem",
    "utf8"
  );
  const certificate = fs.readFileSync(
    "/etc/letsencrypt/live/api.prajjwal.site/fullchain.pem",
    "utf8"
  );

  const credentials = {
    key: privateKey,
    cert: certificate,
  };

  https.createServer(credentials, app).listen(443, () => {
    console.log("HTTPS server running on port 443");
  });
} catch (error) {
  console.error("Failed to start HTTPS server:", (error as Error).message);
  console.log(
    "Certificate files may not exist yet or you need permission to read them"
  );

  // Fall back to HTTP on development port if HTTPS setup fails
  const devPort = process.env.PORT || 3001;
  app.listen(devPort, () => {
    console.log(
      `⚠️ FALLBACK: Server running on HTTP port ${devPort} (no HTTPS)`
    );
  });
}
