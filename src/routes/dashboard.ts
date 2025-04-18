import { Router, Request, Response } from 'express';
import { Role } from '@prisma/client';
import { z } from 'zod'; // Add zod for validation
import {prisma } from "../utils/prisma";

const dashboardRouter = Router();

// Validation schemas
const orgIdSchema = z.object({
  orgId: z.string().uuid().nonempty({ message: 'Organization ID is required' })
});

const paginationSchema = z.object({
  page: z.coerce.number().positive().default(1),
  limit: z.coerce.number().positive().max(100).default(10)
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
      const errorMessages = error.errors.map(err => `${err.path}: ${err.message}`).join(', ');
      return { success: false, error: errorMessages };
    }
    return { success: false, error: 'Invalid input parameters' };
  }
}

// Helper function to check if user has access to organization data
async function getUserOrgRole(userId: string, orgId: string) {
  const userOrg = await prisma.userOrganization.findUnique({
    where: {
      userId_organizationId: {
        userId,
        organizationId: orgId
      }
    }
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

// total transcripts count
dashboardRouter.get('/transcriptsCount', async (req: Request, res: Response) => {
  try {
    // @ts-ignore
    const userId = req.user?.id;
    
    if (!userId) {
      res.status(401).json({ error: 'User authentication required' });
    }
    
    // Validate orgId
    const validation = validateQuery(orgIdSchema, req);
    if (!validation.success) {
      res.status(400).json({ error: validation.error });
    }
    
    const { orgId } = validation.data!;
    
    const userRole = await getUserOrgRole(userId, orgId);
    
    if (!userRole) {
      res.status(403).json({ error: 'User does not belong to this organization' });
    }

    let count;
    if (canAccessAllOrgData(userRole as Role)) {
      // For admin/manager/coach - count all call assets in the org
      count = await prisma.callAsset.count({
        where: {
          organizationId: orgId
        }
      });
    } else {
      // For sales rep - only count their own call assets in the org
      count = await prisma.callAsset.count({
        where: {
          userId,
          organizationId: orgId
        }
      });
    }

    res.json({ count });
  } catch (error) {
    console.error('Error getting transcripts count:', error);
    res.status(500).json({ error: 'Failed to get transcripts count' });
  }
});

// average sentiment percentage
dashboardRouter.get('/averageSentiment', async (req: Request, res: Response): Promise<void> => {
  try {
    // @ts-ignore
    const userId = req.user?.id;
    
    if (!userId) {
      res.status(401).json({ error: 'User authentication required' });
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
      res.status(403).json({ error: 'User does not belong to this organization' });
      return;
    }

    let whereClause = {};
    if (canAccessAllOrgData(userRole as Role)) {
      // For admin/manager/coach - get sentiment for all call assets in the org
      whereClause = {
        callAsset: {
          organizationId: orgId
        }
      };
    } else {
      // For sales rep - only get sentiment for their own call assets in the org
      whereClause = {
        callAsset: {
          userId,
          organizationId: orgId
        }
      };
    }

    const analyses = await prisma.analysis.findMany({
      where: whereClause,
      select: {
        overallSentiment: true
      }
    });

    if (analyses.length === 0) {
      res.json({ averageSentiment: 0 });
      return;
    }

    const sum = analyses.reduce((acc, analysis) => acc + analysis.overallSentiment, 0);
    const average = sum / analyses.length;
    
    // Convert to percentage (assuming sentiment is on a scale of -1 to 1)
    const percentage = ((average + 1) / 2) * 100;
    
    res.json({ averageSentiment: percentage.toFixed(2) });
  } catch (error) {
    console.error('Error getting average sentiment:', error);
    res.status(500).json({ error: 'Failed to get average sentiment' });
  }
});

// objections handled count
dashboardRouter.get('/objectionsHandled', async (req: Request, res: Response): Promise<void> => {
  try {
    // @ts-ignore
    const userId = req.user?.id;
    
    if (!userId) {
      res.status(401).json({ error: 'User authentication required' });
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
      res.status(403).json({ error: 'User does not belong to this organization' });
      return;
    }

    let whereClause = {};
    if (canAccessAllOrgData(userRole as Role)) {
      // For admin/manager/coach - count objections from all call assets in the org
      whereClause = {
        analysis: {
          callAsset: {
            organizationId: orgId
          }
        }
      };
    } else {
      // For sales rep - only count objections from their own call assets in the org
      whereClause = {
        analysis: {
          callAsset: {
            userId,
            organizationId: orgId
          }
        }
      };
    }

    const totalObjections = await prisma.objection.count({
      where: whereClause
    });

    const successfulObjections = await prisma.objection.count({
      where: {
        ...whereClause,
        success: true
      }
    });

    res.json({ 
      total: totalObjections,
      successful: successfulObjections,
      rate: totalObjections > 0 ? (successfulObjections / totalObjections) * 100 : 0
    });
  } catch (error) {
    console.error('Error getting objections handled:', error);
    res.status(500).json({ error: 'Failed to get objections handled' });
  }
});

// talk ratio in percentage
dashboardRouter.get('/talkRatio', async (req: Request, res: Response): Promise<void> => {
  try {
    // @ts-ignore
    const userId = req.user?.id;
    
    if (!userId) {
      res.status(401).json({ error: 'User authentication required' });
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
      res.status(403).json({ error: 'User does not belong to this organization' });
      return;
    }

    // Build the where clause based on user role
    let whereClause = {};
    if (canAccessAllOrgData(userRole as Role)) {
      // For admin/manager/coach - calculate average talk ratio for all calls in the org
      whereClause = {
        callAsset: {
          organizationId: orgId
        }
      };
    } else {
      // For sales rep - only calculate average talk ratio for their own calls in the org
      whereClause = {
        callAsset: {
          userId,
          organizationId: orgId
        }
      };
    }

    // Fetch analyses with salesRepTalkRatio
    const analyses = await prisma.analysis.findMany({
      where: whereClause,
      select: {
        salesRepTalkRatio: true
      }
    });

    // Calculate the average talk ratio
    let avgTalkRatio = 50; // Default to 50%
    
    if (analyses.length > 0) {
      // Sum up all talk ratios and divide by the number of analyses
      const sum = analyses.reduce((acc, analysis) => {
        // Use the salesRepTalkRatio field if it exists, otherwise use 50 as default
        return acc + (analysis.salesRepTalkRatio ?? 50);
      }, 0);
      
      avgTalkRatio = sum / analyses.length;
    }
    
    // Return the result
    res.json({ 
      talkRatio: parseFloat(avgTalkRatio.toFixed(2)),
      callsAnalyzed: analyses.length
    });
  } catch (error) {
    console.error('Error calculating talk ratio:', error);
    res.status(500).json({ error: 'Failed to calculate talk ratio' });
  }
});;

// sentiment trends
dashboardRouter.get('/sentimentTrends', async (req: Request, res: Response): Promise<void> => {
  try {
    // @ts-ignore
    const userId = req.user?.id;
    
    if (!userId) {
      res.status(401).json({ error: 'User authentication required' });
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
      res.status(403).json({ error: 'User does not belong to this organization' });
      return;
    }

    let whereClause = {};
    if (canAccessAllOrgData(userRole as Role)) {
      whereClause = {
        callAsset: {
          organizationId: orgId
        }
      };
    } else {
      whereClause = {
        callAsset: {
          userId,
          organizationId: orgId
        }
      };
    }

    const analyses = await prisma.analysis.findMany({
      where: whereClause,
      orderBy: {
        createdAt: 'desc'
      },
      take: 10,
      include: {
        callAsset: {
          select: {
            name: true
          }
        },
        sentimentEntries: true
      }
    });

    const trends = analyses.map(analysis => {
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
        neutral: neutral.toFixed(2)
      };
    });
    
    res.json(trends);
  } catch (error) {
    console.error('Error getting sentiment trends:', error);
    res.status(500).json({ error: 'Failed to get sentiment trends' });
  }
});

// Replace the existing placeholder endpoint with this implementation
dashboardRouter.get('/commonObjections', async (req: Request, res: Response): Promise<void> => {
  try {
    // @ts-ignore
    const userId = req.user?.id;
    
    if (!userId) {
      res.status(401).json({ error: 'User authentication required' });
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
      res.status(403).json({ error: 'User does not belong to this organization' });
      return;
    }

    // Build the where clause based on user role
    let whereClause = {};
    if (canAccessAllOrgData(userRole as Role)) {
      // For admin/manager/coach - get objections for all call assets in the org
      whereClause = {
        analysis: {
          callAsset: {
            organizationId: orgId
          }
        }
      };
    } else {
      // For sales rep - only get objections for their own call assets in the org
      whereClause = {
        analysis: {
          callAsset: {
            userId,
            organizationId: orgId
          }
        }
      };
    }

    // Get objection counts by type, sorted by count in descending order
    const objectionCounts = await prisma.objection.groupBy({
      by: ['type'],
      where: whereClause,
      _count: {
        id: true
      },
      orderBy: {
        _count: {
          id: 'desc'
        }
      },
      take: 5 // Limit to top 5 objection categories
    });

    // Mapping of DB enum values to display values
    const objectionTypeMappings = {
      'PRICE': {
        type: "Price",
        icon: "DollarSign",
        color: "bg-red-100 text-red-600",
        link: "/objections/price",
        example: "Your product is too expensive compared to competitors."
      },
      'TIMING': {
        type: "Timing",
        icon: "Clock",
        color: "bg-orange-100 text-orange-600",
        link: "/objections/timing",
        example: "We're not ready to make a decision right now."
      },
      'TRUST_RISK': {
        type: "Trust/Risk",
        icon: "ShieldCheck",
        color: "bg-blue-100 text-blue-600",
        link: "/objections/trust",
        example: "We're concerned about the implementation process."
      },
      'COMPETITION': {
        type: "Competition",
        icon: "Briefcase",
        color: "bg-purple-100 text-purple-600",
        link: "/objections/competition",
        example: "We're already using another solution."
      },
      'STAKEHOLDERS': {
        type: "Stakeholders",
        icon: "Users",
        color: "bg-green-100 text-green-600",
        link: "/objections/stakeholders",
        example: "I need to get approval from my team first."
      },
      'TECHNICAL': {
        type: "Technical",
        icon: "Terminal",
        color: "bg-cyan-100 text-cyan-600",
        link: "/objections/technical",
        example: "Your solution may not integrate with our current tech stack."
      },
      'IMPLEMENTATION': {
        type: "Implementation",
        icon: "Settings",
        color: "bg-indigo-100 text-indigo-600", 
        link: "/objections/implementation",
        example: "The implementation process seems too complex."
      },
      'VALUE': {
        type: "Value",
        icon: "TrendingUp",
        color: "bg-emerald-100 text-emerald-600",
        link: "/objections/value",
        example: "We don't see enough value to justify the investment."
      },
      'OTHERS': {
        type: "Other",
        icon: "HelpCircle",
        color: "bg-gray-100 text-gray-600",
        link: "/objections/others",
        example: "We have other concerns not covered by standard categories."
      }
    };

    // Format the response as an array of CategoryObjection objects
    // This matches what the component expects
    const categoryObjections = objectionCounts.map((item, index) => {
      const typeKey = item.type as keyof typeof objectionTypeMappings;
      const mapping = objectionTypeMappings[typeKey];
      
      return {
        id: index + 1,
        type: mapping.type,
        count: item._count.id,
        example: mapping.example,
        icon: mapping.icon,
        color: mapping.color,
        link: mapping.link
      };
    });

    res.status(200).json(categoryObjections);
  } catch (error) {
    console.error('Error fetching common objections:', error);
    res.status(500).json({ error: 'Failed to fetch common objections' });
  }
});

// transcripts - paginated with role-based logic
dashboardRouter.get('/transcripts', async (req: Request, res: Response): Promise<void> => {
  try {
    // @ts-ignore
    const userId = req.user?.id;
    
    if (!userId) {
      res.status(401).json({ error: 'User authentication required' });
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
      res.status(403).json({ error: 'User does not belong to this organization' });
      return;
    }

    let whereClause = {};
    if (canAccessAllOrgData(userRole as Role)) {
      whereClause = {
        organizationId: orgId
      };
    } else {
      whereClause = {
        userId,
        organizationId: orgId
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
              lastName: true
            }
          }
        },
        orderBy: {
          createdAt: 'desc'
        },
        skip,
        take: limit
      }),
      prisma.callAsset.count({
        where: whereClause
      })
    ]);

    res.json({
      data: callAssets,
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Error getting transcripts:', error);
    res.status(500).json({ error: 'Failed to get transcripts' });
  }
});

// NEW ENDPOINT: questions rate
dashboardRouter.get('/questionsRate', async (req: Request, res: Response): Promise<void> => {
  try {
    // @ts-ignore
    const userId = req.user?.id;
    
    if (!userId) {
      res.status(401).json({ error: 'User authentication required' });
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
      res.status(403).json({ error: 'User does not belong to this organization' });
      return;
    }

    let whereClause = {};
    if (canAccessAllOrgData(userRole as Role)) {
      // For admin/manager/coach - get data for all call assets in the org
      whereClause = {
        callAsset: {
          organizationId: orgId
        }
      };
    } else {
      // For sales rep - only get data for their own call assets in the org
      whereClause = {
        callAsset: {
          userId,
          organizationId: orgId
        }
      };
    }

    const analyses = await prisma.analysis.findMany({
      where: whereClause,
      select: {
        questionsRate: true,
        totalQuestions: true,
        duration: true
      }
    });

    if (analyses.length === 0) {
      res.json({ 
        averageQuestionsRate: 0,
        averageQuestionsPerCall: 0,
        totalCalls: 0 
      });
      return;
    }

    // Calculate average questions rate
    const sumQuestionsRate = analyses.reduce((acc, analysis) => acc + (analysis.questionsRate || 0), 0);
    const avgQuestionsRate = sumQuestionsRate / analyses.length;
    
    // Calculate average total questions per call
    const sumTotalQuestions = analyses.reduce((acc, analysis) => acc + (analysis.totalQuestions || 0), 0);
    const avgQuestionsPerCall = sumTotalQuestions / analyses.length;
    
    res.json({
      averageQuestionsRate: parseFloat(avgQuestionsRate.toFixed(2)),
      averageQuestionsPerCall: parseFloat(avgQuestionsPerCall.toFixed(2)),
      totalCalls: analyses.length
    });
  } catch (error) {
    console.error('Error calculating questions rate:', error);
    res.status(500).json({ error: 'Failed to calculate questions rate' });
  }
});


// NEW ENDPOINT: topic coherence
dashboardRouter.get('/topicCoherence', async (req: Request, res: Response): Promise<void> => {
  try {
    // @ts-ignore
    const userId = req.user?.id;
    
    if (!userId) {
      res.status(401).json({ error: 'User authentication required' });
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
      res.status(403).json({ error: 'User does not belong to this organization' });
      return;
    }

    let whereClause = {};
    if (canAccessAllOrgData(userRole as Role)) {
      // For admin/manager/coach - get data for all call assets in the org
      whereClause = {
        callAsset: {
          organizationId: orgId
        }
      };
    } else {
      // For sales rep - only get data for their own call assets in the org
      whereClause = {
        callAsset: {
          userId,
          organizationId: orgId
        }
      };
    }

    // Fetch analyses with topicCoherence
    const analyses = await prisma.analysis.findMany({
      where: whereClause,
      select: {
        topicCoherence: true,
        callAsset: {
          select: {
            name: true
          }
        },
      }
    });

    if (analyses.length === 0) {
      res.json({
        averageCoherence: 0,
        relevantShiftsPercentage: 0,
        totalCalls: 0
      });
      return;
    }

    // Calculate average topic coherence
    const sumCoherence = analyses.reduce((acc, analysis) => acc + (analysis.topicCoherence || 0.5), 0);
    const avgCoherence = sumCoherence / analyses.length;
    
    res.json({
      averageCoherence: parseFloat((avgCoherence * 100).toFixed(2)), // Convert to percentage
    });
  } catch (error) {
    console.error('Error calculating topic coherence:', error);
    res.status(500).json({ error: 'Failed to calculate topic coherence' });
  }
});

/// NEW ENDPOINT: objection categories trends over time
dashboardRouter.get('/objectionCategoriesTrend', async (req: Request, res: Response): Promise<void> => {
  try {
    // @ts-ignore
    const userId = req.user?.id;
    
    if (!userId) {
      res.status(401).json({ error: 'User authentication required' });
      return;
    }
    
    // Validate orgId and optional time range parameters
    const validation = validateQuery(
      z.object({
        orgId: z.string().uuid().nonempty({ message: 'Organization ID is required' }),
        startDate: z.string().optional(), // Format: YYYY-MM-DD
        endDate: z.string().optional(),   // Format: YYYY-MM-DD
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
      res.status(403).json({ error: 'User does not belong to this organization' });
      return;
    }

    // Define the date range for the query
    let dateFilter = {};
    if (startDate && endDate) {
      dateFilter = {
        date: {
          gte: new Date(startDate),
          lte: new Date(endDate),
        }
      };
    } else if (startDate) {
      dateFilter = {
        date: {
          gte: new Date(startDate),
        }
      };
    } else if (endDate) {
      dateFilter = {
        date: {
          lte: new Date(endDate),
        }
      };
    } else {
      // Default to last 3 months if no date range specified
      const threeMonthsAgo = new Date();
      threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
      
      dateFilter = {
        date: {
          gte: threeMonthsAgo,
        }
      };
    }

    // Build the where clause based on user role
    let whereClause = {
      ...dateFilter
    };
    
    if (canAccessAllOrgData(userRole as Role)) {
      // For admin/manager/coach - get data for all call assets in the org
      whereClause = {
        ...whereClause,
        callAsset: {
          organizationId: orgId
        }
      };
    } else {
      // For sales rep - only get data for their own call assets in the org
      whereClause = {
        ...whereClause,
        callAsset: {
          userId,
          organizationId: orgId
        }
      };
    }

    // Step 1: Get all analyses with their dates within the range
    const analyses = await prisma.analysis.findMany({
      where: whereClause,
      select: {
        id: true,
        date: true
      },
      orderBy: {
        date: 'asc'
      }
    });
    
    // If no data found, return empty result
    if (analyses.length === 0) {
      res.json([]);
      return;
    }

    // Step 2: Aggregate objections by type for each date
    // We'll use a more sophisticated approach by using Prisma groupBy to get counts by date and type
    
    // Get all distinct dates from analyses
    const uniqueDates = [...new Set(analyses.map(a => a.date.toISOString().split('T')[0]))];
    
    // Get all objections grouped by analysis ID
    const objectionsByAnalysis = await prisma.objection.groupBy({
      by: ['analysisId', 'type'],
      where: {
        analysisId: {
          in: analyses.map(a => a.id)
        }
      },
      _count: {
        id: true
      }
    });
    
    // Create a mapping of analysis ID to date
    const analysisIdToDate = analyses.reduce((acc, analysis) => {
      acc[analysis.id] = analysis.date.toISOString().split('T')[0];
      return acc;
    }, {} as Record<string, string>);
    
    // Initialize the result structure with all dates and zero counts
    const dateResults: Record<string, Record<string, number>> = {};
    
    // Initialize all dates with zero counts for all objection types
    uniqueDates.forEach(date => {
      dateResults[date] = {
        PRICE: 0,
        TIMING: 0,
        TRUST_RISK: 0,
        COMPETITION: 0,
        STAKEHOLDERS: 0,
        OTHERS: 0
      };
    });
    
    // Fill in the actual counts from the grouped objections
    objectionsByAnalysis.forEach(obj => {
      const date = analysisIdToDate[obj.analysisId];
      if (date && dateResults[date]) {
        dateResults[date][obj.type] += obj._count.id;
      }
    });
    
    // Convert to the expected array format
    const result = Object.entries(dateResults).map(([date, counts]) => ({
      date,
      price: counts.PRICE,
      timing: counts.TIMING,
      trust: counts.TRUST_RISK,
      competition: counts.COMPETITION,
      stakeholders: counts.STAKEHOLDERS,
      other: counts.OTHERS
    }));
    
    // Sort by date
    result.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    // Return the formatted data
    res.json(result);
  } catch (error) {
    console.error('Error fetching objection categories trend:', error);
    res.status(500).json({ error: 'Failed to fetch objection categories trend' });
  }
});

export default dashboardRouter;