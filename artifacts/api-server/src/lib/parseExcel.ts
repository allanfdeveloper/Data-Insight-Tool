import * as XLSX from "xlsx";

export interface TransactionRow {
  date: string;
  description: string;
  type: "Inflow" | "Outflow";
  amount: number;
}

export interface ParseResult {
  rows: TransactionRow[];
  totalInflow: number;
  totalOutflow: number;
  transactionCount: number;
}

/**
 * Parse an Excel (.xlsx) file buffer.
 * Expected columns: Date, Description, Type (Inflow/Outflow), Amount
 */
export function parseExcelFile(buffer: Buffer): ParseResult {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];

  // Convert sheet to array of objects
  const rows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(sheet, { defval: "" });

  let totalInflow = 0;
  let totalOutflow = 0;
  const parsed: TransactionRow[] = [];

  for (const row of rows) {
    // Accept case-insensitive column names
    const keys = Object.keys(row);
    const typeKey = keys.find((k) => k.toLowerCase() === "type") ?? "Type";
    const amountKey = keys.find((k) => k.toLowerCase() === "amount") ?? "Amount";
    const dateKey = keys.find((k) => k.toLowerCase() === "date") ?? "Date";
    const descKey = keys.find((k) => k.toLowerCase() === "description") ?? "Description";

    const type = String(row[typeKey] ?? "").trim();
    const rawAmount = row[amountKey];
    const amount =
      typeof rawAmount === "number"
        ? rawAmount
        : parseFloat(String(rawAmount).replace(/[^0-9.-]/g, ""));

    if (isNaN(amount)) continue;

    const txType = type.toLowerCase() === "inflow" ? "Inflow" : "Outflow";

    if (txType === "Inflow") {
      totalInflow += amount;
    } else {
      totalOutflow += amount;
    }

    parsed.push({
      date: String(row[dateKey] ?? ""),
      description: String(row[descKey] ?? ""),
      type: txType,
      amount,
    });
  }

  return {
    rows: parsed,
    totalInflow,
    totalOutflow,
    transactionCount: parsed.length,
  };
}

/**
 * Apply business rules to determine assessment status.
 * - PASS: inflow > outflow AND transactions > 10
 * - REVIEW: transactions between 5–10 (inclusive)
 * - FAIL: outflow >= inflow
 */
export function determineStatus(
  totalInflow: number,
  totalOutflow: number,
  transactionCount: number
): "PASS" | "REVIEW" | "FAIL" {
  if (totalOutflow >= totalInflow) {
    return "FAIL";
  }
  if (transactionCount > 10 && totalInflow > totalOutflow) {
    return "PASS";
  }
  if (transactionCount >= 5 && transactionCount <= 10) {
    return "REVIEW";
  }
  // fallback: fewer than 5 transactions with inflow > outflow => REVIEW
  return "REVIEW";
}
