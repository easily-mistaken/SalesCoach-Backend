import { Router, Request, Response } from 'express';
import { PrismaClient, Role } from '@prisma/client';
const prisma = new PrismaClient();
const dashboardRouter = Router();

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
    if (role == Role.ADMIN || Role.COACH || Role.MANAGER) {
        return true;
    } 
    return false;
}

// total transcripts count - take the orgId, if the user is manager/admin/coach in the org then send the count of all the transcripts in the org if sales rep then send the count of transcript uploaded by him in the org
dashboardRouter.get('/transcriptsCount', async (req: Request, res: Response) => {
  try {
    // @ts-ignore
    const userId = req.user?.id;
    const orgId = req.query.orgId as string;
    
    if (!userId || !orgId) {
      res.status(400).json({ error: 'Missing userId or orgId' });
    }

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

// average sentiment percentage - take the orgId from params, if the user is sales-rep send the average sentiment of the calls uploaded by him in the org in percentage else send average sentiment of all the calls
dashboardRouter.get('/averageSentiment', async (req: Request, res: Response): Promise<void> => {
  try {
    // @ts-ignore
    const userId = req.user?.id;
    const orgId = req.query.orgId as string;
    
    if (!userId || !orgId) {
      res.status(400).json({ error: 'Missing userId or orgId' });
    }

    const userRole = await getUserOrgRole(userId, orgId);
    
    if (!userRole) {
      res.status(403).json({ error: 'User does not belong to this organization' });
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

// objections handled count - same logic role based count and number of objections success
dashboardRouter.get('/objectionsHandled', async (req: Request, res: Response): Promise<void> => {
  try {
    // @ts-ignore
    const userId = req.user?.id;
    const orgId = req.query.orgId as string;
    
    if (!userId || !orgId) {
      res.status(400).json({ error: 'Missing userId or orgId' });
    }

    const userRole = await getUserOrgRole(userId, orgId);
    
    if (!userRole) {
      res.status(403).json({ error: 'User does not belong to this organization' });
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

// talk ratio in percentage - lets do this again as we arent storing the ratio in the db
dashboardRouter.get('/talkRatio', async (req: Request, res: Response): Promise<void> => {
  try {
    // @ts-ignore
    const userId = req.user?.id;
    const orgId = req.query.orgId as string;
    
    if (!userId || !orgId) {
     res.status(400).json({ error: 'Missing userId or orgId' });
    }

    const userRole = await getUserOrgRole(userId, orgId);
    
    if (!userRole) {
     res.status(403).json({ error: 'User does not belong to this organization' });
    }

    // Since we're not storing talk ratio, we'll calculate it based on available data
    // This is a placeholder implementation - you'll need to replace this with your actual logic
    
    // Example: Calculate based on call duration and number of participants
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
      select: {
        participants: true,
        duration: true
      }
    });

    // Placeholder calculation - replace with your actual logic
    // This assumes the first participant is always the sales rep
    let avgTalkRatio = 50; // Default to 50%
    
    if (analyses.length > 0) {
      // Here you would implement your actual talk ratio calculation
      // For now, we're using a placeholder value
      avgTalkRatio = 50;
    }
    
    res.json({ talkRatio: avgTalkRatio });
  } catch (error) {
    console.error('Error calculating talk ratio:', error);
    res.status(500).json({ error: 'Failed to calculate talk ratio' });
  }
});

// sentiment trends - same role based logic and orgid from query applicable and this give the data of the last 10 calls
// the data is a array of length 10 with object looks like {name: "name of the call", positive: "overall positive of the call", negative: "overall negative of the call", neutral: "over neutral of the call"} all in percentage
dashboardRouter.get('/sentimentTrends', async (req: Request, res: Response): Promise<void> => {
  try {
    // @ts-ignore
    const userId = req.user?.id;
    const orgId = req.query.orgId as string;
    
    if (!userId || !orgId) {
        res.status(400).json({ error: 'Missing userId or orgId' });
    }

    const userRole = await getUserOrgRole(userId, orgId);
    
    if (!userRole) {
        res.status(403).json({ error: 'User does not belong to this organization' });
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
      // Assuming sentiment range from -1 to 1
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

// common objections - keep this hanging lets do this again
dashboardRouter.get('/commonObjections', async (req: Request, res: Response) => {
  // Placeholder for future implementation
  res.status(501).json({ message: "This endpoint is not yet implemented" });
});

// transcripts - same role based logic applies, paginated, returns call assets with the analysis 
dashboardRouter.get('/transcripts', async (req: Request, res: Response): Promise<void> => {
  try {
    // @ts-ignore
    const userId = req.user?.id;
    const orgId = req.query.orgId as string;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const skip = (page - 1) * limit;
    
    if (!userId || !orgId) {
        res.status(400).json({ error: 'Missing userId or orgId' });
    }

    const userRole = await getUserOrgRole(userId, orgId);
    
    if (!userRole) {
        res.status(403).json({ error: 'User does not belong to this organization' });
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