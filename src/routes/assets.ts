import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { getTextFromPdf, analyzeCallTranscript } from '../utils/analyser';

// Initialize Prisma with extended timeout settings
const prisma = new PrismaClient({
  datasources: {
    db: {
      // If using connection URLs, you can add connection_limit and pool_timeout params
      url: process.env.DATABASE_URL, 
    },
  },
  // Add longer timeout for transactions
  log: ['query', 'info', 'warn', 'error'],
});

const assetsRouter = Router();

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
        const userId = req.user.id;
        const { content, type, organizationId } = req.body;

        // Step 1: Create the asset
        const asset = await prisma.callAsset.create({
            data: { 
                content,
                type,
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
                
                // Step 5: Create objections in batches
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
                
                // Step 6: Update the asset status
                await prisma.callAsset.update({
                    where: { id: asset.id },
                    data: { status: "SUCCESS" }
                });
                
                // Step 7: Fetch the complete analysis with relations
                return prisma.analysis.findUnique({
                    where: { id: analysisRecord.id },
                    include: {
                        sentimentEntries: true,
                        objections: true
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

// get assets of a user
assetsRouter.get('/', async (req: Request, res: Response): Promise<void> => {
    // @ts-ignore
    const userId = req.user.id;

    const assets = await prisma.callAsset.findMany({
        where: { userId },
        include: {
            analysis: {
                include: {
                    sentimentEntries: true,
                    objections: true
                }
            }
        }
    });

    res.status(200).json({ assets });
});

export default assetsRouter;