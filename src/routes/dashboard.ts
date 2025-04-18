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

// Replace the existing endpoint implementation
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
      }
    });

    // Get the top objections text examples
    const topObjections = await prisma.objection.findMany({
      where: whereClause,
      select: {
        text: true,
        type: true
      },
      distinct: ['text'],
      take: 5
    });

    // Format the response to match the expected structure in the frontend
    const typeCounts: Record<string, number> = {
      PRICE: 0,
      TIMING: 0,
      TRUST_RISK: 0,
      COMPETITION: 0,
      STAKEHOLDERS: 0,
      OTHERS: 0
    };

    // Fill in the counts from DB
    objectionCounts.forEach(item => {
      typeCounts[item.type] = item._count.id;
    });

    // Format top objections
    const formattedTopObjections = topObjections.map(obj => ({
      text: obj.text,
      count: 1, // We just want examples, not exact counts
      type: obj.type
    }));

    // Return the correct format expected by the frontend
    res.status(200).json({
      types: typeCounts,
      topObjections: formattedTopObjections
    });
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

// Updated objection categories trends endpoint
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

    // Default to last 3 months if no date range specified
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
    
    const startDateTime = startDate ? new Date(startDate) : threeMonthsAgo;
    const endDateTime = endDate ? new Date(endDate) : new Date();
    
    // Ensure end date includes the entire day
    if (endDate) {
      endDateTime.setHours(23, 59, 59, 999);
    }

    // Debug log the date range
    console.log(`Fetching objections from ${startDateTime.toISOString()} to ${endDateTime.toISOString()}`);

    // Build the org filter based on user role
    let orgFilter = {};
    
    if (canAccessAllOrgData(userRole as Role)) {
      // For admin/manager/coach - get data for all call assets in the org
      orgFilter = {
        organizationId: orgId
      };
    } else {
      // For sales rep - only get data for their own call assets in the org
      orgFilter = {
        userId,
        organizationId: orgId
      };
    }

    // First, get all analyses within the date range from this organization
    const callAssets = await prisma.callAsset.findMany({
      where: orgFilter,
      include: {
        analysis: {
          where: {
            date: {
              gte: startDateTime,
              lte: endDateTime
            }
          },
          include: {
            objections: true
          }
        }
      }
    });
    
    // Extract all analyses that have objections
    const analyses = callAssets
      .filter(asset => asset.analysis)
      .map(asset => asset.analysis);
    
    console.log(`Found ${analyses.length} analyses with objections`);
    
    if (analyses.length === 0) {
      res.json([]);
    }

    // Map objection types to chart categories
    const typeMapping: Record<string, string> = {
      PRICE: 'price',
      TIMING: 'timing',
      TRUST_RISK: 'trust',
      COMPETITION: 'competition',
      STAKEHOLDERS: 'stakeholders',
      TECHNICAL: 'other',
      IMPLEMENTATION: 'other',
      VALUE: 'other',
      OTHERS: 'other'
    };
    
    // Group objections by date
    const objectionsByDate: Record<string, Record<string, number>> = {};
    
    // Initialize daily counts for all dates in the range
    const dateRange: Date[] = [];
    const currentDate = new Date(startDateTime);
    while (currentDate <= endDateTime) {
      const dateString = currentDate.toISOString().split('T')[0];
      objectionsByDate[dateString] = {
        price: 0,
        timing: 0,
        trust: 0,
        competition: 0,
        stakeholders: 0,
        other: 0
      };
      dateRange.push(new Date(currentDate));
      currentDate.setDate(currentDate.getDate() + 1);
    }
    
    // Count objections by date and type
    analyses.forEach(analysis => {
      if (!analysis) return;
      
      const dateString = new Date(analysis.date).toISOString().split('T')[0];
      
      if (!objectionsByDate[dateString]) {
        // This shouldn't happen given our date initialization, but just in case
        objectionsByDate[dateString] = {
          price: 0,
          timing: 0,
          trust: 0,
          competition: 0,
          stakeholders: 0,
          other: 0
        };
      }
      
      // Count objections by type for this date
      if (analysis.objections && analysis.objections.length > 0) {
        analysis.objections.forEach(objection => {
          const category = typeMapping[objection.type] || 'other';
          objectionsByDate[dateString][category]++;
        });
      }
    });
    
    // Convert to array format expected by frontend
    const result = Object.entries(objectionsByDate).map(([date, counts]) => ({
      date,
      ...counts
    }));
    
    // Sort by date
    result.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    
    // Consolidate dates to avoid too many data points
    let finalResult = result;
    if (result.length > 30) {
      // Group by week or month depending on the date range
      const dateRangeInDays = Math.ceil((endDateTime.getTime() - startDateTime.getTime()) / (1000 * 60 * 60 * 24));
      
      if (dateRangeInDays > 90) { // If more than 3 months, group by month
        finalResult = groupDataByMonth(result);
      } else if (dateRangeInDays > 30) { // If more than a month, group by week
        finalResult = groupDataByWeek(result);
      }
    }
    
    console.log(`Returning ${finalResult.length} data points for objection trend`);
    
    // Return the result
    res.json(finalResult);
  } catch (error) {
    console.error('Error fetching objection categories trend:', error);
    res.status(500).json({ error: 'Failed to fetch objection categories trend' });
  }
});

// Helper function to group data by week
function groupDataByWeek(data: any[]): any[] {
  const weekMap: Record<string, any> = {};
  
  data.forEach(dayData => {
    const date = new Date(dayData.date);
    // Get the week start date (Sunday)
    const weekStart = new Date(date);
    weekStart.setDate(date.getDate() - date.getDay());
    const weekKey = weekStart.toISOString().split('T')[0];
    
    if (!weekMap[weekKey]) {
      weekMap[weekKey] = {
        date: weekKey,
        price: 0,
        timing: 0,
        trust: 0,
        competition: 0,
        stakeholders: 0,
        other: 0
      };
    }
    
    weekMap[weekKey].price += dayData.price;
    weekMap[weekKey].timing += dayData.timing;
    weekMap[weekKey].trust += dayData.trust;
    weekMap[weekKey].competition += dayData.competition;
    weekMap[weekKey].stakeholders += dayData.stakeholders;
    weekMap[weekKey].other += dayData.other;
  });
  
  return Object.values(weekMap).sort((a: any, b: any) => 
    new Date(a.date).getTime() - new Date(b.date).getTime()
  );
}

// Helper function to group data by month
function groupDataByMonth(data: any[]): any[] {
  const monthMap: Record<string, any> = {};
  
  data.forEach(dayData => {
    const date = new Date(dayData.date);
    const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-01`;
    
    if (!monthMap[monthKey]) {
      monthMap[monthKey] = {
        date: monthKey,
        price: 0,
        timing: 0,
        trust: 0,
        competition: 0,
        stakeholders: 0,
        other: 0
      };
    }
    
    monthMap[monthKey].price += dayData.price;
    monthMap[monthKey].timing += dayData.timing;
    monthMap[monthKey].trust += dayData.trust;
    monthMap[monthKey].competition += dayData.competition;
    monthMap[monthKey].stakeholders += dayData.stakeholders;
    monthMap[monthKey].other += dayData.other;
  });
  
  return Object.values(monthMap).sort((a: any, b: any) => 
    new Date(a.date).getTime() - new Date(b.date).getTime()
  );
}

export default dashboardRouter;