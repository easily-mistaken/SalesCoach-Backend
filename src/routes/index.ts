import { Request, RequestHandler, Response, Router } from "express";
import organisationRouter from "./organisation";
import { authMiddleware } from "../middleware/auth";
import userRouter from "./user";
import teamRouter from "./team";
import inviteRouter from "./invite";
import assetsRouter from "./assets";
import dashboardRouter from "./dashboard";
import { Resend } from "resend";
import objectionsRouter from "./objections";

const router = Router();

router.use("/organisation", authMiddleware, organisationRouter);
router.use("/user", authMiddleware, userRouter);
router.use("/team", authMiddleware, teamRouter);
router.use("/invite", authMiddleware, inviteRouter);
router.use("/callasset", authMiddleware, assetsRouter);
router.use("/dashboard", authMiddleware, dashboardRouter);
router.use("/objections", authMiddleware, objectionsRouter)
router.post(
  "/test-email",
  async (req: Request, res: Response): Promise<void> => {
    console.log("Received request to test email");
    try {
      const resendClient = new Resend(process.env.RESEND_API_KEY);
      const { data, error } = await resendClient.emails.send({
        from: "SalesCoach <noreply@prajjwal.site>", 
        to: ["choubeyprajjwal@gmail.com"], 
        subject: "Test Email from SalesCoach",
        html: "<strong>This is a test email from SalesCoach!</strong>",
      });

      if (error) {
        console.error("Email sending failed:", error);
        res.status(400).json({ error });
        return;
      }

      res.status(200).json({ data });
      return;
    } catch (err) {
      console.error("Exception during email test:", err);
      res.status(500).json({ error: "Failed to send test email" });
      return;
    }
  }
);

export default router;
