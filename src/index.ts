import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import routes from "./routes";
import { authMiddleware } from "./middleware/auth";
import cookieParser from "cookie-parser";

dotenv.config();

const app = express();

// Middleware
app.use(express.json());

// Use cookie-parser middleware
app.use(cookieParser());

// CORS configuration
app.use(cors());

// Use the routes
app.use("/api", routes);

// Middleware to check if the user is authenticated
app.get("/", authMiddleware, (req, res) => {
  res.status(200).json({ message: "API is running" });
});

// Start server on local port only (Nginx will proxy to this)
const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3001;
app.listen(port, "localhost", () => {
  console.log(`Server running on port ${port}`);
});
