import { Router, Request, Response } from "express";
import { Role } from "@prisma/client";
import { z } from "zod"; // Add zod for validation
import { prisma } from "../utils/prisma";

const dashboardRouter = Router();

// Validation schemas
const orgIdSchema = z.object({
  orgId: z.string().uuid().nonempty({ message: "Organization ID is required" }),
});

const paginationSchema = z.object({
  page: z.coerce.number().positive().default(1),
  limit: z.coerce.number().positive().max(100).default(10),
});

// Helper function to validate request parameters
function validateQuery<T extends z.ZodTypeAny>(
  schema: T,
  req: Request
): { success: boolean; data?: z.infer<T>; error?: string } {
  try {
    const result = schema.parse(req.query);
    return { success: true, data: result };
  } catch (error) {
    if (error instanceof z.ZodError) {
      const errorMessages = error.errors
        .map((err) => `${err.path}: ${err.message}`)
        .join(", ");
      return { success: false, error: errorMessages };
    }
    return { success: false, error: "Invalid input parameters" };
  }
}

// Helper function to check if user has access to organization data
async function getUserOrgRole(userId: string, orgId: string) {
  const userOrg = await prisma.userOrganization.findUnique({
    where: {
      userId_organizationId: {
        userId,
        organizationId: orgId,
      },
    },
  });
  return userOrg?.role;
}

// Helper function to determine if user can see all data in organization
function canAccessAllOrgData(role: Role): boolean {
  // Fix the logical condition here, using proper OR operator
  if (role === Role.ADMIN || role === Role.COACH || role === Role.MANAGER) {
    return true;
  }
  return false;
}

dashboardRouter.get("/metrics", async (req: Request, res: Response) => {
  try {
    // @ts-ignore
    const userId = req.user?.id;

    if (!userId) {
      res.status(401).json({ error: "User authentication required" });
      return;
    }

    // Validate orgId
    const validation = validateQuery(orgIdSchema, req);
    if (!validation.success) {
      res.status(400).json({ error: validation.error });
      return;
    }

    const { orgId } = validation.data!;
    const dateFilter = req.query.dateFilter as string | undefined;

    const userRole = await getUserOrgRole(userId, orgId);

    if (!userRole) {
      res
        .status(403)
        .json({ error: "User does not belong to this organization" });
      return;
    }

    // Determine access scope based on user role
    let whereClauseCallAsset: any = {};
    let whereClauseAnalysis: any = {};

    if (canAccessAllOrgData(userRole as Role)) {
      // For admin/manager/coach - access all org data
      whereClauseCallAsset = {
        organizationId: orgId,
      };
      whereClauseAnalysis = {
        callAsset: {
          organizationId: orgId,
        },
      };
    } else {
      // For sales rep - only access their own data
      whereClauseCallAsset = {
        userId,
        organizationId: orgId,
      };
      whereClauseAnalysis = {
        callAsset: {
          userId,
          organizationId: orgId,
        },
      };
    }

    // Apply date filter if provided
    if (dateFilter) {
      const dateCondition = getDateCondition(dateFilter);
      if (dateCondition) {
        whereClauseCallAsset.createdAt = dateCondition;
        whereClauseAnalysis.callAsset.createdAt = dateCondition;
      }
    }

    // Get all metrics in parallel for better performance
    const [transcriptCount, analyses, [totalObjections, successfulObjections]] =
      await Promise.all([
        // 1. Transcript count
        prisma.callAsset.count({
          where: whereClauseCallAsset,
        }),

        // 2. Sentiment and talk ratio data
        prisma.analysis.findMany({
          where: whereClauseAnalysis,
          select: {
            overallSentiment: true,
            salesRepTalkRatio: true,
          },
        }),

        // 3. Objection data - return nested array for destructuring
        Promise.all([
          prisma.objection.count({
            where: {
              analysis: whereClauseAnalysis,
            },
          }),
          prisma.objection.count({
            where: {
              analysis: whereClauseAnalysis,
              success: true,
            },
          }),
        ]),
      ]);

    // Calculate average sentiment
    let averageSentiment = 0;
    if (analyses.length > 0) {
      const sum = analyses.reduce(
        (acc, analysis) => acc + analysis.overallSentiment,
        0
      );
      const average = sum / analyses.length;
      // Convert to percentage (assuming sentiment is on a scale of -1 to 1)
      averageSentiment = parseFloat((((average + 1) / 2) * 100).toFixed(2));
    }

    // Calculate talk ratio
    let talkRatio = 50; // Default to 50%
    if (analyses.length > 0) {
      const sum = analyses.reduce(
        (acc, analysis) => acc + (analysis.salesRepTalkRatio ?? 50),
        0
      );
      talkRatio = parseFloat((sum / analyses.length).toFixed(2));
    }

    // Calculate objection success rate
    const objectionSuccessRate =
      totalObjections > 0
        ? parseFloat(
            ((successfulObjections / totalObjections) * 100).toFixed(2)
          )
        : 0;

    // Combine all metrics into a single response
    res.json({
      transcripts: {
        count: transcriptCount,
      },
      sentiment: {
        average: averageSentiment,
      },
      objections: {
        total: totalObjections,
        successful: successfulObjections,
        successRate: objectionSuccessRate,
      },
      talkRatio: {
        average: talkRatio,
        callsAnalyzed: analyses.length,
      },
      dateFilter: dateFilter || "all time",
    });
  } catch (error) {
    console.error("Error fetching dashboard metrics:", error);
    res.status(500).json({ error: "Failed to fetch dashboard metrics" });
  }
});

// Helper function to get date conditions based on filter string
function getDateCondition(dateFilter: string): any {
  const now = new Date();

  switch (dateFilter.toLowerCase()) {
    case "today": {
      const startOfDay = new Date(now);
      startOfDay.setHours(0, 0, 0, 0);
      return {
        gte: startOfDay,
      };
    }

    case "yesterday": {
      const startOfYesterday = new Date(now);
      startOfYesterday.setDate(startOfYesterday.getDate() - 1);
      startOfYesterday.setHours(0, 0, 0, 0);

      const endOfYesterday = new Date(now);
      endOfYesterday.setDate(endOfYesterday.getDate() - 1);
      endOfYesterday.setHours(23, 59, 59, 999);

      return {
        gte: startOfYesterday,
        lte: endOfYesterday,
      };
    }

    case "this week": {
      const startOfWeek = new Date(now);
      startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay()); // Start of week (Sunday)
      startOfWeek.setHours(0, 0, 0, 0);

      return {
        gte: startOfWeek,
      };
    }

    case "last 15 days":
    case "last 15days": {
      const fifteenDaysAgo = new Date(now);
      fifteenDaysAgo.setDate(fifteenDaysAgo.getDate() - 15);
      fifteenDaysAgo.setHours(0, 0, 0, 0);

      return {
        gte: fifteenDaysAgo,
      };
    }

    case "this month": {
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      startOfMonth.setHours(0, 0, 0, 0);

      return {
        gte: startOfMonth,
      };
    }

    case "last 10 days":
    case "last 10days": {
      const tenDaysAgo = new Date(now);
      tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);
      tenDaysAgo.setHours(0, 0, 0, 0);

      return {
        gte: tenDaysAgo,
      };
    }

    default:
      return null; // No date filter if not recognized
  }
}

// sentiment trends
dashboardRouter.get(
  "/sentimentTrends",
  async (req: Request, res: Response): Promise<void> => {
    try {
      // @ts-ignore
      const userId = req.user?.id;

      if (!userId) {
        res.status(401).json({ error: "User authentication required" });
        return;
      }

      // Validate orgId
      const validation = validateQuery(orgIdSchema, req);
      if (!validation.success) {
        res.status(400).json({ error: validation.error });
        return;
      }

      const { orgId } = validation.data!;

      const userRole = await getUserOrgRole(userId, orgId);

      if (!userRole) {
        res
          .status(403)
          .json({ error: "User does not belong to this organization" });
        return;
      }

      let whereClause = {};
      if (canAccessAllOrgData(userRole as Role)) {
        whereClause = {
          callAsset: {
            organizationId: orgId,
          },
        };
      } else {
        whereClause = {
          callAsset: {
            userId,
            organizationId: orgId,
          },
        };
      }

      const analyses = await prisma.analysis.findMany({
        where: whereClause,
        orderBy: {
          createdAt: "desc",
        },
        take: 10,
        include: {
          callAsset: {
            select: {
              name: true,
            },
          },
          sentimentEntries: true,
        },
      });

      const trends = analyses.map((analysis) => {
        // Calculate positive, negative, neutral percentages from overall sentiment
        const overallSentiment = analysis.overallSentiment;

        // Simplified calculation - replace with your actual formula
        const positive = Math.max(0, (overallSentiment + 1) / 2) * 100;
        const negative = Math.max(0, (1 - overallSentiment) / 2) * 100;
        const neutral = 100 - positive - negative;

        return {
          name: analysis.callAsset.name || analysis.title,
          positive: positive.toFixed(2),
          negative: negative.toFixed(2),
          neutral: neutral.toFixed(2),
        };
      });

      res.json(trends);
    } catch (error) {
      console.error("Error getting sentiment trends:", error);
      res.status(500).json({ error: "Failed to get sentiment trends" });
    }
  }
);

// Replace the existing endpoint implementation
dashboardRouter.get(
  "/commonObjections",
  async (req: Request, res: Response): Promise<void> => {
    try {
      // @ts-ignore
      const userId = req.user?.id;

      if (!userId) {
        res.status(401).json({ error: "User authentication required" });
        return;
      }

      // Validate orgId
      const validation = validateQuery(orgIdSchema, req);
      if (!validation.success) {
        res.status(400).json({ error: validation.error });
        return;
      }

      const { orgId } = validation.data!;

      const userRole = await getUserOrgRole(userId, orgId);

      if (!userRole) {
        res
          .status(403)
          .json({ error: "User does not belong to this organization" });
        return;
      }

      // Build the where clause based on user role
      let whereClause = {};
      if (canAccessAllOrgData(userRole as Role)) {
        // For admin/manager/coach - get objections for all call assets in the org
        whereClause = {
          analysis: {
            callAsset: {
              organizationId: orgId,
            },
          },
        };
      } else {
        // For sales rep - only get objections for their own call assets in the org
        whereClause = {
          analysis: {
            callAsset: {
              userId,
              organizationId: orgId,
            },
          },
        };
      }

      // Get objection counts by type, sorted by count in descending order
      const objectionCounts = await prisma.objection.groupBy({
        by: ["type"],
        where: whereClause,
        _count: {
          id: true,
        },
        orderBy: {
          _count: {
            id: "desc",
          },
        },
      });

      // Get the top objections text examples
      const topObjections = await prisma.objection.findMany({
        where: whereClause,
        select: {
          text: true,
          type: true,
        },
        distinct: ["text"],
        take: 5,
      });

      // Format the response to match the expected structure in the frontend
      const typeCounts: Record<string, number> = {
        PRICE: 0,
        TIMING: 0,
        TRUST_RISK: 0,
        COMPETITION: 0,
        STAKEHOLDERS: 0,
        OTHERS: 0,
      };

      // Fill in the counts from DB
      objectionCounts.forEach((item) => {
        typeCounts[item.type] = item._count.id;
      });

      // Format top objections
      const formattedTopObjections = topObjections.map((obj) => ({
        text: obj.text,
        count: 1, // We just want examples, not exact counts
        type: obj.type,
      }));

      // Return the correct format expected by the frontend
      res.status(200).json({
        types: typeCounts,
        topObjections: formattedTopObjections,
      });
    } catch (error) {
      console.error("Error fetching common objections:", error);
      res.status(500).json({ error: "Failed to fetch common objections" });
    }
  }
);

// transcripts - paginated with role-based logic
dashboardRouter.get(
  "/transcripts",
  async (req: Request, res: Response): Promise<void> => {
    try {
      // @ts-ignore
      const userId = req.user?.id;

      if (!userId) {
        res.status(401).json({ error: "User authentication required" });
        return;
      }

      // Validate orgId and pagination parameters
      const orgValidation = validateQuery(orgIdSchema, req);
      if (!orgValidation.success) {
        res.status(400).json({ error: orgValidation.error });
        return;
      }

      const paginationValidation = validateQuery(paginationSchema, req);
      if (!paginationValidation.success) {
        res.status(400).json({ error: paginationValidation.error });
        return;
      }

      const { orgId } = orgValidation.data!;
      const { page, limit } = paginationValidation.data!;
      const skip = (page - 1) * limit;

      const userRole = await getUserOrgRole(userId, orgId);

      if (!userRole) {
        res
          .status(403)
          .json({ error: "User does not belong to this organization" });
        return;
      }

      let whereClause = {};
      if (canAccessAllOrgData(userRole as Role)) {
        whereClause = {
          organizationId: orgId,
        };
      } else {
        whereClause = {
          userId,
          organizationId: orgId,
        };
      }

      const [callAssets, total] = await Promise.all([
        prisma.callAsset.findMany({
          where: whereClause,
          include: {
            analysis: true,
            user: {
              select: {
                firstName: true,
                lastName: true,
              },
            },
          },
          orderBy: {
            createdAt: "desc",
          },
          skip,
          take: limit,
        }),
        prisma.callAsset.count({
          where: whereClause,
        }),
      ]);

      res.json({
        data: callAssets,
        pagination: {
          total,
          page,
          limit,
          pages: Math.ceil(total / limit),
        },
      });
    } catch (error) {
      console.error("Error getting transcripts:", error);
      res.status(500).json({ error: "Failed to get transcripts" });
    }
  }
);

// NEW ENDPOINT: questions rate
dashboardRouter.get(
  "/questionsRate",
  async (req: Request, res: Response): Promise<void> => {
    try {
      // @ts-ignore
      const userId = req.user?.id;

      if (!userId) {
        res.status(401).json({ error: "User authentication required" });
        return;
      }

      // Validate orgId
      const validation = validateQuery(orgIdSchema, req);
      if (!validation.success) {
        res.status(400).json({ error: validation.error });
        return;
      }

      const { orgId } = validation.data!;

      const userRole = await getUserOrgRole(userId, orgId);

      if (!userRole) {
        res
          .status(403)
          .json({ error: "User does not belong to this organization" });
        return;
      }

      let whereClause = {};
      if (canAccessAllOrgData(userRole as Role)) {
        // For admin/manager/coach - get data for all call assets in the org
        whereClause = {
          callAsset: {
            organizationId: orgId,
          },
        };
      } else {
        // For sales rep - only get data for their own call assets in the org
        whereClause = {
          callAsset: {
            userId,
            organizationId: orgId,
          },
        };
      }

      const analyses = await prisma.analysis.findMany({
        where: whereClause,
        select: {
          questionsRate: true,
          totalQuestions: true,
          duration: true,
        },
      });

      if (analyses.length === 0) {
        res.json({
          averageQuestionsRate: 0,
          averageQuestionsPerCall: 0,
          totalCalls: 0,
        });
        return;
      }

      // Calculate average questions rate
      const sumQuestionsRate = analyses.reduce(
        (acc, analysis) => acc + (analysis.questionsRate || 0),
        0
      );
      const avgQuestionsRate = sumQuestionsRate / analyses.length;

      // Calculate average total questions per call
      const sumTotalQuestions = analyses.reduce(
        (acc, analysis) => acc + (analysis.totalQuestions || 0),
        0
      );
      const avgQuestionsPerCall = sumTotalQuestions / analyses.length;

      res.json({
        averageQuestionsRate: parseFloat(avgQuestionsRate.toFixed(2)),
        averageQuestionsPerCall: parseFloat(avgQuestionsPerCall.toFixed(2)),
        totalCalls: analyses.length,
      });
    } catch (error) {
      console.error("Error calculating questions rate:", error);
      res.status(500).json({ error: "Failed to calculate questions rate" });
    }
  }
);

// NEW ENDPOINT: topic coherence
dashboardRouter.get(
  "/topicCoherence",
  async (req: Request, res: Response): Promise<void> => {
    try {
      // @ts-ignore
      const userId = req.user?.id;

      if (!userId) {
        res.status(401).json({ error: "User authentication required" });
        return;
      }

      // Validate orgId
      const validation = validateQuery(orgIdSchema, req);
      if (!validation.success) {
        res.status(400).json({ error: validation.error });
        return;
      }

      const { orgId } = validation.data!;

      const userRole = await getUserOrgRole(userId, orgId);

      if (!userRole) {
        res
          .status(403)
          .json({ error: "User does not belong to this organization" });
        return;
      }

      let whereClause = {};
      if (canAccessAllOrgData(userRole as Role)) {
        // For admin/manager/coach - get data for all call assets in the org
        whereClause = {
          callAsset: {
            organizationId: orgId,
          },
        };
      } else {
        // For sales rep - only get data for their own call assets in the org
        whereClause = {
          callAsset: {
            userId,
            organizationId: orgId,
          },
        };
      }

      // Fetch analyses with topicCoherence
      const analyses = await prisma.analysis.findMany({
        where: whereClause,
        select: {
          topicCoherence: true,
          callAsset: {
            select: {
              name: true,
            },
          },
        },
      });

      if (analyses.length === 0) {
        res.json({
          averageCoherence: 0,
          relevantShiftsPercentage: 0,
          totalCalls: 0,
        });
        return;
      }

      // Calculate average topic coherence
      const sumCoherence = analyses.reduce(
        (acc, analysis) => acc + (analysis.topicCoherence || 0.5),
        0
      );
      const avgCoherence = sumCoherence / analyses.length;

      res.json({
        averageCoherence: parseFloat((avgCoherence * 100).toFixed(2)), // Convert to percentage
      });
    } catch (error) {
      console.error("Error calculating topic coherence:", error);
      res.status(500).json({ error: "Failed to calculate topic coherence" });
    }
  }
);

dashboardRouter.get(
  "/objectionCategoriesTrend",
  async (req: Request, res: Response): Promise<void> => {
    try {
      // @ts-ignore
      const userId = req.user?.id;

      if (!userId) {
        res.status(401).json({ error: "User authentication required" });
        return;
      }

      // Validate orgId
      const validation = validateQuery(
        z.object({
          orgId: z
            .string()
            .uuid()
            .nonempty({ message: "Organization ID is required" }),
          startDate: z.string().optional(),
          endDate: z.string().optional(),
        }),
        req
      );

      if (!validation.success) {
        res.status(400).json({ error: validation.error });
        return;
      }

      const { orgId, startDate, endDate } = validation.data!;

      const userRole = await getUserOrgRole(userId, orgId);

      if (!userRole) {
        res
          .status(403)
          .json({ error: "User does not belong to this organization" });
        return;
      }

      // Build the where clause for objections
      let objectionWhere: any = {};

      if (canAccessAllOrgData(userRole as Role)) {
        objectionWhere = {
          analysis: {
            callAsset: {
              organizationId: orgId,
            },
          },
        };
      } else {
        objectionWhere = {
          analysis: {
            callAsset: {
              userId,
              organizationId: orgId,
            },
          },
        };
      }

      // Add date filtering if provided
      if (startDate || endDate) {
        objectionWhere.analysis.date = {};
        if (startDate) {
          objectionWhere.analysis.date.gte = new Date(startDate);
        }
        if (endDate) {
          objectionWhere.analysis.date.lte = new Date(endDate);
        }
      }

      // Get all objections with their analysis dates
      const objections = await prisma.objection.findMany({
        where: objectionWhere,
        select: {
          type: true,
          analysis: {
            select: {
              date: true,
            },
          },
        },
      });

      // If no objections, return empty array
      if (objections.length === 0) {
        res.json([]);
        return;
      }

      // Map objection types to chart categories
      const typeMapping: Record<string, string> = {
        PRICE: "price",
        TIMING: "timing",
        TRUST_RISK: "trust",
        COMPETITION: "competition",
        STAKEHOLDERS: "stakeholders",
        OTHERS: "other",
        TECHNICAL: "other",
        IMPLEMENTATION: "other",
        VALUE: "price", // Map VALUE to price as they're related
      };

      // Group objections by date
      const objectionsByDate: Record<string, any> = {};

      objections.forEach((objection) => {
        if (!objection.analysis?.date) return;

        const dateString = new Date(objection.analysis.date)
          .toISOString()
          .split("T")[0];

        if (!objectionsByDate[dateString]) {
          objectionsByDate[dateString] = {
            date: dateString,
            price: 0,
            timing: 0,
            trust: 0,
            competition: 0,
            stakeholders: 0,
            other: 0,
          };
        }

        const category = typeMapping[objection.type] || "other";
        objectionsByDate[dateString][category]++;
      });

      // Convert to array
      const result = Object.values(objectionsByDate);

      // Sort by date
      result.sort(
        (a: any, b: any) =>
          new Date(a.date).getTime() - new Date(b.date).getTime()
      );

      res.json(result);
    } catch (error) {
      console.error("Error fetching objection categories trend:", error);
      res
        .status(500)
        .json({ error: "Failed to fetch objection categories trend" });
    }
  }
);
// A simple endpoint just to debug objection data
dashboardRouter.get(
  "/debugObjections",
  async (req: Request, res: Response): Promise<void> => {
    try {
      // @ts-ignore
      const userId = req.user?.id;

      if (!userId) {
        res.status(401).json({ error: "User authentication required" });
        return;
      }

      // Validate orgId
      const validation = validateQuery(
        z.object({
          orgId: z
            .string()
            .uuid()
            .nonempty({ message: "Organization ID is required" }),
        }),
        req
      );

      if (!validation.success) {
        res.status(400).json({ error: validation.error });
        return;
      }

      const { orgId } = validation.data!;

      const userRole = await getUserOrgRole(userId, orgId);

      if (!userRole) {
        res
          .status(403)
          .json({ error: "User does not belong to this organization" });
        return;
      }

      // Get some basic counts
      const counts = {
        totalOrganizationObjections: await prisma.objection.count({
          where: {
            analysis: {
              callAsset: {
                organizationId: orgId,
              },
            },
          },
        }),

        userObjections: await prisma.objection.count({
          where: {
            analysis: {
              callAsset: {
                userId,
                organizationId: orgId,
              },
            },
          },
        }),

        totalAnalyses: await prisma.analysis.count({
          where: {
            callAsset: {
              organizationId: orgId,
            },
          },
        }),

        userAnalyses: await prisma.analysis.count({
          where: {
            callAsset: {
              userId,
              organizationId: orgId,
            },
          },
        }),

        objectionsByType: await prisma.objection.groupBy({
          by: ["type"],
          where: {
            analysis: {
              callAsset: {
                organizationId: orgId,
              },
            },
          },
          _count: true,
        }),

        // Get last 5 objections for inspection
        recentObjections: await prisma.objection.findMany({
          where: {
            analysis: {
              callAsset: {
                organizationId: orgId,
              },
            },
          },
          select: {
            id: true,
            type: true,
            text: true,
            analysis: {
              select: {
                id: true,
                date: true,
                callAsset: {
                  select: {
                    id: true,
                    name: true,
                  },
                },
              },
            },
          },
          orderBy: {
            createdAt: "desc",
          },
          take: 5,
        }),
      };

      // Return the debug information
      res.json(counts);
    } catch (error) {
      console.error("Error debugging objections:", error);
      res.status(500).json({ error: "Failed to debug objections" });
    }
  }
);

export default dashboardRouter;
