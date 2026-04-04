import { Router, type IRouter } from "express";
import { desc, eq, count } from "drizzle-orm";
import { db, usersTable, assessmentsTable } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import {
  AdminListUsersResponse,
  AdminGetStatsResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

/**
 * Middleware to require admin — checks if the logged-in user is an admin.
 */
async function requireAdmin(
  req: any,
  res: any,
  next: any
): Promise<void> {
  const userId = (req as any).userId as number;
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, userId));

  if (!user || !user.isAdmin) {
    res.status(403).json({ error: "Forbidden: admin access required" });
    return;
  }
  next();
}

/* GET /admin/users — all users with their assessments */
router.get(
  "/admin/users",
  requireAuth,
  requireAdmin,
  async (req, res): Promise<void> => {
    const users = await db
      .select()
      .from(usersTable)
      .orderBy(desc(usersTable.createdAt));

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
  }
);

/* GET /admin/stats — platform-wide stats */
router.get(
  "/admin/stats",
  requireAuth,
  requireAdmin,
  async (req, res): Promise<void> => {
    const allUsers = await db.select({ id: usersTable.id }).from(usersTable);
    const allAssessments = await db
      .select()
      .from(assessmentsTable);

    const passCount = allAssessments.filter((a) => a.status === "PASS").length;
    const reviewCount = allAssessments.filter((a) => a.status === "REVIEW").length;
    const failCount = allAssessments.filter((a) => a.status === "FAIL").length;

    res.json(
      AdminGetStatsResponse.parse({
        totalUsers: allUsers.length,
        totalAssessments: allAssessments.length,
        passCount,
        reviewCount,
        failCount,
      })
    );
  }
);

export default router;
