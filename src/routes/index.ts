import { Router } from "express";
import organisationRouter from "./organisation";
import { authMiddleware } from "../middleware/auth";
import userRouter from "./user";
import teamRouter from "./team";
import inviteRouter from "./invite";
import assetsRouter from "./assets";
import dashboardRouter from "./dashboard";

const router = Router();

router.use("/organisation", authMiddleware, organisationRouter);
router.use("/user", authMiddleware, userRouter);
router.use("/team", authMiddleware, teamRouter);
router.use("/invite", authMiddleware, inviteRouter);
router.use("/callasset", authMiddleware, assetsRouter);
router.use('/dashboard', authMiddleware, dashboardRouter);

export default router;