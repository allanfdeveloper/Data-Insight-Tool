import { pgTable, serial, integer, real, timestamp } from "drizzle-orm/pg-core";

export const assessmentConfigTable = pgTable("assessment_config", {
  id: serial("id").primaryKey(),
  minMonths: integer("min_months").notNull().default(3),
  minTransactions: integer("min_transactions").notNull().default(10),
  passThreshold: integer("pass_threshold").notNull().default(65),
  reviewThreshold: integer("review_threshold").notNull().default(40),
  cashflowWeight: real("cashflow_weight").notNull().default(40),
  activityWeight: real("activity_weight").notNull().default(30),
  consistencyWeight: real("consistency_weight").notNull().default(30),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type AssessmentConfigRow = typeof assessmentConfigTable.$inferSelect;
