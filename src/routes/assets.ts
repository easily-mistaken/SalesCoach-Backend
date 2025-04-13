import { Router, Request, Response } from 'express';
import {  CallAssetType } from '@prisma/client';
import { getTextFromPdf, analyzeCallTranscript } from '../utils/analyser';
import { z } from 'zod';
import {prisma} from '../utils/prisma';

const assetsRouter = Router();

// Input validation schemas
const createAssetSchema = z.object({
  content: z.string().min(1, "Content is required"),
  type: z.enum(["FILE", "TEXT"]),
  organizationId: z.string().uuid().optional(),
  name: z.string().optional()
});

// Helper function to validate request body
function validateBody<T extends z.ZodTypeAny>(
  schema: T,
  req: Request
): { success: boolean; data?: z.infer<T>; error?: string } {
  try {
    const result = schema.parse(req.body);
    return { success: true, data: result };
  } catch (error) {
    if (error instanceof z.ZodError) {
      const errorMessages = error.errors.map(err => `${err.path}: ${err.message}`).join(', ');
      return { success: false, error: errorMessages };
    }
    return { success: false, error: 'Invalid input parameters' };
  }
}

// Helper function to retry a function with exponential backoff
async function retryWithBackoff(fn: any, maxRetries = 3, initialDelay = 1000) {
  let retries = 0;

  while (true) {
    try {
      return await fn();
    } catch (error) {
      retries++;
      if (retries > maxRetries) {
        throw error;
      }

      const delay = initialDelay * Math.pow(2, retries - 1);
      console.log(`Retrying operation after ${delay}ms (attempt ${retries}/${maxRetries})...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

// upload asset
assetsRouter.post('/', async (req: Request, res: Response): Promise<void> => {
    try {
        // @ts-ignore
        const userId = req.user?.id;

        if (!userId) {
            res.status(401).json({ error: 'User authentication required' });
            return;
        }

        // Validate request body
        const validation = validateBody(createAssetSchema, req);
        if (!validation.success) {
            res.status(400).json({ error: validation.error });
            return;
        }

        const { content, type, organizationId, name } = validation.data!;

        // Step 1: Create the asset
        const asset = await prisma.callAsset.create({
            data: { 
                content,
                type: type as CallAssetType,
                name,
                user: {
                    connect: {
                        id: userId
                    }
                },
                // Connect only if organizationId exists
                ...(organizationId && {
                    organization: {
                        connect: {
                            id: organizationId
                        }
                    }
                })
            },
        });

        // Step 2: Extract and analyze the text
        let text;
        try {
            if (type === "FILE") {
                text = await getTextFromPdf(content);
            } else if (type === "TEXT") {
                text = content;
            } else {
                throw new Error("Invalid asset type");
            }

            const { data } = await analyzeCallTranscript(text);

            // Parse the date string to a proper DateTime format
            const analysisDate = new Date(data.date);

            // Step 3: Create the analysis separately (no transaction)
            const analysis = await retryWithBackoff(async () => {
                // Create the main analysis record first
                const analysisRecord = await prisma.analysis.create({
                    data: {
                        title: data.title,
                        date: analysisDate,
                        duration: data.duration,
                        participants: data.participants,
                        summary: data.summary,
                        overallSentiment: data.sentiment.overall,
                        keyInsights: data.keyInsights,
                        recommendations: data.recommendations,
                        callAssetId: asset.id,
                        salesRepTalkRatio: data.talkRatio?.salesRepPercentage || 50,
                        questionsRate: data.questionsAnalysis.questionsPerMinute,
                        totalQuestions: data.questionsAnalysis.totalQuestions,
                        topicCoherence: data.topicCoherence.score
                    },
                });

                console.log("Created analysis record:", analysisRecord.id);

                // Step 4: Create sentiment entries in batches
                const sentimentPromises = data.sentiment.timeline.map(point => 
                    prisma.sentimentEntry.create({
                        data: {
                            time: point.time,
                            score: point.score,
                            analysisId: analysisRecord.id,
                        }
                    })
                );

                await Promise.all(sentimentPromises);
                console.log("Created sentiment entries");

                // Step 5: Create participant talk stats in batches
                if (data.talkRatio?.participantStats && data.talkRatio.participantStats.length > 0) {
                    const talkStatPromises = data.talkRatio.participantStats.map(stat => 
                        prisma.participantTalkStat.create({
                            data: {
                                name: stat.name,
                                role: stat.role,
                                wordCount: stat.wordCount,
                                percentage: stat.percentage,
                                analysisId: analysisRecord.id,
                            }
                        })
                    );

                    await Promise.all(talkStatPromises);
                    console.log("Created participant talk stats");
                }

                // Step 6: Create objections in batches
                const objectionPromises = data.objections.map(obj => 
                    prisma.objection.create({
                        data: {
                            text: obj.text,
                            time: obj.time,
                            response: obj.response,
                            effectiveness: obj.effectiveness,
                            type: obj.type,
                            success: obj.effectiveness > 0.6,
                            analysisId: analysisRecord.id,
                        }
                    })
                );

                await Promise.all(objectionPromises);
                console.log("Created objection entries");

                // Step 7: Update the asset status
                await prisma.callAsset.update({
                    where: { id: asset.id },
                    data: { status: "SUCCESS" }
                });

                // Step 8: Fetch the complete analysis with relations
                return prisma.analysis.findUnique({
                    where: { id: analysisRecord.id },
                    include: {
                        sentimentEntries: true,
                        objections: true,
                        participantTalkStats: true
                    }
                });
            });

            // Return success response with the created asset and analysis
            res.status(201).json({ 
                message: 'Asset created and analyzed successfully', 
                asset,
                analysis
            });

        } catch (analysisError) {
            console.log("Error in analysis:", analysisError);

            // Update asset status to FAIL if analysis failed
            await prisma.callAsset.update({
                where: { id: asset.id },
                data: { status: "FAIL" }
            });

            // Propagate the error to be caught by the outer catch block
            throw analysisError;
        }
    } catch (error) {
        console.log("Error processing asset: ", error);

        if (req.body && req.body.id) {
            try {
                await prisma.callAsset.update({
                    where: { id: req.body.id },
                    data: { status: "FAIL" }
                });
            } catch (updateError) {
                console.error("Failed to update asset status:", updateError);
            }
        }

        // Send error response
        res.status(500).json({ 
            message: 'Failed to process asset',
            error: error instanceof Error ? error.message : 'Unknown error' 
        });
    }
});

// Define query parameters schema for pagination
const getAssetsQuerySchema = z.object({
    limit: z.coerce.number().positive().default(10),
    page: z.coerce.number().positive().default(1),
    organizationId: z.string().uuid().optional()
});

// get assets of a user
assetsRouter.get('/', async (req: Request, res: Response): Promise<void> => {
    try {
        // @ts-ignore
        const userId = req.user?.id;

        if (!userId) {
            res.status(401).json({ error: 'User authentication required' });
            return;
        }

        // Validate query parameters
        const queryValidation = z.object({
            limit: z.coerce.number().positive().default(10),
            page: z.coerce.number().positive().default(1),
            organizationId: z.string().uuid().optional()
        }).safeParse(req.query);

        if (!queryValidation.success) {
            res.status(400).json({ error: 'Invalid query parameters' });
            return;
        }

        const { limit, page, organizationId } = queryValidation.data;
        const skip = (page - 1) * limit;

        // Build the where clause based on parameters
        const whereClause: any = { userId };
        if (organizationId) {
            whereClause.organizationId = organizationId;
        }

        // Get assets with pagination
        const [assets, total] = await Promise.all([
            prisma.callAsset.findMany({
                where: whereClause,
                include: {
                    analysis: {
                        include: {
                            sentimentEntries: true,
                            objections: true,
                            participantTalkStats: true
                        }
                    }
                },
                skip,
                take: limit,
                orderBy: { createdAt: 'desc' }
            }),
            prisma.callAsset.count({ where: whereClause })
        ]);

        res.status(200).json({ 
            assets,
            pagination: {
                total,
                page,
                limit,
                pages: Math.ceil(total / limit)
            }
        });
    } catch (error) {
        console.error("Error fetching assets:", error);
        res.status(500).json({ 
            message: 'Failed to fetch assets',
            error: error instanceof Error ? error.message : 'Unknown error' 
        });
    }
});

// Get a single asset by ID
assetsRouter.get('/:id', async (req: Request, res: Response): Promise<void> => {
    try {
        // @ts-ignore
        const userId = req.user?.id;

        if (!userId) {
            res.status(401).json({ error: 'User authentication required' });
            return;
        }

        const assetId = req.params.id;

        // Validate asset ID
        if (!assetId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(assetId)) {
            res.status(400).json({ error: 'Invalid asset ID format' });
            return;
        }

        // Get the asset with its analysis
        const asset = await prisma.callAsset.findFirst({
            where: { 
                id: assetId,
                userId // Ensure the asset belongs to the requesting user
            },
            include: {
                analysis: {
                    include: {
                        sentimentEntries: true,
                        objections: true,
                        participantTalkStats: true
                    }
                }
            }
        });

        if (!asset) {
            res.status(404).json({ error: 'Asset not found' });
            return;
        }

        res.status(200).json({ asset });
    } catch (error) {
        console.error("Error fetching asset:", error);
        res.status(500).json({ 
            message: 'Failed to fetch asset',
            error: error instanceof Error ? error.message : 'Unknown error' 
        });
    }
});

// Delete an asset by ID
assetsRouter.delete('/:id', async (req: Request, res: Response): Promise<void> => {
    try {
        // @ts-ignore
        const userId = req.user?.id;

        if (!userId) {
            res.status(401).json({ error: 'User authentication required' });
            return;
        }

        const assetId = req.params.id;

        // Validate UUID format
        if (!assetId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(assetId)) {
            res.status(400).json({ error: 'Invalid asset ID format' });
            return;
        }

        // Ensure the asset belongs to the authenticated user
        const asset = await prisma.callAsset.findFirst({
            where: {
                id: assetId,
                userId
            },
            include: {
                analysis: true
            }
        });

        if (!asset) {
            res.status(404).json({ error: 'Asset not found or not authorized to delete' });
            return;
        }

        // Deleting related analysis and its nested data is handled by cascade rules in the Prisma schema
        await prisma.callAsset.delete({
            where: { id: assetId }
        });

        res.status(200).json({ message: 'Asset deleted successfully' });
    } catch (error) {
        console.error('Error deleting asset:', error);
        res.status(500).json({
            message: 'Failed to delete asset',
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});