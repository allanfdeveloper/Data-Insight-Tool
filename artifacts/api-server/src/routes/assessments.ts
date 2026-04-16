import { Router, type IRouter } from "express";
import multer from "multer";
import { eq, desc, and } from "drizzle-orm";
import { db, usersTable, assessmentsTable } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { parseFile, determineStatus } from "../lib/parseExcel";
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
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // .xlsx
  "application/vnd.ms-excel", // .xls
  "text/csv",
  "text/plain", // some OSes send CSV as text/plain
  "application/csv",
  "application/octet-stream", // generic binary — rely on extension in this case
];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter(_req, file, cb) {
    const ext = "." + (file.originalname.split(".").pop() ?? "").toLowerCase();
    const mimeOk = ACCEPTED_MIMETYPES.includes(file.mimetype);
    const extOk = ACCEPTED_EXTENSIONS.includes(ext);

    if (extOk || mimeOk) {
      cb(null, true);
    } else {
      cb(
        new Error(
          `Unsupported file type: ${file.mimetype} (${file.originalname}). Only .xlsx, .xls, and .csv files are accepted.`
        )
      );
    }
  },
});

/* POST /assessments/upload — upload Excel or CSV file */
router.post(
  "/assessments/upload",
  requireAuth,
  (req, res, next) => {
    upload.single("file")(req, res, (err) => {
      if (err instanceof multer.MulterError) {
        if (err.code === "LIMIT_FILE_SIZE") {
          res.status(400).json({ error: "File too large. Maximum size is 10 MB." });
        } else {
          res.status(400).json({ error: err.message });
        }
        return;
      }
      if (err) {
        // fileFilter rejection (wrong type etc.)
        res.status(400).json({ error: err.message });
        return;
      }
      next();
    });
  },
  async (req, res): Promise<void> => {
    if (!req.file) {
      res.status(400).json({ error: "No file received. Make sure you are sending the file under the field name 'file'." });
      return;
    }

    let parseResult;
    try {
      parseResult = parseFile(req.file.buffer, req.file.originalname);
    } catch (err: any) {
      const message = err?.message ?? "Failed to parse file.";
      req.log.warn({ err, fileName: req.file.originalname }, "File parse error");
      res.status(422).json({
        error: message,
        hint: "Make sure your file has columns: Date, Description, Type (Inflow/Outflow), Amount",
      });
      return;
    }

    const { totalInflow, totalOutflow, transactionCount } = parseResult;
    const status = determineStatus(totalInflow, totalOutflow, transactionCount);

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
        })
        .returning();

      res.status(201).json(GetAssessmentResponse.parse(assessment));
    } catch (err) {
      logger.error({ err }, "Failed to save assessment");
      res.status(500).json({ error: "Assessment processed but could not be saved. Please try again." });
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

  const passCount = all.filter((a) => a.status === "PASS").length;
  const reviewCount = all.filter((a) => a.status === "REVIEW").length;
  const failCount = all.filter((a) => a.status === "FAIL").length;

  res.json(
    GetAssessmentSummaryResponse.parse({
      totalAssessments: all.length,
      latestAssessment: all[0] ?? null,
      passCount,
      reviewCount,
      failCount,
    })
  );
});

/* GET /assessments/:id — single assessment detail */
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
