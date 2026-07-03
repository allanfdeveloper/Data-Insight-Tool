import { Router, type IRouter } from "express";
import { desc, eq, count, sql } from "drizzle-orm";
import { db, usersTable, assessmentsTable, assessmentConfigTable } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import {
  AdminListUsersResponse,
  AdminGetStatsResponse,
  AdminGetSettingsResponse,
  AdminUpdateSettingsBody,
  AdminListAssessmentsResponse,
} from "@workspace/api-zod";
import type { AssessmentEngineConfig } from "../lib/scorecard";

const router: IRouter = Router();

/**
 * Middleware to require admin — checks if the logged-in user is an admin.
 */
export async function requireAdmin(req: any, res: any, next: any): Promise<void> {
  const userId = (req as any).userId as number;
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!user || !user.isAdmin) {
    res.status(403).json({ error: "Forbidden: admin access required" });
    return;
  }
  next();
}

/**
 * Get or create the assessment config row.
 * Always returns a valid config — inserts defaults if none exists.
 */
export async function getOrCreateConfig(): Promise<AssessmentEngineConfig & { id: number; updatedAt: Date }> {
  const rows = await db.select().from(assessmentConfigTable).limit(1);
  if (rows.length > 0) return rows[0] as any;

  const [inserted] = await db
    .insert(assessmentConfigTable)
    .values({
      minMonths: 3,
      minTransactions: 10,
      passThreshold: 65,
      reviewThreshold: 40,
      cashflowWeight: 40,
      activityWeight: 30,
      consistencyWeight: 30,
    })
    .returning();
  return inserted as any;
}

/* GET /admin/assessments — all assessments across all users (admin) */
router.get("/admin/assessments", requireAuth, requireAdmin, async (req, res): Promise<void> => {
  const rows = await db
    .select({
      id:               assessmentsTable.id,
      userId:           assessmentsTable.userId,
      userEmail:        usersTable.email,
      fileName:         assessmentsTable.fileName,
      status:           assessmentsTable.status,
      confidence:       assessmentsTable.confidence,
      totalInflow:      assessmentsTable.totalInflow,
      totalOutflow:     assessmentsTable.totalOutflow,
      transactionCount: assessmentsTable.transactionCount,
      scorecard:        assessmentsTable.scorecard,
      createdAt:        assessmentsTable.createdAt,
    })
    .from(assessmentsTable)
    .innerJoin(usersTable, eq(assessmentsTable.userId, usersTable.id))
    .orderBy(desc(assessmentsTable.createdAt));

  const mapped = rows.map((r) => ({
    ...r,
    totalScore: (r.scorecard as any)?.totalScore ?? null,
    scorecard:  undefined,
  }));

  res.json(AdminListAssessmentsResponse.parse(mapped));
});

/* DELETE /admin/users/:id — delete a user and all their data (admin) */
router.delete("/admin/users/:id", requireAuth, requireAdmin, async (req, res): Promise<void> => {
  const targetId = parseInt(req.params.id, 10);
  const requesterId = (req as any).userId as number;

  if (isNaN(targetId)) {
    res.status(400).json({ error: "Invalid user ID." });
    return;
  }
  if (targetId === requesterId) {
    res.status(400).json({ error: "Cannot delete your own account." });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, targetId));
  if (!user) {
    res.status(404).json({ error: "User not found." });
    return;
  }

  await db.delete(usersTable).where(eq(usersTable.id, targetId));
  res.status(204).send();
});

/* GET /admin/users — all users with their assessments */
router.get("/admin/users", requireAuth, requireAdmin, async (req, res): Promise<void> => {
  const users = await db.select().from(usersTable).orderBy(desc(usersTable.createdAt));

  const results = await Promise.all(
    users.map(async (user) => {
      const assessments = await db
        .select()
        .from(assessmentsTable)
        .where(eq(assessmentsTable.userId, user.id))
        .orderBy(desc(assessmentsTable.createdAt));

      const latestAssessment = assessments[0] ?? undefined;
      return {
        id: user.id,
        email: user.email,
        isAdmin: user.isAdmin,
        createdAt: user.createdAt,
        assessmentCount: assessments.length,
        latestAssessment,
      };
    })
  );

  res.json(AdminListUsersResponse.parse(results));
});

/* GET /admin/stats — platform-wide stats */
router.get("/admin/stats", requireAuth, requireAdmin, async (req, res): Promise<void> => {
  const allUsers = await db.select({ id: usersTable.id }).from(usersTable);
  const allAssessments = await db.select().from(assessmentsTable);

  res.json(
    AdminGetStatsResponse.parse({
      totalUsers: allUsers.length,
      totalAssessments: allAssessments.length,
      passCount:             allAssessments.filter((a) => a.status === "PASS").length,
      reviewCount:           allAssessments.filter((a) => a.status === "REVIEW").length,
      failCount:             allAssessments.filter((a) => a.status === "FAIL").length,
      highConfidenceCount:   allAssessments.filter((a) => a.confidence === "HIGH").length,
      mediumConfidenceCount: allAssessments.filter((a) => a.confidence === "MEDIUM").length,
      lowConfidenceCount:    allAssessments.filter((a) => a.confidence === "LOW").length,
    })
  );
});

/* GET /admin/settings — current assessment configuration */
router.get("/admin/settings", requireAuth, requireAdmin, async (req, res): Promise<void> => {
  const config = await getOrCreateConfig();
  res.json(AdminGetSettingsResponse.parse(config));
});

/* PUT /admin/settings — update assessment configuration */
router.put("/admin/settings", requireAuth, requireAdmin, async (req, res): Promise<void> => {
  const parsed = AdminUpdateSettingsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid configuration: " + parsed.error.issues.map((i) => i.message).join(", ") });
    return;
  }

  const {
    minMonths,
    minTransactions,
    passThreshold,
    reviewThreshold,
    cashflowWeight,
    activityWeight,
    consistencyWeight,
  } = parsed.data;

  if (passThreshold <= reviewThreshold) {
    res.status(400).json({ error: "Pass threshold must be greater than review threshold." });
    return;
  }

  const totalWeight = cashflowWeight + activityWeight + consistencyWeight;
  if (Math.abs(totalWeight - 100) > 0.5) {
    res.status(400).json({ error: `Factor weights must sum to 100 (currently ${totalWeight.toFixed(1)}).` });
    return;
  }

  const existing = await getOrCreateConfig();

  const [updated] = await db
    .update(assessmentConfigTable)
    .set({
      minMonths,
      minTransactions,
      passThreshold,
      reviewThreshold,
      cashflowWeight,
      activityWeight,
      consistencyWeight,
      updatedAt: new Date(),
    })
    .where(eq(assessmentConfigTable.id, existing.id))
    .returning();

  res.json(AdminGetSettingsResponse.parse(updated));
});

export default router;
