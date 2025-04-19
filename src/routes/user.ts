import { Router, Request, Response } from "express";
import { prisma } from "../utils/prisma";
import { z } from 'zod';

const userRouter = Router();

userRouter.get("/", async (req: Request, res: Response): Promise<void> => {
  // @ts-ignore
  const user = req.user;

  res.json(user);
});

// Update current user
userRouter.put("/", async (req: Request, res: Response): Promise<void> => {
  // @ts-ignore
  const user = req.user;

  if (!user || !user.id) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }

  const { firstName, lastName } = req.body;

  try {
    const updatedUser = await prisma.user.update({
      where: { id: user.id },
      data: {
        firstName,
        lastName,
      },
    });

    res.json(updatedUser);
  } catch (error) {
    console.error("Error updating user:", error);
    res.status(500).json({ message: "Failed to update user" });
  }
});

// Validation schema for query parameters
const userDetailSchema = z.object({
  userId: z.string().uuid().nonempty({ message: 'User ID is required' }),
  orgId: z.string().uuid().nonempty({ message: 'Organization ID is required' })
});

// Helper function to validate query parameters
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

// Add this endpoint to userRouter
userRouter.get('/detail', async (req: Request, res: Response): Promise<void> => {
  try {
    // @ts-ignore
    const currentUser = req.user;
    
    if (!currentUser || !currentUser.id) {
      res.status(401).json({ error: 'User authentication required' });
      return;
    }
    
    // Validate userId and orgId parameters
    const validation = validateQuery(userDetailSchema, req);
    if (!validation.success) {
      res.status(400).json({ error: validation.error });
      return;
    }
    
    const { userId, orgId } = validation.data!;
    
    // Check if the current user has access to this organization
    const userOrg = await prisma.userOrganization.findUnique({
      where: {
        userId_organizationId: {
          userId: currentUser.id,
          organizationId: orgId
        }
      },
      select: {
        role: true
      }
    });
    
    if (!userOrg) {
      res.status(403).json({ error: 'You do not have access to this organization' });
      return;
    }
    
    // Check if the user can access other user's data (admin, manager, coach)
    const canAccessOtherUsers = ['ADMIN', 'MANAGER', 'COACH'].includes(userOrg.role);
    
    // If user is trying to access someone else's data without proper permissions
    if (userId !== currentUser.id && !canAccessOtherUsers) {
      res.status(403).json({ error: 'You do not have permission to view this user\'s details' });
      return;
    }
    
    // Get user details with organization info
    const user = await prisma.user.findUnique({
      where: {
        id: userId
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        createdAt: true,
        organizations: {
          where: {
            organizationId: orgId
          },
          select: {
            role: true,
            organization: {
              select: {
                id: true,
                name: true
              }
            },
            teamAccess: {
              select: {
                team: {
                  select: {
                    id: true,
                    name: true
                  }
                }
              }
            }
          }
        }
      }
    });
    
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    
    // Get analytics for the user from CallAsset and Analysis tables
    const callAssets = await prisma.callAsset.findMany({
      where: {
        userId: userId,
        organizationId: orgId
      },
      select: {
        id: true,
        name: true,
        createdAt: true,
        analysis: {
          select: {
            id: true,
            title: true,
            date: true,
            duration: true,
            overallSentiment: true,
            salesRepTalkRatio: true,
            objections: {
              select: {
                id: true,
                text: true,
                type: true,
                success: true
              }
            }
          }
        }
      }
    });
    
    // Calculate performance metrics
    const totalCalls = callAssets.length;
    const callsWithAnalysis = callAssets.filter(call => call.analysis).length;
    
    // Get objection data
    const objections = callAssets.flatMap(asset => 
      asset.analysis?.objections || []
    );
    
    const totalObjections = objections.length;
    const successfulObjections = objections.filter(obj => obj.success).length;
    const closingRate = totalObjections > 0 ? (successfulObjections / totalObjections) * 100 : 0;
    
    // Get sentiment data over time
    const performanceData = callAssets
      .filter(asset => asset.analysis)
      .map(asset => {
        const analysis = asset.analysis!;
        const date = new Date(analysis.date).toISOString().split('T')[0].substring(0, 7); // Format: YYYY-MM
        
        // Count objections for this call
        const callObjections = analysis.objections?.length || 0;
        
        return {
          date,
          calls: 1,
          objections: callObjections,
          closingRate: analysis.objections?.filter(obj => obj.success).length || 0
        };
      });
    
    // Group performance data by month
    const performanceByMonth: any = {};
    performanceData.forEach(data => {
      if (!performanceByMonth[data.date]) {
        performanceByMonth[data.date] = {
          date: data.date,
          calls: 0,
          objections: 0,
          closingRate: 0
        };
      }
      
      performanceByMonth[data.date].calls += data.calls;
      performanceByMonth[data.date].objections += data.objections;
      performanceByMonth[data.date].closingRate += data.closingRate;
    });
    
    // Calculate monthly closing rate percentages
    Object.keys(performanceByMonth).forEach(month => {
      const monthData = performanceByMonth[month];
      monthData.closingRate = monthData.objections > 0 
        ? (monthData.closingRate / monthData.objections) * 100 
        : 0;
    });
    
    // Get recent transcripts
    const transcripts = callAssets
      .filter(asset => asset.analysis)
      .map(asset => ({
        id: asset.id,
        title: asset.analysis?.title || asset.name || 'Untitled Call',
        date: asset.analysis?.date ? new Date(asset.analysis.date).toISOString().split('T')[0] : 
              new Date(asset.createdAt).toISOString().split('T')[0],
        length: asset.analysis?.duration || '00:00:00',
        objections: asset.analysis?.objections?.length || 0
      }))
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    
    // Format the response to match front-end expectations
    const response = {
      id: user.id,
      name: `${user.firstName || ''} ${user.lastName || ''}`.trim(),
      email: user.email,
      role: user.organizations[0]?.role || 'SALES_REP',
      avatarUrl: '/placeholder.svg', // Placeholder since we don't have avatars in the schema
      bio: null, // Not stored in the database
      joinDate: user.createdAt,
      metrics: {
        calls: totalCalls,
        objections: totalObjections,
        closingRate: parseFloat(closingRate.toFixed(1)),
        transcripts: callsWithAnalysis
      },
      performanceData: Object.values(performanceByMonth).sort((a: any, b: any) => 
        a.date.localeCompare(b.date)
      ),
      transcripts: transcripts
    };
    
    res.json(response);
  } catch (error) {
    console.error('Error fetching user details:', error);
    res.status(500).json({ error: 'Failed to fetch user details' });
  }
});

export default userRouter;
