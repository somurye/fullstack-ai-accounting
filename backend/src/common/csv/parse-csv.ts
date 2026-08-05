/**
 * parse-csv.ts
 * ============
 * 依存パッケージを追加せず、最小限のCSVパーサをNode標準機能のみで実装する
 * (ダブルクォート囲み・エスケープ(`""`)・改行入りフィールドに対応)。
 *
 * `bank-transactions.service.ts` の銀行明細CSV取込(`POST /bank-transactions/import-csv`)
 * 専用。ヘッダー行を1行目として扱い、`Record<ヘッダー名, 値>[]` を返す。
 */
export function parseCsv(text: string): Record<string, string>[] {
  const rows = parseCsvRows(text.replace(/^﻿/, ''));
  if (rows.length === 0) return [];

  const header = rows[0].map((h) => h.trim());
  return rows.slice(1).filter((row) => row.some((cell) => cell.trim() !== '')).map((row) => {
    const record: Record<string, string> = {};
    header.forEach((key, index) => {
      record[key] = (row[index] ?? '').trim();
    });
    return record;
  });
}

function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\r') {
      // 次の \n とあわせて改行として扱う(単独の \r もCRのみ改行として吸収する)。
      continue;
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}
