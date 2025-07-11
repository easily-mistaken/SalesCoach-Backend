import { ChatOpenAI } from "@langchain/openai";
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import { z } from "zod";
import * as fs from "fs";
import axios from "axios";
import * as path from "path";
import * as os from "os";
import pdfParse from "pdf-parse";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";

// Enhanced enum types to match expanded objection categories
const ObjectionTypeEnum = z.enum([
  "PRICE",
  "TIMING",
  "TRUST_RISK",
  "COMPETITION",
  "STAKEHOLDERS",
  "TECHNICAL", // New category
  "IMPLEMENTATION", // New category
  "VALUE", // New category
  "OTHERS",
]);

// Define the Zod schema for structured output
const SentimentPoint = z.object({
  time: z.string().describe("Timestamp in the format MM:SS"),
  score: z
    .number()
    .describe("Sentiment score from 0 to 1, where 1 is most positive"),
});

// Enhanced objection schema with more detailed analysis
const Objection = z.object({
  id: z.string().describe("Unique identifier for this objection (e.g., obj-1)"),
  text: z
    .string()
    .describe("The exact text of the objection raised by the prospect"),
  time: z
    .string()
    .describe("Timestamp when the objection occurred (MM:SS format)"),
  response: z.string().describe("The sales rep's response to this objection"),
  responseTime: z
    .string()
    .optional()
    .describe("Timestamp when the response occurred (MM:SS format)"),
  effectiveness: z
    .number()
    .describe("Rating of how effective the response was (0-1)"),
  type: ObjectionTypeEnum.describe(
    "Category of the objection (PRICE, TIMING, etc.)"
  ),
  success: z
    .boolean()
    .describe(
      "Whether the objection was successfully addressed (true if effectiveness > 0.7)"
    ),
  technique: z
    .string()
    .optional()
    .describe("Technique used to address the objection"),
  color: z.string().optional().describe("CSS color class for UI display"),
  transcript: z
    .string()
    .optional()
    .describe("Transcript segment ID for reference"),
});

/**
 * Enhanced talk ratio analysis
 */
const ParticipantTalkStat = z.object({
  id: z.string().describe("Unique identifier for this participant"),
  name: z.string().describe("Name of the participant"),
  role: z
    .string()
    .describe("Role of the participant (e.g., 'Sales Rep', 'Prospect')"),
  wordCount: z.number().describe("Number of words spoken by this participant"),
  percentage: z
    .number()
    .describe("Percentage of total words spoken by this participant"),
});

// New schema for question analysis with categorization
const QuestionAnalysis = z.object({
  totalQuestions: z
    .number()
    .describe("Total number of questions asked in the call"),
  questionsPerMinute: z
    .number()
    .describe("Rate of questions asked per minute of the call"),
  salesRepQuestions: z
    .number()
    .describe("Number of questions asked by the sales rep"),
  categories: z
    .object({
      discovery: z
        .number()
        .describe("Questions aimed at learning about needs/problems"),
      qualifying: z.number().describe("Questions determining fit/potential"),
      closing: z.number().describe("Questions aimed at advancing the sale"),
      clarifying: z
        .number()
        .describe("Questions seeking to clarify information"),
    })
    .describe("Breakdown of question types"),
  effectivenessScore: z
    .number()
    .describe("Overall effectiveness of questioning strategy (0-1)"),
});

// New schema for topic coherence with more detail
const TopicCoherence = z.object({
  score: z
    .number()
    .describe(
      "Score from 0-1 indicating how well the conversation stayed on relevant topics"
    ),
  topicShifts: z
    .array(
      z.object({
        time: z.string().describe("Timestamp of topic shift (MM:SS format)"),
        fromTopic: z.string().describe("Previous topic of conversation"),
        toTopic: z.string().describe("New topic of conversation"),
        relevance: z
          .number()
          .describe("How relevant the new topic was to sales objectives (0-1)"),
      })
    )
    .optional()
    .describe("List of major topic shifts during the call"),
});

// New schema for competitive intelligence
const CompetitiveIntelligence = z.object({
  competitors: z
    .array(
      z.object({
        name: z.string().describe("Name of the competitor mentioned"),
        mentions: z.number().describe("Number of times mentioned"),
        context: z
          .string()
          .describe("Context in which competitor was discussed"),
        perception: z
          .string()
          .describe("Prospect's perception of this competitor"),
      })
    )
    .describe("Competitors mentioned during the call"),
  differentiators: z
    .array(
      z.object({
        feature: z.string().describe("Differentiating feature/capability"),
        reception: z
          .number()
          .describe(
            "How well it resonated (-1 negative, 0 neutral, 1 positive)"
          ),
      })
    )
    .optional()
    .describe("Product differentiators discussed"),
});

// New schema for value proposition analysis
const ValueProposition = z.object({
  articulated: z
    .string()
    .describe("How the salesperson articulated the value proposition"),
  alignment: z
    .number()
    .describe("How well solution matched prospect's stated needs (0-1)"),
  missedOpportunities: z
    .array(z.string())
    .optional()
    .describe("Missed opportunities to highlight benefits"),
  evidenceUsed: z
    .array(z.string())
    .optional()
    .describe("Social proof or evidence presented"),
});

// New schema for next steps and close analysis
const NextSteps = z.object({
  established: z
    .boolean()
    .describe("Whether clear next steps were established"),
  commitments: z
    .array(
      z.object({
        party: z.string().describe("Who made the commitment"),
        action: z.string().describe("What they committed to do"),
        timeline: z.string().describe("When they committed to do it"),
      })
    )
    .optional()
    .describe("Specific commitments made by either party"),
  closeStrength: z
    .number()
    .optional()
    .describe("Strength of the close attempt (0-1)"),
  progressionLikelihood: z
    .number()
    .describe("Likelihood of deal progression based on call (0-1)"),
});

// Category counts for objection summary cards
const CategoryCounts = z.object({
  price: z.number().describe("Count of price-related objections"),
  timing: z.number().describe("Count of timing-related objections"),
  trust: z.number().describe("Count of trust/risk-related objections"),
  competition: z.number().describe("Count of competition-related objections"),
  stakeholders: z.number().describe("Count of stakeholder-related objections"),
  technical: z.number().optional().describe("Count of technical objections"),
  implementation: z
    .number()
    .optional()
    .describe("Count of implementation objections"),
  value: z.number().optional().describe("Count of value objections"),
  other: z.number().describe("Count of other objections"),
});

// Enhanced main analysis schema
const TranscriptAnalysis = z.object({
  id: z.string().describe("Unique identifier for this transcript analysis"),
  title: z.string().describe("Descriptive title of the call based on content"),
  date: z.string().describe("Date of the call in ISO format if possible"),
  duration: z.string().describe("Duration of the call in MM:SS format"),
  participants: z
    .array(z.string())
    .describe("Names and roles of call participants"),
  summary: z.string().describe("Concise one-paragraph summary of the call"),

  // Simplified sentiment analysis
  sentiment: z.object({
    overall: z.number().describe("Overall sentiment score for the entire call"),
    timeline: z
      .array(SentimentPoint)
      .describe("Sentiment scores at regular intervals throughout the call"),
  }),

  // Simplified talk ratio analysis
  talkRatio: z.object({
    salesRepPercentage: z
      .number()
      .describe(
        "Percentage of the conversation where the sales rep was talking"
      ),
    participantStats: z
      .array(ParticipantTalkStat)
      .describe("Detailed statistics about each participant's talking time"),
  }),

  // Simplified questions analysis
  questionsAnalysis: z.object({
    totalQuestions: z
      .number()
      .describe("Total number of questions asked in the call"),
    questionsPerMinute: z
      .number()
      .describe("Rate of questions asked per minute of the call"),
    salesRepQuestions: z
      .number()
      .describe("Number of questions asked by the sales rep"),
    effectivenessScore: z
      .number()
      .describe("Overall effectiveness of questioning strategy (0-1)"),
  }),

  // Simplified topic coherence
  topicCoherence: z.object({
    score: z
      .number()
      .describe(
        "Score from 0-1 indicating how well the conversation stayed on relevant topics"
      ),
  }),

  // Core objections analysis
  objections: z
    .array(Objection)
    .describe("List of objections raised and responses given"),

  // Simplified for dashboard cards
  categoryCounts: CategoryCounts.optional().describe(
    "Summary counts of objections by category for dashboard"
  ),

  // Key insights and recommendations
  keyInsights: z
    .array(z.string())
    .describe(
      "3-5 key insights about prospect interests, concerns, and decision-making"
    ),
  recommendations: z
    .array(z.string())
    .describe("3-5 actionable recommendations for the sales rep"),

  // Simple values for visualization
  sentimentEntries: z
    .array(
      z.object({
        time: z.string(),
        score: z.number(),
      })
    )
    .optional()
    .describe("Formatted sentiment data for chart visualization"),

  overallSentiment: z
    .number()
    .optional()
    .describe("Simplified overall sentiment score"),

  // Required for AnalysisPage component
  participantTalkStats: z
    .array(
      z.object({
        name: z.string(),
        role: z.string(),
        wordCount: z.number(),
        percentage: z.number(),
      })
    )
    .optional()
    .describe("Talk stats formatted for UI components"),
});

// Type based on Zod schema
type TranscriptData = z.infer<typeof TranscriptAnalysis>;

// Interface for analysis result
interface AnalysisResult {
  data: TranscriptData;
}

// Prisma-compatible output format (matching your database schema)
interface PrismaAnalysisOutput {
  id: string;
  title: string;
  date: Date;
  duration: string;
  participants: string[];
  summary: string;
  overallSentiment: number;
  keyInsights: string[];
  recommendations: string[];
  objections: {
    id: string;
    text: string;
    time: string;
    response: string;
    effectiveness: number;
    type: string;
    success: boolean;
    color?: string;
  }[];
  sentimentEntries: {
    time: string;
    score: number;
  }[];
  salesRepTalkRatio: number;
  participantTalkStats: {
    name: string;
    role: string;
    wordCount: number;
    percentage: number;
  }[];
  questionsRate: number;
  totalQuestions: number;
  topicCoherence: number;
}

/**
 * Function to download and extract text from a remote PDF
 */
async function loadRemotePDF(pdfUrl: string): Promise<string> {
  try {
    console.log("Downloading PDF from:", pdfUrl);

    // Download the PDF using axios
    const response = await axios.get(pdfUrl, {
      responseType: "arraybuffer",
    });

    // Use pdf-parse to extract text
    console.log("Parsing PDF document...");
    const data = await pdfParse(Buffer.from(response.data));

    console.log("PDF info:", {
      pages: data.numpages,
      version: data.version,
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
    return chunks.map((chunk) => chunk.pageContent).join("\n");
  } catch (error) {
    console.error("Error loading remote transcript:");
    throw error;
  }
}

/**
 * Alternative approach - download to temp file then parse
 */
async function downloadAndParsePDF(pdfUrl: string): Promise<string> {
  try {
    console.log("Downloading PDF from:", pdfUrl);

    // Create a temporary file path
    const tempFile = path.join(os.tmpdir(), `transcript-${Date.now()}.pdf`);

    // Download the file
    const response = await axios.get(pdfUrl, {
      responseType: "arraybuffer",
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

/**
 * Get text from PDF - tries multiple methods
 */
async function getTextFromPdf(pdfUrl: string): Promise<string> {
  try {
    return await loadRemotePDF(pdfUrl);
  } catch (error) {
    console.warn("Primary PDF loading failed, trying fallback method:", error);
    return await downloadAndParsePDF(pdfUrl);
  }
}

/**
 * Enhanced helper function to determine the objection type based on the text
 */
function determineObjectionType(
  text: string
): z.infer<typeof ObjectionTypeEnum> {
  const lowerText = text.toLowerCase();

  // Price objections
  if (
    lowerText.includes("price") ||
    lowerText.includes("cost") ||
    lowerText.includes("expensive") ||
    lowerText.includes("budget") ||
    lowerText.includes("afford") ||
    lowerText.includes("money") ||
    lowerText.includes("discount") ||
    lowerText.includes("cheaper") ||
    lowerText.includes("roi") ||
    lowerText.includes("return on investment") ||
    lowerText.includes("value for money") ||
    lowerText.includes("spend")
  ) {
    return "PRICE";
  }
  // Timing objections
  else if (
    lowerText.includes("time") ||
    lowerText.includes("schedule") ||
    lowerText.includes("deadline") ||
    lowerText.includes("when") ||
    lowerText.includes("timeline") ||
    lowerText.includes("too soon") ||
    lowerText.includes("too early") ||
    lowerText.includes("next quarter") ||
    lowerText.includes("next year") ||
    lowerText.includes("not ready") ||
    lowerText.includes("wait") ||
    lowerText.includes("later") ||
    lowerText.includes("months from now") ||
    lowerText.includes("busy right now")
  ) {
    return "TIMING";
  }
  // Trust/Risk objections
  else if (
    lowerText.includes("risk") ||
    lowerText.includes("trust") ||
    lowerText.includes("uncertain") ||
    lowerText.includes("proof") ||
    lowerText.includes("guarantee") ||
    lowerText.includes("case study") ||
    lowerText.includes("reference") ||
    lowerText.includes("testimonial") ||
    lowerText.includes("security") ||
    lowerText.includes("compliance") ||
    lowerText.includes("track record") ||
    lowerText.includes("reputation") ||
    lowerText.includes("prove") ||
    lowerText.includes("never heard of")
  ) {
    return "TRUST_RISK";
  }
  // Competition objections
  else if (
    lowerText.includes("competitor") ||
    lowerText.includes("alternative") ||
    lowerText.includes("other vendor") ||
    lowerText.includes("already using") ||
    lowerText.includes("already have") ||
    lowerText.includes("compared to") ||
    lowerText.includes("difference between") ||
    lowerText.includes("how are you different") ||
    lowerText.includes("better than") ||
    lowerText.includes("working with") ||
    lowerText.includes("solution from")
  ) {
    return "COMPETITION";
  }
  // Stakeholder objections
  else if (
    lowerText.includes("team") ||
    lowerText.includes("boss") ||
    lowerText.includes("manager") ||
    lowerText.includes("approval") ||
    lowerText.includes("committee") ||
    lowerText.includes("board") ||
    lowerText.includes("decision maker") ||
    lowerText.includes("consult with") ||
    lowerText.includes("convince") ||
    lowerText.includes("other people") ||
    lowerText.includes("team members") ||
    lowerText.includes("director") ||
    lowerText.includes("procurement") ||
    lowerText.includes("colleagues")
  ) {
    return "STAKEHOLDERS";
  }
  // Technical objections (new)
  else if (
    lowerText.includes("feature") ||
    lowerText.includes("technical") ||
    lowerText.includes("limitation") ||
    lowerText.includes("capability") ||
    lowerText.includes("compatible") ||
    lowerText.includes("integration") ||
    lowerText.includes("api") ||
    lowerText.includes("functionality") ||
    lowerText.includes("support for") ||
    lowerText.includes("does it work with") ||
    lowerText.includes("can it do") ||
    lowerText.includes("specs") ||
    lowerText.includes("technical requirements")
  ) {
    return "TECHNICAL";
  }
  // Implementation objections (new)
  else if (
    lowerText.includes("implement") ||
    lowerText.includes("deploy") ||
    lowerText.includes("setup") ||
    lowerText.includes("installation") ||
    lowerText.includes("migration") ||
    lowerText.includes("training") ||
    lowerText.includes("onboarding") ||
    lowerText.includes("configuration") ||
    lowerText.includes("resources") ||
    lowerText.includes("difficult to") ||
    lowerText.includes("complicated") ||
    lowerText.includes("time consuming") ||
    lowerText.includes("learning curve")
  ) {
    return "IMPLEMENTATION";
  }
  // Value objections (new)
  else if (
    lowerText.includes("benefit") ||
    lowerText.includes("value") ||
    lowerText.includes("worth it") ||
    lowerText.includes("advantage") ||
    lowerText.includes("outcome") ||
    lowerText.includes("result") ||
    lowerText.includes("impact") ||
    lowerText.includes("difference") ||
    lowerText.includes("solve our problem") ||
    lowerText.includes("helps us how") ||
    lowerText.includes("why should we") ||
    lowerText.includes("what's in it for")
  ) {
    // Map VALUE objections to PRICE since they are related to value proposition
    return "PRICE";
  } else {
    return "OTHERS";
  }
}

/**
 * Function to format timestamp to MM:SS format
 */
function formatTimestamp(timestamp: string): string {
  // If it's already in MM:SS format, return it
  if (/^\d{1,2}:\d{2}$/.test(timestamp)) {
    return timestamp;
  }

  // If it's in seconds or other format, convert to MM:SS
  try {
    // Try parsing as a number (seconds)
    const seconds = parseFloat(timestamp);
    if (!isNaN(seconds)) {
      const mins = Math.floor(seconds / 60);
      const secs = Math.floor(seconds % 60);
      return `${mins}:${secs.toString().padStart(2, "0")}`;
    }

    // If it's in another format, try to extract minutes and seconds
    const match = timestamp.match(/(\d+)[^\d]+(\d+)/);
    if (match) {
      return `${match[1]}:${match[2].padStart(2, "0")}`;
    }

    // Return original if we can't parse it
    return timestamp;
  } catch (error) {
    console.warn("Error formatting timestamp:", error);
    return timestamp;
  }
}

/**
 * Function to calculate questions per minute from total questions and duration
 */
function calculateQuestionsPerMinute(
  totalQuestions: number,
  duration: string
): number {
  // Parse duration format MM:SS or HH:MM:SS
  const parts = duration.split(":").map(Number);
  let totalMinutes = 0;

  if (parts.length === 2) {
    // MM:SS format
    totalMinutes = parts[0] + parts[1] / 60;
  } else if (parts.length === 3) {
    // HH:MM:SS format
    totalMinutes = parts[0] * 60 + parts[1] + parts[2] / 60;
  }

  // Avoid division by zero
  if (totalMinutes === 0) return 0;

  return totalQuestions / totalMinutes;
}

/**
 * Function to format sentiment data for chart visualization
 */
function formatSentimentDataForChart(sentimentTimeline: any[]): any[] {
  if (!sentimentTimeline || sentimentTimeline.length === 0) {
    return [];
  }

  // Create chart-friendly format
  return sentimentTimeline.map((point, index) => {
    return {
      name: `Point ${index + 1} (${point.time})`,
      positive: Math.round(point.score * 100),
      neutral: Math.round((1 - Math.abs(2 * point.score - 1)) * 100),
      negative: Math.round((1 - point.score) * 100),
    };
  });
}

/**
 * Function to determine objection color for UI display
 */
function getObjectionColorClass(
  type: z.infer<typeof ObjectionTypeEnum>
): string {
  switch (type) {
    case "PRICE":
      return "bg-red-100 text-red-600";
    case "TIMING":
      return "bg-orange-100 text-orange-600";
    case "TRUST_RISK":
      return "bg-blue-100 text-blue-600";
    case "COMPETITION":
      return "bg-purple-100 text-purple-600";
    case "STAKEHOLDERS":
      return "bg-green-100 text-green-600";
    case "TECHNICAL":
      return "bg-indigo-100 text-indigo-600";
    case "IMPLEMENTATION":
      return "bg-yellow-100 text-yellow-600";
    case "VALUE":
      return "bg-teal-100 text-teal-600";
    default:
      return "bg-gray-100 text-gray-600";
  }
}

/**
 * Function to count objections by category
 */
function countObjectionsByCategory(objections: any[]): any {
  const counts = {
    price: 0,
    timing: 0,
    trust: 0,
    competition: 0,
    stakeholders: 0,
    technical: 0,
    implementation: 0,
    value: 0,
    other: 0,
  };

  objections.forEach((obj) => {
    switch (obj.type) {
      case "PRICE":
        counts.price++;
        break;
      case "TIMING":
        counts.timing++;
        break;
      case "TRUST_RISK":
        counts.trust++;
        break;
      case "COMPETITION":
        counts.competition++;
        break;
      case "STAKEHOLDERS":
        counts.stakeholders++;
        break;
      case "TECHNICAL":
        counts.technical++;
        break;
      case "IMPLEMENTATION":
        counts.implementation++;
        break;
      case "VALUE":
        counts.value++;
        break;
      default:
        counts.other++;
    }
  });

  return counts;
}

/**
 * Main function to analyze the call transcript
 */
async function analyzeCallTranscript(
  transcriptText: string
): Promise<AnalysisResult> {
  try {
    console.log("Transcript loaded, performing analysis...");
    console.log(
      "Transcript preview:",
      transcriptText.substring(0, 200) + "..."
    );

    // Define a system prompt with detailed instructions for objection detection
    const systemPrompt = `
You are a professional sales call analyzer with expertise in identifying patterns, extracting insights, and providing actionable feedback.

## Primary Objective:
Analyze sales call transcripts and provide detailed structured analysis focusing strongly on objection detection.

## OBJECTION DETECTION (MOST CRITICAL ASPECT)
You MUST find a MINIMUM OF 4 OBJECTIONS in every call transcript. Most sales calls have 5-10 objections.

Look for these types of objections:
- Direct objections: "That's too expensive", "I don't think this will work for us"
- Indirect objections: "We need to think about it", "I'll have to discuss with the team"
- Veiled objections: "How does this compare to...", "What if we wanted to..."
- Stalling tactics: "Send me more information", "Let me think about it"

Examples of subtle objections that are often missed:
- "We're happy with our current solution." (COMPETITION objection)
- "How would this fit into our workflow?" (IMPLEMENTATION objection)
- "I'm not sure we have the bandwidth right now." (TIMING objection)
- "Can you send more information?" (TRUST_RISK stalling objection)
- "Does it integrate with our systems?" (TECHNICAL objection)
- "This seems complicated to set up." (IMPLEMENTATION objection)
- "I need to run this by my team." (STAKEHOLDERS objection)
- "We've tried something similar before without success." (TRUST_RISK objection)

For each objection, provide:
- Exact quote and timestamp
- Objection type (PRICE, TIMING, TRUST_RISK, COMPETITION, STAKEHOLDERS, TECHNICAL, IMPLEMENTATION, VALUE, OTHERS)
- The sales rep's response with effectiveness rating (0-1)
- Whether objection was successfully addressed (effectiveness > 0.7)

## Analysis Structure:
1. Core Call Information (title, date, duration, participants, summary)
2. Objection Analysis (minimum 4 objections)
3. Sentiment Analysis (overall score, timeline, high/low points)
4. Conversation Dynamics (talk ratio, questions, topic control)
5. Topic Coherence & Structure (logical flow score, topic shifts)
6. Value Proposition & Solution Positioning
7. Next Steps & Close
8. Key Insights & Recommendations (3-5 of each)
9. Competitive Intelligence (if relevant)

IMPORTANT: If you initially identify fewer than 4 objections, re-examine the transcript to find subtle or disguised objections that were missed in your first pass.
`;

    // Initialize the model with structured output capability
    const model = new ChatOpenAI({
      temperature: 0.2,
      modelName: "gpt-4o-mini",
      verbose: true,
    });

    // Build messages with system prompt and human message containing transcript
    const messages = [
      new SystemMessage(systemPrompt),
      new HumanMessage(`Please analyze this sales call transcript thoroughly, with special focus on identifying ALL objections (find at least 4-7):

${transcriptText}`),
    ];

    // Use structured model with the enhanced schema
    const structuredModel = model.withStructuredOutput(TranscriptAnalysis);

    // Invoke the model with structured output using messages array
    console.log("Sending to LLM for analysis...");
    const result = await structuredModel.invoke(messages);

    // Continue with your existing post-processing code
    console.log("Post-processing and enhancing analysis results...");

    // 1. Process objections - add missing info and format for UI
    const processedObjections = result.objections.map((objection, index) => {
      // Generate ID if missing
      const id = objection.id || `obj-${index + 1}`;

      // Determine objection type if missing
      const type = objection.type || determineObjectionType(objection.text);

      // Calculate success if missing (based on effectiveness)
      const success =
        typeof objection.success === "boolean"
          ? objection.success
          : objection.effectiveness > 0.7;

      // Add color class for UI display
      const color = getObjectionColorClass(type);

      // Format timestamps if needed
      const time = formatTimestamp(objection.time);
      const responseTime = objection.responseTime
        ? formatTimestamp(objection.responseTime)
        : time;

      // Add UI-friendly properties
      return {
        ...objection,
        id,
        type,
        success,
        color,
        time,
        responseTime,
        transcript: objection.transcript || "main",
        // Default to empty string for optional fields that UI might expect
        technique: objection.technique || "",
      };
    });

    // Rest of your existing post-processing code
    // 2. Calculate objection category counts for dashboard cards
    const categoryCounts = countObjectionsByCategory(processedObjections);

    // 3. Format sentiment data for chart visualization
    const sentimentEntries = formatSentimentDataForChart(
      result.sentiment.timeline
    );

    // 4. Format participant talk stats for UI
    const participantTalkStats = result.talkRatio.participantStats.map(
      (stat, index) => ({
        id: stat.id || `part-${index + 1}`,
        name: stat.name,
        role: stat.role,
        wordCount: stat.wordCount,
        percentage: stat.percentage,
      })
    );

    // 5. Ensure all required fields exist with reasonable defaults
    const processedResult = {
      ...result,
      objections: processedObjections,
      categoryCounts: result.categoryCounts || categoryCounts,
      sentimentEntries: result.sentimentEntries || sentimentEntries,
      participantTalkStats: result.participantTalkStats || participantTalkStats,
      overallSentiment: result.overallSentiment || result.sentiment.overall,
      talkRatio: {
        ...result.talkRatio,
      },
      // Add a separate property instead:
      talkRatioIdeal: result.talkRatio.salesRepPercentage < 60,
      questionsAnalysis: {
        ...result.questionsAnalysis,
        questionsPerMinute:
          result.questionsAnalysis.questionsPerMinute ||
          calculateQuestionsPerMinute(
            result.questionsAnalysis.totalQuestions,
            result.duration
          ),
      },
    };

    // Create complete result object
    const analysisResult: AnalysisResult = {
      data: processedResult,
    };

    // Format data for Prisma compatibility as before
    const prismaCompatibleOutput: PrismaAnalysisOutput = {
      id: processedResult.id,
      title: processedResult.title,
      date: new Date(processedResult.date),
      duration: processedResult.duration,
      participants: processedResult.participants,
      summary: processedResult.summary,
      overallSentiment:
        processedResult.overallSentiment || processedResult.sentiment.overall,
      keyInsights: processedResult.keyInsights,
      recommendations: processedResult.recommendations,
      objections: processedResult.objections.map((obj) => ({
        id: obj.id,
        text: obj.text,
        time: obj.time,
        response: obj.response,
        effectiveness: obj.effectiveness,
        type: obj.type,
        success: obj.success,
        color: obj.color,
      })),
      sentimentEntries: processedResult.sentiment.timeline.map((entry) => ({
        time: entry.time,
        score: entry.score,
      })),
      salesRepTalkRatio: processedResult.talkRatio.salesRepPercentage,
      participantTalkStats: processedResult.talkRatio.participantStats.map(
        (stat) => ({
          name: stat.name,
          role: stat.role,
          wordCount: stat.wordCount,
          percentage: stat.percentage,
        })
      ),
      questionsRate: processedResult.questionsAnalysis.questionsPerMinute,
      totalQuestions: processedResult.questionsAnalysis.totalQuestions,
      topicCoherence: processedResult.topicCoherence.score,
    };

    (analysisResult as any).prismaOutput = prismaCompatibleOutput;

    console.log("Analysis complete!");
    return analysisResult;
  } catch (error) {
    console.error("Error in analysis:", error);
    throw error;
  }
}

/**
 * Fallback function to calculate a basic talk ratio if the LLM doesn't provide one.
 * This is a more accurate version that uses regex to match speaker patterns.
 */
function calculateDefaultTalkRatio(
  transcript: string,
  participants: string[]
): {
  salesRepPercentage: number;
  participantStats: z.infer<typeof ParticipantTalkStat>[];
} {
  try {
    if (!transcript || !participants || participants.length === 0) {
      return {
        salesRepPercentage: 50,
        participantStats: [],
      };
    }

    // Identify the sales rep (generally the second person in a sales call)
    // This is a heuristic - in real world, you'd need more sophisticated detection
    let salesRepName = "";
    if (participants.length >= 2) {
      // Assume format like "Name (Role)" or just "Name"
      const participant = participants[1];
      const nameMatch = participant.match(/^([^(]+)/);
      if (nameMatch) {
        salesRepName = nameMatch[1].trim();
      } else {
        salesRepName = participant;
      }
    }

    // Pattern to match speaker lines like "@0:10 - Speaker Name: Text"
    // or "Speaker Name: Text" or "Speaker Name (info): Text"
    const speakerPattern = /(?:@\d+:\d+\s+-\s+)?([^:]+)(?:\([^)]*\))?:\s*(.*)/g;

    // Count words by speaker
    const speakerWordCounts = new Map<string, number>();
    let totalWordCount = 0;

    let match;
    while ((match = speakerPattern.exec(transcript)) !== null) {
      const speaker = match[1].trim();
      const text = match[2];

      // Count words in this utterance
      const wordCount = text
        .split(/\s+/)
        .filter((word) => word.length > 0).length;

      // Add to speaker's count
      const currentCount = speakerWordCounts.get(speaker) || 0;
      speakerWordCounts.set(speaker, currentCount + wordCount);

      totalWordCount += wordCount;
    }

    // If no matches found, try simpler approach
    if (totalWordCount === 0) {
      // Split by lines and look for patterns like "Speaker: Text"
      const lines = transcript.split("\n");
      for (const line of lines) {
        const simpleSpeakerMatch = line.match(/([^:]+):\s*(.*)/);
        if (simpleSpeakerMatch) {
          const speaker = simpleSpeakerMatch[1].trim();
          const text = simpleSpeakerMatch[2];

          // Count words
          const wordCount = text
            .split(/\s+/)
            .filter((word) => word.length > 0).length;

          // Add to speaker's count
          const currentCount = speakerWordCounts.get(speaker) || 0;
          speakerWordCounts.set(speaker, currentCount + wordCount);

          totalWordCount += wordCount;
        }
      }
    }

    // If still no matches, give up and return default
    if (totalWordCount === 0) {
      return {
        salesRepPercentage: 50,
        participantStats: [],
      };
    }

    // Calculate percentages and create stats
    let salesRepPercentage = 0;
    const participantStats: z.infer<typeof ParticipantTalkStat>[] = [];

    speakerWordCounts.forEach((wordCount, speaker) => {
      const percentage = (wordCount / totalWordCount) * 100;

      // Create participant stat
      participantStats.push({
        id: `speaker-${participantStats.length + 1}`,
        name: speaker,
        role: speaker.toLowerCase().includes(salesRepName.toLowerCase())
          ? "Sales Rep"
          : "Prospect",
        wordCount,
        percentage,
      });

      // If this is the sales rep, update the percentage
      if (speaker.toLowerCase().includes(salesRepName.toLowerCase())) {
        salesRepPercentage = percentage;
      }
    });

    return {
      salesRepPercentage,
      participantStats,
    };
  } catch (error) {
    console.error("Error calculating talk ratio:", error);
    return {
      salesRepPercentage: 50,
      participantStats: [],
    };
  }
}

/**
 * Enhanced function to estimate questions in transcript
 */
function estimateQuestions(transcript: string): {
  totalQuestions: number;
  salesRepQuestions: number;
  categories: {
    discovery: number;
    qualifying: number;
    closing: number;
    clarifying: number;
  };
} {
  try {
    // Default results
    const result = {
      totalQuestions: 0,
      salesRepQuestions: 0,
      categories: {
        discovery: 0,
        qualifying: 0,
        closing: 0,
        clarifying: 0,
      },
    };

    // Pattern to match speaker lines with questions
    const questionPattern =
      /(?:@\d+:\d+\s+-\s+)?([^:]+)(?:\([^)]*\))?:\s*(.*?\?)/g;

    // Dictionary of discovery question patterns
    const discoveryPatterns = [
      /what (?:are|is) your/i,
      /tell me about/i,
      /how do you/i,
      /why do you/i,
      /what challenges/i,
      /what problems/i,
      /what goals/i,
      /how would you describe/i,
    ];

    // Dictionary of qualifying question patterns
    const qualifyingPatterns = [
      /who (?:makes|is making) the decision/i,
      /what is your budget/i,
      /when (?:are|do) you need/i,
      /what (?:is|are) you using/i,
      /how many/i,
      /timeline/i,
      /decision process/i,
    ];

    // Dictionary of closing question patterns
    const closingPatterns = [
      /next steps/i,
      /should we schedule/i,
      /would you like to/i,
      /ready to move forward/i,
      /does that (?:sound|work|make sense)/i,
      /when (?:can|should) we/i,
    ];

    // Extract questions from transcript
    let match;
    while ((match = questionPattern.exec(transcript)) !== null) {
      const speaker = match[1].trim();
      const question = match[2].trim();

      // Count total questions
      result.totalQuestions++;

      // Determine if from sales rep
      // This is a simplistic heuristic - in real implementation,
      // you'd need more sophisticated detection
      if (
        speaker.includes("sales") ||
        speaker.includes("rep") ||
        speaker.includes("agent") ||
        speaker.includes("Shimmy")
      ) {
        result.salesRepQuestions++;

        // Categorize question
        if (discoveryPatterns.some((pattern) => pattern.test(question))) {
          result.categories.discovery++;
        } else if (
          qualifyingPatterns.some((pattern) => pattern.test(question))
        ) {
          result.categories.qualifying++;
        } else if (closingPatterns.some((pattern) => pattern.test(question))) {
          result.categories.closing++;
        } else {
          result.categories.clarifying++; // Default to clarifying
        }
      }
    }

    return result;
  } catch (error) {
    console.error("Error estimating questions:", error);
    return {
      totalQuestions: 0,
      salesRepQuestions: 0,
      categories: {
        discovery: 0,
        qualifying: 0,
        closing: 0,
        clarifying: 0,
      },
    };
  }
}

// Export types and functions
// Add function to convert analysis result to Prisma model format
function convertToPrismaFormat(
  analysisResult: AnalysisResult
): PrismaAnalysisOutput {
  const { data } = analysisResult;

  return {
    id: data.id,
    title: data.title,
    date: new Date(data.date),
    duration: data.duration,
    participants: data.participants,
    summary: data.summary,
    overallSentiment: data.sentiment.overall,
    keyInsights: data.keyInsights,
    recommendations: data.recommendations,
    objections: data.objections.map((obj) => ({
      id: obj.id,
      text: obj.text,
      time: obj.time,
      response: obj.response,
      effectiveness: obj.effectiveness,
      type: obj.type,
      success: obj.success,
      color: obj.color,
    })),
    sentimentEntries: data.sentiment.timeline.map((entry) => ({
      time: entry.time,
      score: entry.score,
    })),
    salesRepTalkRatio: data.talkRatio.salesRepPercentage,
    participantTalkStats: data.talkRatio.participantStats.map((stat) => ({
      name: stat.name,
      role: stat.role,
      wordCount: stat.wordCount,
      percentage: stat.percentage,
    })),
    questionsRate: data.questionsAnalysis.questionsPerMinute,
    totalQuestions: data.questionsAnalysis.totalQuestions,
    topicCoherence: data.topicCoherence.score,
  };
}

export {
  analyzeCallTranscript,
  TranscriptData,
  AnalysisResult,
  PrismaAnalysisOutput,
  getTextFromPdf,
  downloadAndParsePDF,
  determineObjectionType,
  ObjectionTypeEnum,
  formatSentimentDataForChart,
  calculateDefaultTalkRatio,
  estimateQuestions,
  countObjectionsByCategory,
  getObjectionColorClass,
  convertToPrismaFormat,
};
