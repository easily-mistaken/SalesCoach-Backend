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

// Enable CORS
app.use(cors({ origin: '*' }));

// Use the routes
app.use('/api', routes);

// Middleware to check if the user is authenticated
app.get('/', authMiddleware, (req, res) => {
  res.status(200).json({ message: 'API is running' });
});

// Start server
const port = process.env.PORT || 3001;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
