import * as XLSX from "xlsx";

export interface TransactionRow {
  date: string;
  description: string;
  type: "Inflow" | "Outflow";
  /** Always a positive number — direction is conveyed by `type` */
  amount: number;
}

export interface ParseResult {
  rows: TransactionRow[];
  /** Sum of all inflow amounts (always positive) */
  totalInflow: number;
  /** Sum of all outflow amounts (always positive) */
  totalOutflow: number;
  /** Net cashflow = totalInflow - totalOutflow */
  netCashflow: number;
  transactionCount: number;
}

/**
 * Parse an Excel (.xlsx / .xls) or CSV file buffer.
 *
 * Accepted column names (case-insensitive):
 *   Date, Description / Desc / Details / Narration, Type, Amount
 *
 * Amount handling:
 *   - Always stored and totalled as a positive magnitude.
 *   - The `Type` column (Inflow / Credit / CR vs anything else → Outflow)
 *     determines direction; the sign of the raw Amount is ignored.
 *   - This handles the two most common bank-export formats:
 *       Format A: all amounts positive, Type column for direction
 *       Format B: inflows positive, outflows negative, Type column present
 *     Both are normalised to positive magnitudes here.
 */
export function parseFile(buffer: Buffer, originalName: string): ParseResult {
  const ext = originalName.split(".").pop()?.toLowerCase() ?? "";

  let workbook: XLSX.WorkBook;
  if (ext === "csv") {
    workbook = XLSX.read(buffer.toString("utf-8"), { type: "string" });
  } else {
    workbook = XLSX.read(buffer, { type: "buffer" });
  }

  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    throw new Error("The file appears to be empty — no sheets found.");
  }

  const sheet = workbook.Sheets[sheetName];
  // raw:false so numbers and dates come through as formatted strings;
  // we parse amounts ourselves to maintain control over sign handling.
  const rows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(sheet, {
    defval: "",
    raw: false,
  });

  if (rows.length === 0) {
    throw new Error(
      "The file has no data rows. Make sure the first row is a header row."
    );
  }

  // Case-insensitive column detection from the first data row
  const firstRowKeys = Object.keys(rows[0]);
  const find = (...names: string[]) =>
    names.reduce<string | null>((found, name) => {
      if (found) return found;
      return firstRowKeys.find((k) => k.trim().toLowerCase() === name) ?? null;
    }, null);

  const typeKey   = find("type");
  const amountKey = find("amount");
  const dateKey   = find("date");
  const descKey   = find("description", "desc", "details", "narration", "particulars", "remarks");

  if (!typeKey || !amountKey) {
    throw new Error(
      `Missing required columns. Expected: Date, Description, Type, Amount. ` +
      `Found: ${firstRowKeys.join(", ") || "(none)"}`
    );
  }

  let totalInflow  = 0;
  let totalOutflow = 0;
  const parsed: TransactionRow[] = [];
  let skipped = 0;

  for (const row of rows) {
    // --- Amount ---
    // Take the absolute value so outflows stored as negative numbers in the
    // source file don't cause double-subtraction when we compute the totals.
    const rawAmount = row[amountKey];
    const parsed_amount = parseFloat(
      String(rawAmount ?? "").replace(/[^0-9.-]/g, "")
    );

    if (isNaN(parsed_amount) || parsed_amount === 0) {
      skipped++;
      continue;
    }

    // Magnitude only — direction comes from the Type column
    const amount = Math.abs(parsed_amount);

    // --- Direction ---
    const typeRaw = String(row[typeKey] ?? "").trim().toLowerCase();
    const isInflow =
      typeRaw === "inflow"  ||
      typeRaw === "credit"  ||
      typeRaw === "cr"      ||
      typeRaw === "deposit" ||
      typeRaw === "in";

    const txType: "Inflow" | "Outflow" = isInflow ? "Inflow" : "Outflow";

    if (txType === "Inflow") {
      totalInflow += amount;
    } else {
      totalOutflow += amount;
    }

    parsed.push({
      date:        dateKey ? String(row[dateKey] ?? "") : "",
      description: descKey ? String(row[descKey] ?? "") : "",
      type:        txType,
      amount,
    });
  }

  if (parsed.length === 0) {
    throw new Error(
      `No valid transactions found. ${skipped} row(s) were skipped due to ` +
      `missing or non-numeric Amount values.`
    );
  }

  // Round to 2 decimal places to avoid floating-point drift
  totalInflow  = Math.round(totalInflow  * 100) / 100;
  totalOutflow = Math.round(totalOutflow * 100) / 100;
  const netCashflow = Math.round((totalInflow - totalOutflow) * 100) / 100;

  return {
    rows:            parsed,
    totalInflow,
    totalOutflow,
    netCashflow,
    transactionCount: parsed.length,
  };
}

// Backward-compat alias used by old callers
export const parseExcelFile = (buffer: Buffer) => parseFile(buffer, "file.xlsx");

/**
 * Business rules — applied AFTER amounts are normalised to positive magnitudes.
 *
 * Priority order:
 *   1. FAIL  — outflows ≥ inflows (net cashflow ≤ 0). Cash position is
 *              negative or break-even regardless of volume.
 *   2. PASS  — inflows > outflows AND ≥ 10 transactions (sufficient data).
 *   3. REVIEW — inflows > outflows but < 10 transactions (borderline data).
 */
export function determineStatus(
  totalInflow:  number,
  totalOutflow: number,
  transactionCount: number
): "PASS" | "REVIEW" | "FAIL" {
  // Primary gate: cash direction
  if (totalOutflow >= totalInflow) return "FAIL";

  // Inflow > outflow — differentiate by data volume
  if (transactionCount >= 10) return "PASS";
  return "REVIEW";
}
