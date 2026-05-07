import { pgTable, serial, integer, text, real, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const assessmentsTable = pgTable("assessments", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  fileName: text("file_name").notNull(),
  totalInflow: real("total_inflow").notNull().default(0),
  totalOutflow: real("total_outflow").notNull().default(0),
  transactionCount: integer("transaction_count").notNull().default(0),
  status: text("status", { enum: ["PASS", "REVIEW", "FAIL"] }).notNull(),
  confidence: text("confidence", { enum: ["HIGH", "MEDIUM", "LOW"] }).notNull().default("HIGH"),
  // Stores the full multi-factor scorecard as computed at upload time
  scorecard: jsonb("scorecard"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertAssessmentSchema = createInsertSchema(assessmentsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertAssessment = z.infer<typeof insertAssessmentSchema>;
export type Assessment = typeof assessmentsTable.$inferSelect;
