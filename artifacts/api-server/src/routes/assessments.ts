import { Router, type IRouter } from "express";
import multer from "multer";
import * as XLSX from "xlsx";
import { eq, desc, and, or } from "drizzle-orm";
import { db, usersTable, assessmentsTable, bankStatementsTable, auditLogsTable } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { parseFile } from "../lib/parseExcel";
import { computeScorecard } from "../lib/scorecard";
import { getOrCreateConfig, requireAdmin } from "./admin";
import {
  ListAssessmentsResponse,
  GetAssessmentParams,
  GetAssessmentResponse,
  GetAssessmentSummaryResponse,
} from "@workspace/api-zod";
import { logger } from "../lib/logger";

/** Back-fill legacy scorecard JSONB that predates the confidence layer. */
function backfillScorecard(sc: unknown, confidence: string, status?: "PASS" | "REVIEW" | "FAIL"): unknown {
  if (!sc || typeof sc !== "object") return sc;
  const scorecard = sc as Record<string, unknown>;
  if (!scorecard.confidence) scorecard.confidence = confidence;
  if (!scorecard.confidenceReasons) scorecard.confidenceReasons = [];
  if (!scorecard.trendAnalysis) {
    scorecard.trendAnalysis = {
      monthlyData: [],
      classification: "STABLE",
      inflowTrend: "stable",
      outflowTrend: "stable",
      netTrend: "stable",
      volatility: "low",
      trendScore: 0,
      explanations: ["Trend analysis not available for this assessment — re-upload to generate trend data."],
      isSevereDeterioration: false,
      hasRecoveryMomentum: false,
    };
  } else {
    const ta = scorecard.trendAnalysis as Record<string, unknown>;
    if (ta.isSevereDeterioration === undefined) ta.isSevereDeterioration = false;
    if (ta.hasRecoveryMomentum === undefined) ta.hasRecoveryMomentum = false;
    if (ta.isInsufficientHistory === undefined) ta.isInsufficientHistory = false;
  }
  if (!scorecard.marginHealth) {
    scorecard.marginHealth = {
      marginRatio: 0,
      classification: "Moderate",
      scoreModifier: 0,
      observations: ["Margin health analysis not available for this assessment — re-upload to generate resilience data."],
      isSevereDeterioration: false,
      isRecovery: false,
    };
  }
  if (!scorecard.revenueConcentration) {
    scorecard.revenueConcentration = {
      inflowCount: 0,
      largestInflow: 0,
      largestInflowPct: 0,
      top3Inflow: 0,
      top3Pct: 0,
      risk: "LOW",
      scoreModifier: 0,
      observations: ["Revenue concentration analysis not available for this assessment — re-upload to generate concentration data."],
    };
  }
  if (!scorecard.volatilityIntelligence) {
    scorecard.volatilityIntelligence = {
      monthlyInflows: [],
      meanMonthlyInflow: 0,
      stdDev: 0,
      cv: 0,
      classification: "LOW",
      scoreModifier: 0,
      explanations: ["Volatility analysis not available for this assessment — re-upload to generate volatility data."],
      isInsufficientHistory: true,
    };
  }
  if (!scorecard.expenseDependency) {
    scorecard.expenseDependency = {
      outflowCount: 0,
      largestExpense: 0,
      largestExpensePct: 0,
      top3Expense: 0,
      top3Pct: 0,
      risk: "LOW",
      scoreModifier: 0,
      observations: ["Expense dependency analysis not available for this assessment — re-upload to generate expense data."],
    };
  }
  if (!scorecard.governanceResult) {
    const dec = status ?? "REVIEW";
    scorecard.governanceResult = {
      overridesTriggered:  false,
      overrides:           [],
      provisionalDecision: dec,
      finalDecision:       dec,
    };
  }
  if (Array.isArray(scorecard.triggeredRules)) {
    scorecard.triggeredRules = (scorecard.triggeredRules as any[]).map((r) => {
      if (
        r.effect === "cap-review" &&
        (r.rule === "INSUFFICIENT_MONTHS" || r.rule === "INSUFFICIENT_TRANSACTIONS")
      ) {
        return { ...r, effect: "confidence-warning" };
      }
      return r;
    });
  }
  return scorecard;
}

/** Derive file type label from filename extension. */
function getFileType(fileName: string): string {
  const ext = (fileName.split(".").pop() ?? "").toLowerCase();
  if (ext === "pdf") return "pdf";
  if (ext === "csv") return "csv";
  if (ext === "xlsx") return "xlsx";
  if (ext === "xls") return "xls";
  return ext || "unknown";
}

/** Insert an audit log entry (fire-and-forget). */
async function logAudit(
  userId: number,
  assessmentId: number,
  action: string,
  metadata?: Record<string, unknown>
) {
  try {
    await db.insert(auditLogsTable).values({ userId, assessmentId, action, metadata: metadata ?? null });
  } catch (err) {
    logger.warn({ err, userId, assessmentId, action }, "Failed to write audit log");
  }
}

const router: IRouter = Router();

const ACCEPTED_EXTENSIONS = [".xlsx", ".xls", ".csv"];
const ACCEPTED_MIMETYPES = [
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "text/csv",
  "text/plain",
  "application/csv",
  "application/octet-stream",
];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    const ext = "." + (file.originalname.split(".").pop() ?? "").toLowerCase();
    if (ACCEPTED_EXTENSIONS.includes(ext) || ACCEPTED_MIMETYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(
        `Unsupported file type: ${file.mimetype} (${file.originalname}). ` +
        `Only .xlsx, .xls, and .csv files are accepted.`
      ));
    }
  },
});

/* POST /assessments/upload */
router.post(
  "/assessments/upload",
  requireAuth,
  (req, res, next) => {
    upload.single("file")(req, res, (err) => {
      if (err instanceof multer.MulterError) {
        res.status(400).json({
          error: err.code === "LIMIT_FILE_SIZE"
            ? "File too large. Maximum size is 10 MB."
            : err.message,
        });
        return;
      }
      if (err) {
        res.status(400).json({ error: err.message });
        return;
      }
      next();
    });
  },
  async (req, res): Promise<void> => {
    if (!req.file) {
      res.status(400).json({ error: "No file received. Send the file under the field name 'file'." });
      return;
    }

    let parseResult;
    try {
      parseResult = parseFile(req.file.buffer, req.file.originalname);
    } catch (err: any) {
      req.log.warn({ err, fileName: req.file.originalname }, "File parse error");
      res.status(422).json({
        error: err?.message ?? "Failed to parse file.",
        hint: "Make sure your file has columns: Date, Description, Type (Inflow/Outflow), Amount",
      });
      return;
    }

    const { totalInflow, totalOutflow, transactionCount, rows } = parseResult;

    const config = await getOrCreateConfig();

    const { scorecard, status, confidence } = computeScorecard(
      totalInflow,
      totalOutflow,
      transactionCount,
      rows,
      config
    );

    const userId = (req as any).userId as number;
    try {
      const [assessment] = await db
        .insert(assessmentsTable)
        .values({
          userId,
          fileName: req.file.originalname,
          totalInflow,
          totalOutflow,
          transactionCount,
          status,
          confidence,
          scorecard,
        })
        .returning();

      // Persist the original uploaded file linked to this assessment
      await db.insert(bankStatementsTable).values({
        assessmentId: assessment.id,
        fileName: req.file.originalname,
        fileSize: req.file.size,
        fileType: getFileType(req.file.originalname),
        uploadedBy: userId,
        fileContent: req.file.buffer,
      });

      res.status(201).json(GetAssessmentResponse.parse({ ...assessment, scorecard }));
    } catch (err) {
      logger.error({ err }, "Failed to save assessment");
      res.status(500).json({ error: "Assessment processed but could not be saved. Please try again." });
    }
  }
);

/* GET /assessments */
router.get("/assessments", requireAuth, async (req, res): Promise<void> => {
  const userId = (req as any).userId as number;
  const rows = await db
    .select()
    .from(assessmentsTable)
    .where(eq(assessmentsTable.userId, userId))
    .orderBy(desc(assessmentsTable.createdAt));

  res.json(ListAssessmentsResponse.parse(rows));
});

/* GET /assessments/summary */
router.get("/assessments/summary", requireAuth, async (req, res): Promise<void> => {
  const userId = (req as any).userId as number;
  const all = await db
    .select()
    .from(assessmentsTable)
    .where(eq(assessmentsTable.userId, userId))
    .orderBy(desc(assessmentsTable.createdAt));

  res.json(
    GetAssessmentSummaryResponse.parse({
      totalAssessments: all.length,
      latestAssessment: all[0] ?? null,
      passCount:   all.filter((a) => a.status === "PASS").length,
      reviewCount: all.filter((a) => a.status === "REVIEW").length,
      failCount:   all.filter((a) => a.status === "FAIL").length,
    })
  );
});

/* GET /assessments/:id */
router.get("/assessments/:id", requireAuth, async (req, res): Promise<void> => {
  const params = GetAssessmentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid assessment ID." });
    return;
  }

  const userId = (req as any).userId as number;
  const isAdmin = (req as any).isAdmin as boolean | undefined;

  const whereClause = isAdmin
    ? eq(assessmentsTable.id, params.data.id)
    : and(eq(assessmentsTable.id, params.data.id), eq(assessmentsTable.userId, userId));

  const [assessment] = await db.select().from(assessmentsTable).where(whereClause);

  if (!assessment) {
    res.status(404).json({ error: "Assessment not found." });
    return;
  }

  const patched = {
    ...assessment,
    scorecard: backfillScorecard(assessment.scorecard, assessment.confidence, assessment.status as "PASS" | "REVIEW" | "FAIL"),
  };

  res.json(GetAssessmentResponse.parse(patched));
});

/* ── Statement routes ────────────────────────────────────────────────── */

/** Resolve assessment ensuring ownership (or admin bypass). Returns null if not authorized. */
async function resolveAssessment(
  assessmentId: number,
  userId: number,
  isAdmin: boolean | undefined
) {
  const whereClause = isAdmin
    ? eq(assessmentsTable.id, assessmentId)
    : and(eq(assessmentsTable.id, assessmentId), eq(assessmentsTable.userId, userId));

  const [assessment] = await db.select({ id: assessmentsTable.id }).from(assessmentsTable).where(whereClause);
  return assessment ?? null;
}

/* GET /assessments/:id/statement — metadata */
router.get("/assessments/:id/statement", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid assessment ID." }); return; }

  const userId = (req as any).userId as number;
  const isAdmin = (req as any).isAdmin as boolean | undefined;

  const assessment = await resolveAssessment(id, userId, isAdmin);
  if (!assessment) { res.status(404).json({ error: "Assessment not found." }); return; }

  const [statement] = await db
    .select({
      id: bankStatementsTable.id,
      assessmentId: bankStatementsTable.assessmentId,
      fileName: bankStatementsTable.fileName,
      fileSize: bankStatementsTable.fileSize,
      fileType: bankStatementsTable.fileType,
      uploadedBy: bankStatementsTable.uploadedBy,
      uploadedAt: bankStatementsTable.uploadedAt,
    })
    .from(bankStatementsTable)
    .where(eq(bankStatementsTable.assessmentId, id));

  if (!statement) { res.status(404).json({ error: "No statement file found for this assessment." }); return; }

  // Resolve uploader email
  const [uploader] = await db
    .select({ email: usersTable.email })
    .from(usersTable)
    .where(eq(usersTable.id, statement.uploadedBy));

  res.json({
    id: statement.id,
    assessmentId: statement.assessmentId,
    fileName: statement.fileName,
    fileSize: statement.fileSize,
    fileType: statement.fileType,
    uploadedByEmail: uploader?.email ?? "unknown",
    uploadedAt: statement.uploadedAt,
  });
});

/* GET /assessments/:id/statement/view — serve file inline (browser display) */
router.get("/assessments/:id/statement/view", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid assessment ID." }); return; }

  const userId = (req as any).userId as number;
  const isAdmin = (req as any).isAdmin as boolean | undefined;

  const assessment = await resolveAssessment(id, userId, isAdmin);
  if (!assessment) { res.status(404).json({ error: "Assessment not found." }); return; }

  const [statement] = await db
    .select()
    .from(bankStatementsTable)
    .where(eq(bankStatementsTable.assessmentId, id));

  if (!statement) { res.status(404).json({ error: "No statement file found for this assessment." }); return; }

  await logAudit(userId, id, "VIEWED_STATEMENT", { fileName: statement.fileName });

  const mimeTypes: Record<string, string> = {
    pdf:  "application/pdf",
    csv:  "text/csv",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    xls:  "application/vnd.ms-excel",
  };
  const contentType = mimeTypes[statement.fileType] ?? "application/octet-stream";

  res.setHeader("Content-Type", contentType);
  res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(statement.fileName)}"`);
  res.setHeader("Content-Length", statement.fileSize);
  res.send(statement.fileContent);
});

/* GET /assessments/:id/statement/download — serve file as attachment */
router.get("/assessments/:id/statement/download", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid assessment ID." }); return; }

  const userId = (req as any).userId as number;
  const isAdmin = (req as any).isAdmin as boolean | undefined;

  const assessment = await resolveAssessment(id, userId, isAdmin);
  if (!assessment) { res.status(404).json({ error: "Assessment not found." }); return; }

  const [statement] = await db
    .select()
    .from(bankStatementsTable)
    .where(eq(bankStatementsTable.assessmentId, id));

  if (!statement) { res.status(404).json({ error: "No statement file found for this assessment." }); return; }

  await logAudit(userId, id, "DOWNLOADED_STATEMENT", { fileName: statement.fileName });

  const mimeTypes: Record<string, string> = {
    pdf:  "application/pdf",
    csv:  "text/csv",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    xls:  "application/vnd.ms-excel",
  };
  const contentType = mimeTypes[statement.fileType] ?? "application/octet-stream";

  res.setHeader("Content-Type", contentType);
  res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(statement.fileName)}"`);
  res.setHeader("Content-Length", statement.fileSize);
  res.send(statement.fileContent);
});

/* GET /assessments/:id/statement/preview — parsed sheet rows (50 row cap) */
router.get("/assessments/:id/statement/preview", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid assessment ID." }); return; }

  const userId = (req as any).userId as number;
  const isAdmin = (req as any).isAdmin as boolean | undefined;

  const assessment = await resolveAssessment(id, userId, isAdmin);
  if (!assessment) { res.status(404).json({ error: "Assessment not found." }); return; }

  const [statement] = await db
    .select({ fileContent: bankStatementsTable.fileContent, fileType: bankStatementsTable.fileType, fileName: bankStatementsTable.fileName })
    .from(bankStatementsTable)
    .where(eq(bankStatementsTable.assessmentId, id));

  if (!statement) { res.status(404).json({ error: "No statement file found for this assessment." }); return; }

  try {
    const buffer = statement.fileContent as Buffer;
    let workbook: XLSX.WorkBook;
    if (statement.fileType === "csv") {
      workbook = XLSX.read(buffer.toString("utf-8"), { type: "string" });
    } else {
      workbook = XLSX.read(buffer, { type: "buffer" });
    }

    const sheetName = workbook.SheetNames[0];
    if (!sheetName) { res.status(422).json({ error: "File has no sheets." }); return; }

    const sheet = workbook.Sheets[sheetName];
    const rawRows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(sheet, { defval: "", raw: false });

    const totalRows = rawRows.length;
    const previewSlice = rawRows.slice(0, 50);
    const headers = previewSlice.length > 0 ? Object.keys(previewSlice[0]) : [];
    const rows = previewSlice.map((r) => headers.map((h) => r[h] ?? ""));

    res.json({ headers, rows, totalRows, previewRows: previewSlice.length });
  } catch (err) {
    logger.warn({ err }, "Failed to parse statement for preview");
    res.status(422).json({ error: "Unable to parse file for preview." });
  }
});

/* DELETE /assessments/:id/statement — admin only */
router.delete("/assessments/:id/statement", requireAuth, requireAdmin, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid assessment ID." }); return; }

  const [statement] = await db
    .select({ id: bankStatementsTable.id, fileName: bankStatementsTable.fileName })
    .from(bankStatementsTable)
    .where(eq(bankStatementsTable.assessmentId, id));

  if (!statement) { res.status(404).json({ error: "No statement found for this assessment." }); return; }

  const userId = (req as any).userId as number;
  await db.delete(bankStatementsTable).where(eq(bankStatementsTable.id, statement.id));
  await logAudit(userId, id, "DELETED_STATEMENT", { fileName: statement.fileName });

  res.status(204).send();
});

/* DELETE /assessments/:id — admin only */
router.delete("/assessments/:id", requireAuth, requireAdmin, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid assessment ID." });
    return;
  }

  const [assessment] = await db
    .select({ id: assessmentsTable.id })
    .from(assessmentsTable)
    .where(eq(assessmentsTable.id, id));

  if (!assessment) {
    res.status(404).json({ error: "Assessment not found." });
    return;
  }

  const deleteFile = req.query.deleteFile === "true";
  if (deleteFile) {
    // Delete the bank statement first so the file is gone too
    await db.delete(bankStatementsTable).where(eq(bankStatementsTable.assessmentId, id));
  }
  // ON DELETE SET NULL on bank_statements.assessment_id handles the case where deleteFile=false

  await db.delete(assessmentsTable).where(eq(assessmentsTable.id, id));
  res.status(204).send();
});

export default router;
