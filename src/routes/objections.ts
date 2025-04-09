import { Router, Request, Response } from 'express';
import { ObjectionType, Role } from '@prisma/client';
import { z } from 'zod';
import { prisma } from "../utils/prisma";

const objectionsRouter = Router();

// Validation schemas
const orgIdSchema = z.object({
  orgId: z.string().uuid().nonempty({ message: 'Organization ID is required' })
});

const paginationSchema = z.object({
  page: z.coerce.number().positive().default(1),
  limit: z.coerce.number().positive().max(100).default(10)
});

const searchSchema = z.object({
  search: z.string().optional()
});

const typeFilterSchema = z.object({
  type: z.enum(['all', 'PRICE', 'TIMING', 'TRUST_RISK', 'COMPETITION', 'STAKEHOLDERS', 'OTHERS']).default('all')
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
  return role === Role.ADMIN || role === Role.COACH || role === Role.MANAGER;
}

// Get objection category counts
objectionsRouter.get('/categoryCounts', async (req: Request, res: Response): Promise<void> => {
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

    // Count for each category
    const priceCount = await prisma.objection.count({
      where: {
        ...whereClause,
        type: ObjectionType.PRICE
      }
    });

    const timingCount = await prisma.objection.count({
      where: {
        ...whereClause,
        type: ObjectionType.TIMING
      }
    });

    const trustCount = await prisma.objection.count({
      where: {
        ...whereClause,
        type: ObjectionType.TRUST_RISK
      }
    });

    const competitionCount = await prisma.objection.count({
      where: {
        ...whereClause,
        type: ObjectionType.COMPETITION
      }
    });

    const stakeholdersCount = await prisma.objection.count({
      where: {
        ...whereClause,
        type: ObjectionType.STAKEHOLDERS
      }
    });

    const othersCount = await prisma.objection.count({
      where: {
        ...whereClause,
        type: ObjectionType.OTHERS
      }
    });

    res.json({
      price: priceCount,
      timing: timingCount,
      trust: trustCount,
      competition: competitionCount,
      stakeholders: stakeholdersCount,
      other: othersCount
    });
  } catch (error) {
    console.error('Error getting objection category counts:', error);
    res.status(500).json({ error: 'Failed to get objection category counts' });
  }
});

// Get objections with pagination, search, and type filtering
objectionsRouter.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    // @ts-ignore
    const userId = req.user?.id;
    
    if (!userId) {
      res.status(401).json({ error: 'User authentication required' });
      return;
    }
    
    // Validate parameters
    const orgValidation = validateQuery(orgIdSchema, req);
    const paginationValidation = validateQuery(paginationSchema, req);
    const searchValidation = validateQuery(searchSchema, req);
    const typeValidation = validateQuery(typeFilterSchema, req);
    
    if (!orgValidation.success) {
      res.status(400).json({ error: orgValidation.error });
      return;
    }
    
    if (!paginationValidation.success) {
      res.status(400).json({ error: paginationValidation.error });
      return;
    }

    if (!searchValidation.success) {
      res.status(400).json({ error: searchValidation.error });
      return;
    }

    if (!typeValidation.success) {
      res.status(400).json({ error: typeValidation.error });
      return;
    }
    
    const { orgId } = orgValidation.data!;
    const { page, limit } = paginationValidation.data!;
    const { search } = searchValidation.data!;
    const { type } = typeValidation.data!;
    
    const skip = (page - 1) * limit;
    
    const userRole = await getUserOrgRole(userId, orgId);
    
    if (!userRole) {
      res.status(403).json({ error: 'User does not belong to this organization' });
      return;
    }

    // Build where clause based on user role
    let whereClause: any = {
      analysis: {
        callAsset: {}
      }
    };
    
    if (canAccessAllOrgData(userRole as Role)) {
      whereClause.analysis.callAsset.organizationId = orgId;
    } else {
      whereClause.analysis.callAsset.userId = userId;
      whereClause.analysis.callAsset.organizationId = orgId;
    }

    // Add type filter if not 'all'
    if (type !== 'all') {
      whereClause.type = type;
    }

    // Add search filter if provided
    if (search) {
      whereClause.OR = [
        { text: { contains: search, mode: 'insensitive' } },
        { response: { contains: search, mode: 'insensitive' } }
      ];
    }

    // Get objections with pagination
    const [objections, total] = await Promise.all([
      prisma.objection.findMany({
        where: whereClause,
        orderBy: {
          createdAt: 'desc'
        },
        skip,
        take: limit,
        include: {
          analysis: {
            select: {
              title: true,
              date: true,
              callAsset: {
                select: {
                  name: true
                }
              }
            }
          }
        }
      }),
      prisma.objection.count({
        where: whereClause
      })
    ]);

    // Transform data to match frontend requirements
    const formattedObjections = objections.map(objection => {
      // Map backend ObjectionType to frontend ObjectionCategory
      let categoryType: string = objection.type.toLowerCase();
      if (categoryType === 'trust_risk') categoryType = 'trust';
      if (categoryType === 'others') categoryType = 'other';

      // Get transcript name (either callAsset name or analysis title)
      const transcriptName = objection.analysis.callAsset.name || objection.analysis.title;

      return {
        id: objection.id,
        type: categoryType as 'price' | 'timing' | 'trust' | 'competition' | 'stakeholders' | 'other',
        text: objection.text,
        transcript: transcriptName,
        date: objection.analysis.date.toISOString().split('T')[0],
        response: objection.response,
        effectiveness: objection.effectiveness,
        success: objection.success,
        ...mapCategoryToColorAndIcon(categoryType)
      };
    });

    res.json({
      data: formattedObjections,
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Error getting objections:', error);
    res.status(500).json({ error: 'Failed to get objections' });
  }
});

// Helper function to map categories to their UI details (matching frontend logic)
function mapCategoryToColorAndIcon(category: string): { color: string } {
  switch (category) {
    case 'price':
      return { color: 'bg-red-100 text-red-600' };
    case 'timing':
      return { color: 'bg-orange-100 text-orange-600' };
    case 'trust':
      return { color: 'bg-blue-100 text-blue-600' };
    case 'competition':
      return { color: 'bg-purple-100 text-purple-600' };
    case 'stakeholders':
      return { color: 'bg-green-100 text-green-600' };
    default:
      return { color: 'bg-gray-100 text-gray-600' };
  }
}

// Get a single objection by ID
objectionsRouter.get('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    // @ts-ignore
    const userId = req.user?.id;
    const objectionId = req.params.id;
    
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

    // Get the objection with related data
    const objection = await prisma.objection.findUnique({
      where: {
        id: objectionId
      },
      include: {
        analysis: {
          select: {
            title: true,
            date: true,
            callAsset: {
              select: {
                name: true,
                userId: true,
                organizationId: true
              }
            }
          }
        }
      }
    });

    if (!objection) {
      res.status(404).json({ error: 'Objection not found' });
      return;
    }

    // Verify that the user has access to this objection
    const objOrgId = objection.analysis.callAsset.organizationId;
    const objUserId = objection.analysis.callAsset.userId;

    if (objOrgId !== orgId) {
      res.status(403).json({ error: 'Objection does not belong to specified organization' });
      return;
    }

    if (!canAccessAllOrgData(userRole as Role) && objUserId !== userId) {
      res.status(403).json({ error: 'You do not have permission to access this objection' });
      return;
    }

    // Format the objection data to match frontend expectations
    let categoryType: string = objection.type.toLowerCase();
    if (categoryType === 'trust_risk') categoryType = 'trust';
    if (categoryType === 'others') categoryType = 'other';

    const transcriptName = objection.analysis.callAsset.name || objection.analysis.title;

    const formattedObjection = {
      id: objection.id,
      type: categoryType as 'price' | 'timing' | 'trust' | 'competition' | 'stakeholders' | 'other',
      text: objection.text,
      transcript: transcriptName,
      date: objection.analysis.date.toISOString().split('T')[0],
      response: objection.response,
      effectiveness: objection.effectiveness,
      success: objection.success,
      ...mapCategoryToColorAndIcon(categoryType)
    };

    res.json(formattedObjection);
  } catch (error) {
    console.error('Error getting objection details:', error);
    res.status(500).json({ error: 'Failed to get objection details' });
  }
});

export default objectionsRouter;