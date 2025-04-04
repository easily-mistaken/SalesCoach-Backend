import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { getTextFromPdf, analyzeCallTranscript } from '../utils/analyser';

const prisma = new PrismaClient();

const assetsRouter = Router();

// upload asset
assetsRouter.post('/', async (req: Request, res: Response): Promise<void> => {
    try {
        const { content, type, status, transcript, userId } = req.body;

        const asset = await prisma.callAsset.create({
            data: { 
                content,
                type,
                status,
                transcript,
                userId,
            },
        });

        // analysis of the asset
        let text;
        if (type == "FILE") {
            text = await getTextFromPdf(content);
        } else if (type == "TEXT"){
            text = content
        } else {
            throw new Error("Invalid asset type");
        }

        const { data, tokenUsage } = await analyzeCallTranscript(text);
        console.log("Token usage: ", tokenUsage)
        // save data to the database

         // Parse the date string to a proper DateTime format
         const analysisDate = new Date(data.date);
        
         // Create the analysis record and related data using Prisma transactions
         const analysisResult = await prisma.$transaction(async (prisma) => {
             // Create the main analysis record
             const analysis = await prisma.analysis.create({
                 data: {
                     id: data.id,
                     title: data.title,
                     date: analysisDate,
                     duration: data.duration,
                     participants: data.participants,
                     summary: data.summary,
                     overallSentiment: data.sentiment.overall,
                     keyInsights: data.keyInsights,
                     recommendations: data.recommendations,
                     callAssetId: asset.id,
                     
                     // Create sentiment entries using nested write
                     sentimentEntries: {
                         create: data.sentiment.timeline.map(point => ({
                             time: point.time,
                             score: point.score
                         }))
                     },
                     
                     // Create objections using nested write
                     objections: {
                         create: data.objections.map(obj => ({
                             text: obj.text,
                             time: obj.time,
                             response: obj.response,
                             effectiveness: obj.effectiveness,
                             // Default values for fields not in the LLM output but required by schema
                             type: obj.type,
                             success: obj.effectiveness > 0.6 // Consider successful if effectiveness > 0.6
                         }))
                     }
                 },
                 // Include the created relations in the returned data
                 include: {
                     sentimentEntries: true,
                     objections: true
                 }
             });
             
             // Update the call asset status to SUCCESS
             await prisma.callAsset.update({
                 where: { id: asset.id },
                 data: { status: "SUCCESS" }
             });
             
             return analysis;
         });
         
         // Return success response with the created asset and analysis
         res.status(201).json({ 
             message: 'Asset created and analyzed successfully', 
             asset,
             analysis: analysisResult
         });

 } catch (error) {
    console.log("Error processing asset:", error);
        
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
    const { userId } = req.body;

    const assets = await prisma.callAsset.findMany({
        where: { userId },
    });

    res.status(200).json({ assets });
});


export default assetsRouter;
