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
 * Parse an Excel (.xlsx / .xls) or CSV file buffer.
 * Expected columns (case-insensitive): Date, Description, Type (Inflow/Outflow), Amount
 */
export function parseFile(buffer: Buffer, originalName: string): ParseResult {
  const ext = originalName.split(".").pop()?.toLowerCase() ?? "";

  let workbook: XLSX.WorkBook;

  if (ext === "csv") {
    // Parse as UTF-8 string so xlsx handles CSV quoting and delimiters correctly
    const csvStr = buffer.toString("utf-8");
    workbook = XLSX.read(csvStr, { type: "string" });
  } else {
    // .xlsx / .xls — binary buffer parse
    workbook = XLSX.read(buffer, { type: "buffer" });
  }

  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    throw new Error("The file appears to be empty — no sheets found.");
  }

  const sheet = workbook.Sheets[sheetName];
  const rows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(sheet, {
    defval: "",
    raw: false, // read dates as formatted strings
  });

  if (rows.length === 0) {
    throw new Error("The file has no data rows. Make sure the first row is a header row.");
  }

  // Discover column name mappings from first row (case-insensitive)
  const firstRowKeys = Object.keys(rows[0]);
  const find = (name: string) =>
    firstRowKeys.find((k) => k.trim().toLowerCase() === name) ?? null;

  const typeKey = find("type");
  const amountKey = find("amount");
  const dateKey = find("date");
  const descKey = find("description") ?? find("desc") ?? find("details") ?? find("narration");

  if (!typeKey || !amountKey) {
    const found = firstRowKeys.join(", ");
    throw new Error(
      `Missing required columns. Expected: Date, Description, Type, Amount. Found: ${found || "(none)"}`
    );
  }

  let totalInflow = 0;
  let totalOutflow = 0;
  const parsed: TransactionRow[] = [];
  let skipped = 0;

  for (const row of rows) {
    const typeRaw = String(row[typeKey] ?? "").trim().toLowerCase();
    const rawAmount = row[amountKey];
    const amount =
      typeof rawAmount === "number"
        ? rawAmount
        : parseFloat(String(rawAmount).replace(/[^0-9.-]/g, ""));

    if (isNaN(amount) || amount === 0) {
      skipped++;
      continue;
    }

    const txType: "Inflow" | "Outflow" =
      typeRaw === "inflow" || typeRaw === "credit" || typeRaw === "cr"
        ? "Inflow"
        : "Outflow";

    if (txType === "Inflow") {
      totalInflow += amount;
    } else {
      totalOutflow += amount;
    }

    parsed.push({
      date: dateKey ? String(row[dateKey] ?? "") : "",
      description: descKey ? String(row[descKey] ?? "") : "",
      type: txType,
      amount,
    });
  }

  if (parsed.length === 0) {
    throw new Error(
      `No valid transactions found. ${skipped} rows were skipped due to missing or non-numeric Amount values.`
    );
  }

  return {
    rows: parsed,
    totalInflow,
    totalOutflow,
    transactionCount: parsed.length,
  };
}

// Keep old export name as an alias for backward compatibility
export const parseExcelFile = (buffer: Buffer) => parseFile(buffer, "file.xlsx");

/**
 * Apply business rules to determine assessment status.
 * - PASS:   inflow > outflow AND transactions > 10
 * - REVIEW: inflow > outflow AND transactions 5–10 (inclusive)
 * - FAIL:   outflow >= inflow  OR  fewer than 5 transactions
 */
export function determineStatus(
  totalInflow: number,
  totalOutflow: number,
  transactionCount: number
): "PASS" | "REVIEW" | "FAIL" {
  if (totalOutflow >= totalInflow) return "FAIL";
  if (transactionCount < 5) return "FAIL";
  if (transactionCount <= 10) return "REVIEW";
  return "PASS";
}
