import { Router, Request, Response } from 'express';
import { PrismaClient, Role } from '@prisma/client';
import { z } from 'zod'; // Add zod for validation

const prisma = new PrismaClient();
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

// common objections - placeholder
dashboardRouter.get('/commonObjections', async (req: Request, res: Response) => {
  // Placeholder for future implementation
  res.status(501).json({ message: "This endpoint is not yet implemented" });
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

export default dashboardRouter;