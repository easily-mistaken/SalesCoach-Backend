import { ChatOpenAI } from "@langchain/openai";
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import { z } from "zod";
import * as fs from "fs";
import axios from "axios";
import * as path from "path";
import * as os from "os";
// Fix import for pdf-parse
import pdfParse from 'pdf-parse';

// Define enum types to match Prisma schema
const ObjectionTypeEnum = z.enum([
  'PRICE',
  'TIMING',
  'TRUST_RISK',
  'COMPETITION',
  'STAKEHOLDERS',
  'OTHERS'
]);

// Define the Zod schema for structured output
const SentimentPoint = z.object({
  time: z.string().describe("Timestamp in the format MM:SS"),
  score: z.number().min(0).max(1).describe("Sentiment score from 0 to 1, where 1 is most positive")
});

const Objection = z.object({
  id: z.string().describe("Unique identifier for this objection (e.g., obj-1)"),
  text: z.string().describe("The exact text of the objection raised by the prospect"),
  time: z.string().describe("Timestamp when the objection occurred (MM:SS format)"),
  response: z.string().describe("The sales rep's response to this objection"),
  effectiveness: z.number().min(0).max(1).describe("Rating of how effective the response was (0-1)"),
  type: ObjectionTypeEnum.describe("Category of the objection (PRICE, TIMING, etc.)"),
  success: z.boolean().describe("Whether the objection was successfully addressed (true if effectiveness > 0.6)")
});

const TranscriptAnalysis = z.object({
  id: z.string().describe("Unique identifier for this transcript analysis"),
  title: z.string().describe("Descriptive title of the call based on content"),
  date: z.string().describe("Date of the call in ISO format if possible"),
  duration: z.string().describe("Duration of the call in MM:SS format"),
  participants: z.array(z.string()).describe("Names and roles of call participants"),
  summary: z.string().describe("Concise one-paragraph summary of the call"),
  sentiment: z.object({
    overall: z.number().min(0).max(1).describe("Overall sentiment score for the entire call"),
    timeline: z.array(SentimentPoint).describe("Sentiment scores at regular intervals throughout the call")
  }),
  objections: z.array(Objection).describe("List of objections raised and responses given"),
  keyInsights: z.array(z.string()).describe("3-5 key insights about prospect interests, concerns, and decision-making"),
  recommendations: z.array(z.string()).describe("3-5 actionable recommendations for the sales rep")
});

// Type based on Zod schema
type TranscriptData = z.infer<typeof TranscriptAnalysis>;

// Interface for analysis result including token usage
interface AnalysisResult {
  data: TranscriptData;
  tokenUsage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

// Function to download and extract text from a remote PDF
async function loadRemotePDF(pdfUrl: string): Promise<string> {
  try {
    console.log("Downloading PDF from:", pdfUrl);

    // Download the PDF using axios
    const response = await axios.get(pdfUrl, {
      responseType: 'arraybuffer'
    });

    // Use pdf-parse to extract text
    console.log("Parsing PDF document...");
    const data = await pdfParse(Buffer.from(response.data));

    console.log("PDF info:", {
      pages: data.numpages,
      version: data.version
    });

    // Get the raw text
    const fullText = data.text;
    console.log(`Extracted ${fullText.length} characters of text from PDF`);

    // Split text if it exceeds token limits
    const textSplitter = new RecursiveCharacterTextSplitter({
      chunkSize: 32000, // Large chunk size as we want to analyze the entire transcript at once
      chunkOverlap: 200,
    });

    const chunks = await textSplitter.createDocuments([fullText]);
    return chunks.map(chunk => chunk.pageContent).join("\n");
  } catch (error) {
    console.error("Error loading remote transcript:", error);
    throw error;
  }
}

// Alternative approach - download to temp file then parse
async function downloadAndParsePDF(pdfUrl: string): Promise<string> {
  try {
    console.log("Downloading PDF from:", pdfUrl);

    // Create a temporary file path
    const tempFile = path.join(os.tmpdir(), `transcript-${Date.now()}.pdf`);

    // Download the file
    const response = await axios.get(pdfUrl, {
      responseType: 'arraybuffer'
    });

    // Write to temp file
    fs.writeFileSync(tempFile, Buffer.from(response.data));
    console.log("PDF downloaded to:", tempFile);

    // Read the file
    const dataBuffer = fs.readFileSync(tempFile);

    // Parse the PDF
    const data = await pdfParse(dataBuffer);
    console.log(`PDF has ${data.numpages} pages`);

    // Clean up temp file
    fs.unlinkSync(tempFile);

    return data.text;
  } catch (error) {
    console.error("Error in downloadAndParsePDF:", error);
    throw error;
  }
}

async function getTextFromPdf(pdfUrl:string): Promise<string> {
    let transcriptText = await loadRemotePDF(pdfUrl);
    return transcriptText;
}

/**
 * Helper function to determine the objection type based on the text content
 */
function determineObjectionType(text: string): 'PRICE' | 'TIMING' | 'TRUST_RISK' | 'COMPETITION' | 'STAKEHOLDERS' | 'OTHERS' {
  const lowerText = text.toLowerCase();
  
  if (lowerText.includes('price') || lowerText.includes('cost') || lowerText.includes('expensive') || lowerText.includes('budget')) {
      return 'PRICE';
  } else if (lowerText.includes('time') || lowerText.includes('schedule') || lowerText.includes('deadline') || lowerText.includes('when')) {
      return 'TIMING';
  } else if (lowerText.includes('risk') || lowerText.includes('trust') || lowerText.includes('uncertain') || lowerText.includes('proof')) {
      return 'TRUST_RISK';
  } else if (lowerText.includes('competitor') || lowerText.includes('alternative') || lowerText.includes('other vendor')) {
      return 'COMPETITION';
  } else if (lowerText.includes('team') || lowerText.includes('boss') || lowerText.includes('manager') || lowerText.includes('approval')) {
      return 'STAKEHOLDERS';
  } else {
      return 'OTHERS';
  }
}

// Main function to analyze the call transcript
async function analyzeCallTranscript(transcriptText: string): Promise<AnalysisResult> {
  try {
    console.log("Transcript loaded, performing analysis...");
    console.log("Transcript preview:", transcriptText.substring(0, 200) + "...");

    // Initialize the model with structured output capability and token counting
    const model = new ChatOpenAI({
      temperature: 0.2,
      modelName: "gpt-4-turbo",
      verbose: true
    });

    // Create the prompt instruction
    const instructions = `
    You are a professional sales call analyzer. Analyze this transcript of a sales call 
    and provide a comprehensive analysis in the requested structured format.
    
    Follow these guidelines:
    1. Extract basic information like title, date, participants, and duration from the transcript
    2. Create a concise summary of the call in one paragraph
    3. Analyze sentiment throughout the call, providing an overall score and timeline of scores
    4. Identify all objections raised by the prospect and the sales rep's responses
    5. For each objection, categorize it into one of these types: PRICE, TIMING, TRUST_RISK, COMPETITION, STAKEHOLDERS, or OTHERS
    6. For each objection, determine if it was successfully addressed (true if effectiveness > 0.6, false otherwise)
    7. Provide 3-5 key insights about the prospect's interests and concerns
    8. Suggest 3-5 actionable recommendations for the sales rep
    
    For the ID field, generate a unique identifier with format "tr-" followed by 6 random digits.
    
    Here is the transcript to analyze:
    
    ${transcriptText}
    `;

    // Use structured model with the enhanced schema
    const structuredModel = model.withStructuredOutput(TranscriptAnalysis);

    // Invoke the model with structured output
    console.log("Sending to LLM for analysis...");
    const result = await structuredModel.invoke(instructions);

    // Post-process the results to ensure all fields match our schema
    // Set default objection types and success values if the model didn't provide them
    const processedResult = {
      ...result,
      objections: result.objections.map(objection => ({
        ...objection,
        // Use the model's type if provided, otherwise determine from text
        type: objection.type || determineObjectionType(objection.text),
        // Use the model's success value if provided, otherwise calculate from effectiveness
        success: typeof objection.success === 'boolean' ? objection.success : objection.effectiveness > 0.6
      }))
    };

    // Track token usage
    const tokenUsage = {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0
    };

    // Try to extract token usage from ChatOpenAI's internal tracking
    try {
      // @ts-ignore - Accessing private/undocumented property
      const usage = model._lastCallTokenUsage || {};
      tokenUsage.promptTokens = usage.promptTokens || 0;
      tokenUsage.completionTokens = usage.completionTokens || 0;
      tokenUsage.totalTokens = usage.totalTokens || 0;
    } catch (error) {
      console.warn("Unable to extract token usage information:", error);
    }

    // Create complete result object
    const analysisResult: AnalysisResult = {
      data: processedResult,
      tokenUsage
    };

    // Output to console and save to file
    console.log("Analysis complete!");
    console.log("Token usage:", {
      promptTokens: tokenUsage.promptTokens,
      completionTokens: tokenUsage.completionTokens,
      totalTokens: tokenUsage.totalTokens
    });

    // Save both the data and token usage
    const timestamp = Date.now();
    const outputFilename = `transcript_analysis_${timestamp}.json`;
    fs.writeFileSync(outputFilename, JSON.stringify(analysisResult, null, 2));
    console.log(`Analysis saved to ${outputFilename}`);

    return analysisResult;
  } catch (error) {
    console.error("Error in analysis:", error);
    throw error;
  }
}

// Export types and functions
export {
  analyzeCallTranscript,
  TranscriptData,
  AnalysisResult,
  getTextFromPdf,
  downloadAndParsePDF,
  determineObjectionType,
  ObjectionTypeEnum
};