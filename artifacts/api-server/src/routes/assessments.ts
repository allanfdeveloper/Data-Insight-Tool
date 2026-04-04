import { Router, type IRouter } from "express";
import multer from "multer";
import { eq, desc, count, and } from "drizzle-orm";
import { db, usersTable, assessmentsTable } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { parseExcelFile, determineStatus } from "../lib/parseExcel";
import {
  ListAssessmentsResponse,
  GetAssessmentParams,
  GetAssessmentResponse,
  GetAssessmentSummaryResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

// Use multer memory storage (no disk writes needed)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB limit
  fileFilter(_req, file, cb) {
    if (
      file.originalname.endsWith(".xlsx") ||
      file.mimetype ===
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    ) {
      cb(null, true);
    } else {
      cb(new Error("Only .xlsx files are accepted"));
    }
  },
});

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

/* GET /assessments/summary — dashboard summary */
router.get("/assessments/summary", requireAuth, async (req, res): Promise<void> => {
  const userId = (req as any).userId as number;

  const all = await db
    .select()
    .from(assessmentsTable)
    .where(eq(assessmentsTable.userId, userId))
    .orderBy(desc(assessmentsTable.createdAt));

  const passCount = all.filter((a) => a.status === "PASS").length;
  const reviewCount = all.filter((a) => a.status === "REVIEW").length;
  const failCount = all.filter((a) => a.status === "FAIL").length;
  const latestAssessment = all[0] ?? null;

  res.json(
    GetAssessmentSummaryResponse.parse({
      totalAssessments: all.length,
      latestAssessment,
      passCount,
      reviewCount,
      failCount,
    })
  );
});

/* POST /assessments/upload — upload Excel file */
router.post(
  "/assessments/upload",
  requireAuth,
  upload.single("file"),
  async (req, res): Promise<void> => {
    if (!req.file) {
      res.status(400).json({ error: "No file uploaded" });
      return;
    }

    let parseResult;
    try {
      parseResult = parseExcelFile(req.file.buffer);
    } catch (err) {
      req.log.warn({ err }, "Failed to parse Excel file");
      res.status(400).json({ error: "Failed to parse Excel file. Ensure it has Date, Description, Type, and Amount columns." });
      return;
    }

    const { totalInflow, totalOutflow, transactionCount } = parseResult;
    const status = determineStatus(totalInflow, totalOutflow, transactionCount);

    const userId = (req as any).userId as number;
    const [assessment] = await db
      .insert(assessmentsTable)
      .values({
        userId,
        fileName: req.file.originalname,
        totalInflow,
        totalOutflow,
        transactionCount,
        status,
      })
      .returning();

    res.status(201).json(GetAssessmentResponse.parse(assessment));
  }
);

/* GET /assessments/:id — single assessment */
router.get("/assessments/:id", requireAuth, async (req, res): Promise<void> => {
  const params = GetAssessmentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
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
    res.status(404).json({ error: "Assessment not found" });
    return;
  }

  res.json(GetAssessmentResponse.parse(assessment));
});

export default router;
