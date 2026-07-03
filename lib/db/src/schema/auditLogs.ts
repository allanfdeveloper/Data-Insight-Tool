import { pgTable, serial, integer, text, timestamp, jsonb } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { assessmentsTable } from "./assessments";

export const auditLogsTable = pgTable("audit_logs", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .references(() => usersTable.id, { onDelete: "set null" }),
  assessmentId: integer("assessment_id")
    .references(() => assessmentsTable.id, { onDelete: "set null" }),
  action: text("action").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  metadata: jsonb("metadata"),
});

export type AuditLog = typeof auditLogsTable.$inferSelect;
