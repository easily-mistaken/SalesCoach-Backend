import express from "express";
import cors from "cors";

const app = express();

// Enable CORS
app.use(cors());

// app.get("/", (req, res) => {
//   res.send("Hello World!");
// });

// Start server
const port = process.env.PORT || 3001;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
