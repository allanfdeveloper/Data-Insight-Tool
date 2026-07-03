import { pgTable, serial, integer, text, timestamp, customType } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { assessmentsTable } from "./assessments";

const bytea = customType<{ data: Buffer }>({
  dataType() {
    return "bytea";
  },
});

export const bankStatementsTable = pgTable("bank_statements", {
  id: serial("id").primaryKey(),
  assessmentId: integer("assessment_id")
    .references(() => assessmentsTable.id, { onDelete: "set null" }),
  fileName: text("file_name").notNull(),
  fileSize: integer("file_size").notNull(),
  fileType: text("file_type").notNull(),
  uploadedBy: integer("uploaded_by")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
  fileContent: bytea("file_content").notNull(),
});

export type BankStatement = typeof bankStatementsTable.$inferSelect;
