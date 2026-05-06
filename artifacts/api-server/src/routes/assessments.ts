import { Router, type IRouter } from "express";
import multer from "multer";
import { eq, desc, and } from "drizzle-orm";
import { db, usersTable, assessmentsTable } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { parseFile } from "../lib/parseExcel";
import { computeScorecard } from "../lib/scorecard";
import { getOrCreateConfig } from "./admin";
import {
  ListAssessmentsResponse,
  GetAssessmentParams,
  GetAssessmentResponse,
  GetAssessmentSummaryResponse,
} from "@workspace/api-zod";
import { logger } from "../lib/logger";

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

/* POST /assessments/upload — upload Excel or CSV, score, persist */
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
      res.status(400).json({
        error: "No file received. Send the file under the field name 'file'.",
      });
      return;
    }

    // 1. Parse the spreadsheet / CSV
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

    // 2. Load current config from DB (so settings changes take effect immediately)
    const config = await getOrCreateConfig();

    // 3. Run the multi-factor scoring engine with live config
    const { scorecard, status } = computeScorecard(
      totalInflow,
      totalOutflow,
      transactionCount,
      rows,
      config
    );

    // 4. Persist to database
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
          scorecard,
        })
        .returning();

      res.status(201).json(
        GetAssessmentResponse.parse({ ...assessment, scorecard })
      );
    } catch (err) {
      logger.error({ err }, "Failed to save assessment");
      res.status(500).json({
        error: "Assessment processed but could not be saved. Please try again.",
      });
    }
  }
);

/* GET /assessments — list assessments for current user */
router.get("/assessments", requireAuth, async (req, res): Promise<void> => {
  const userId = (req as any).userId as number;
  const rows = await db
    .select()
    .from(assessmentsTable)
    .where(eq(assessmentsTable.userId, userId))
    .orderBy(desc(assessmentsTable.createdAt));

  res.json(ListAssessmentsResponse.parse(rows));
});

/* GET /assessments/summary — dashboard summary cards */
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
      passCount:    all.filter((a) => a.status === "PASS").length,
      reviewCount:  all.filter((a) => a.status === "REVIEW").length,
      failCount:    all.filter((a) => a.status === "FAIL").length,
    })
  );
});

/* GET /assessments/:id — single assessment with scorecard */
router.get("/assessments/:id", requireAuth, async (req, res): Promise<void> => {
  const params = GetAssessmentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid assessment ID." });
    return;
  }

  const userId = (req as any).userId as number;
  const [assessment] = await db
    .select()
    .from(assessmentsTable)
    .where(
      and(
        eq(assessmentsTable.id, params.data.id),
        eq(assessmentsTable.userId, userId)
      )
    );

  if (!assessment) {
    res.status(404).json({ error: "Assessment not found." });
    return;
  }

  res.json(GetAssessmentResponse.parse(assessment));
});

export default router;
