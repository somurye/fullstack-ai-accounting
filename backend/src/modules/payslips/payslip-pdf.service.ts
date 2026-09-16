import { Injectable } from '@nestjs/common';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { PayslipDto } from './payslips.mapper';

@Injectable()
export class PayslipPdfService {
  /**
   * PayslipDto から PDF バイナリ (Buffer) を生成する
   */
  async generatePdf(payslip: PayslipDto): Promise<Buffer> {
    const doc = await PDFDocument.create();
    const page = doc.addPage([595.28, 841.89]); // A4 縦
    const { width, height } = page.getSize();

    const regularFont = await doc.embedFont(StandardFonts.Helvetica);
    const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);

    const snapshot = payslip.snapshot_data;

    // 背景色ヘルパー
    const drawRect = (
      x: number,
      y: number,
      w: number,
      h: number,
      color: { r: number; g: number; b: number },
    ) => {
      page.drawRectangle({
        x,
        y,
        width: w,
        height: h,
        color: rgb(color.r, color.g, color.b),
      });
    };

    // 枠線ヘルパー
    const strokeRect = (
      x: number,
      y: number,
      w: number,
      h: number,
      color = { r: 0.8, g: 0.85, b: 0.9 },
      borderWidth = 1,
    ) => {
      page.drawRectangle({
        x,
        y,
        width: w,
        height: h,
        borderColor: rgb(color.r, color.g, color.b),
        borderWidth,
      });
    };

    // 英語/ASCII安全な表示名 (WinAnsiフォントでのエンコードエラー防止)
    const toSafeAscii = (val: string | null | undefined, fallback: string): string => {
      if (!val) return fallback;
      const normalized = val
        .replace(/年/g, '-')
        .replace(/月度?給与?/g, '')
        .replace(/日/g, '')
        .replace(/[^\x20-\x7E]/g, ' ')
        .trim()
        .replace(/\s+/g, ' ');
      return normalized.length > 0 ? normalized : fallback;
    };

    // 1. トップヘッダーバンド (深いネイビー)
    drawRect(0, height - 80, width, 80, { r: 0.1, g: 0.18, b: 0.36 });

    page.drawText('PAYSLIP / SALARY STATEMENT', {
      x: 40,
      y: height - 48,
      size: 20,
      font: boldFont,
      color: rgb(1, 1, 1),
    });

    const safePeriod = toSafeAscii(payslip.payroll_period, 'N/A');
    const safePaymentDate = toSafeAscii(payslip.payment_date, 'N/A');

    page.drawText(`Target Period: ${safePeriod}  |  Payment Date: ${safePaymentDate}`, {
      x: 40,
      y: height - 68,
      size: 11,
      font: regularFont,
      color: rgb(0.85, 0.9, 1),
    });

    const statusText = payslip.status === 'confirmed' ? 'CONFIRMED' : 'DRAFT';
    page.drawText(statusText, {
      x: width - 140,
      y: height - 48,
      size: 14,
      font: boldFont,
      color: payslip.status === 'confirmed' ? rgb(0.3, 0.9, 0.5) : rgb(1, 0.8, 0.2),
    });

    let currentY = height - 110;

    // 2. 従業員情報サマリカード
    drawRect(40, currentY - 55, width - 80, 55, { r: 0.96, g: 0.97, b: 0.99 });
    strokeRect(40, currentY - 55, width - 80, 55);

    const rawEmpName = payslip.employee_name || snapshot?.employee?.name;
    const safeEmpCode = toSafeAscii(payslip.employee_code || snapshot?.employee?.employee_code, '-');
    const safeEmpName = toSafeAscii(
      rawEmpName,
      `Employee (${safeEmpCode !== '-' ? safeEmpCode : payslip.employee_id.slice(0, 8)})`,
    );
    const safeDept = toSafeAscii(payslip.department_name || snapshot?.employee?.department_name, '-');

    page.drawText('Employee Code:', { x: 55, y: currentY - 22, size: 10, font: boldFont, color: rgb(0.3, 0.3, 0.4) });
    page.drawText(safeEmpCode, { x: 145, y: currentY - 22, size: 10, font: regularFont });

    page.drawText('Employee Name:', { x: 55, y: currentY - 42, size: 10, font: boldFont, color: rgb(0.3, 0.3, 0.4) });
    page.drawText(safeEmpName, { x: 145, y: currentY - 42, size: 10, font: regularFont });

    page.drawText('Department:', { x: 320, y: currentY - 22, size: 10, font: boldFont, color: rgb(0.3, 0.3, 0.4) });
    page.drawText(safeDept, { x: 400, y: currentY - 22, size: 10, font: regularFont });

    page.drawText('Statement ID:', { x: 320, y: currentY - 42, size: 10, font: boldFont, color: rgb(0.3, 0.3, 0.4) });
    page.drawText(payslip.id.slice(0, 8), { x: 400, y: currentY - 42, size: 10, font: regularFont });

    currentY -= 75;

    // 3. 勤怠サマリ (Attendance Summary)
    page.drawText('1. Attendance Summary', {
      x: 40,
      y: currentY,
      size: 13,
      font: boldFont,
      color: rgb(0.15, 0.2, 0.35),
    });
    currentY -= 8;

    drawRect(40, currentY - 45, width - 80, 45, { r: 0.98, g: 0.98, b: 1 });
    strokeRect(40, currentY - 45, width - 80, 45);

    const att = snapshot?.attendance ?? { regular_hours: 0, overtime_hours: 0, late_night_hours: 0, holiday_hours: 0 };
    const attColW = (width - 80) / 4;

    const attCols = [
      { label: 'Regular Hours', val: `${att.regular_hours} h` },
      { label: 'Overtime Hours', val: `${att.overtime_hours} h` },
      { label: 'Late Night Hours', val: `${att.late_night_hours} h` },
      { label: 'Holiday Hours', val: `${att.holiday_hours} h` },
    ];

    attCols.forEach((col, idx) => {
      const colX = 40 + idx * attColW;
      page.drawText(col.label, { x: colX + 10, y: currentY - 18, size: 9, font: regularFont, color: rgb(0.4, 0.4, 0.5) });
      page.drawText(col.val, { x: colX + 10, y: currentY - 35, size: 12, font: boldFont, color: rgb(0.1, 0.15, 0.3) });
    });

    currentY -= 65;

    // 4. 2列テーブル: 左に支給項目 (Earnings)、右に控除項目 (Deductions)
    const colWidth = (width - 95) / 2;
    const leftX = 40;
    const rightX = 40 + colWidth + 15;

    // --- 左列: 支給項目 (Earnings) ---
    page.drawText('2. Earnings (Gross Pay)', {
      x: leftX,
      y: currentY,
      size: 13,
      font: boldFont,
      color: rgb(0.15, 0.2, 0.35),
    });

    // --- 右列: 控除項目 (Deductions) ---
    page.drawText('3. Deductions', {
      x: rightX,
      y: currentY,
      size: 13,
      font: boldFont,
      color: rgb(0.15, 0.2, 0.35),
    });

    currentY -= 15;

    const earnings = snapshot?.earnings ?? {
      base_salary: 0,
      regular_pay: 0,
      overtime_pay: 0,
      late_night_pay: 0,
      holiday_pay: 0,
      total_gross_pay: 0,
    };

    const deductions = snapshot?.deductions ?? {
      health_insurance_amount: 0,
      care_insurance_amount: 0,
      pension_amount: 0,
      employment_insurance_amount: 0,
      income_tax_amount: 0,
      resident_tax_amount: 0,
      total_deductions: 0,
    };

    const earningRows = [
      { label: 'Base Salary', amount: earnings.base_salary },
      { label: 'Regular Pay', amount: earnings.regular_pay },
      { label: 'Overtime Pay', amount: earnings.overtime_pay },
      { label: 'Late Night Pay', amount: earnings.late_night_pay },
      { label: 'Holiday Pay', amount: earnings.holiday_pay },
    ];

    const deductionRows = [
      { label: 'Health Insurance', amount: deductions.health_insurance_amount },
      { label: 'Care Insurance', amount: deductions.care_insurance_amount },
      { label: 'Pension (Nenkin)', amount: deductions.pension_amount },
      { label: 'Employment Insurance', amount: deductions.employment_insurance_amount },
      { label: 'Income Tax (Gensen)', amount: deductions.income_tax_amount },
      { label: 'Resident Tax', amount: deductions.resident_tax_amount },
    ];

    const tableStartY = currentY;
    const rowHeight = 22;

    // 支給項目の描画
    earningRows.forEach((item, idx) => {
      const rowY = tableStartY - idx * rowHeight;
      if (idx % 2 === 0) {
        drawRect(leftX, rowY - 16, colWidth, rowHeight, { r: 0.97, g: 0.98, b: 0.99 });
      }
      strokeRect(leftX, rowY - 16, colWidth, rowHeight);
      page.drawText(item.label, { x: leftX + 10, y: rowY - 11, size: 10, font: regularFont });
      const amtStr = `JPY ${Number(item.amount).toLocaleString('en-US')}`;
      page.drawText(amtStr, { x: leftX + colWidth - 85, y: rowY - 11, size: 10, font: regularFont });
    });

    // 控除項目の描画
    deductionRows.forEach((item, idx) => {
      const rowY = tableStartY - idx * rowHeight;
      if (idx % 2 === 0) {
        drawRect(rightX, rowY - 16, colWidth, rowHeight, { r: 0.97, g: 0.98, b: 0.99 });
      }
      strokeRect(rightX, rowY - 16, colWidth, rowHeight);
      page.drawText(item.label, { x: rightX + 10, y: rowY - 11, size: 10, font: regularFont });
      const amtStr = `JPY ${Number(item.amount).toLocaleString('en-US')}`;
      page.drawText(amtStr, { x: rightX + colWidth - 85, y: rowY - 11, size: 10, font: regularFont });
    });

    const maxRows = Math.max(earningRows.length, deductionRows.length);
    const subtotalY = tableStartY - maxRows * rowHeight;

    // 支給合計
    drawRect(leftX, subtotalY - 20, colWidth, 24, { r: 0.9, g: 0.94, b: 1 });
    strokeRect(leftX, subtotalY - 20, colWidth, 24, { r: 0.5, g: 0.65, b: 0.9 });
    page.drawText('Total Gross Pay:', { x: leftX + 10, y: subtotalY - 14, size: 10, font: boldFont });
    page.drawText(`JPY ${Number(earnings.total_gross_pay).toLocaleString('en-US')}`, {
      x: leftX + colWidth - 95,
      y: subtotalY - 14,
      size: 11,
      font: boldFont,
      color: rgb(0.1, 0.2, 0.5),
    });

    // 控除合計
    drawRect(rightX, subtotalY - 20, colWidth, 24, { r: 1, g: 0.92, b: 0.92 });
    strokeRect(rightX, subtotalY - 20, colWidth, 24, { r: 0.9, g: 0.5, b: 0.5 });
    page.drawText('Total Deductions:', { x: rightX + 10, y: subtotalY - 14, size: 10, font: boldFont });
    page.drawText(`JPY ${Number(deductions.total_deductions).toLocaleString('en-US')}`, {
      x: rightX + colWidth - 95,
      y: subtotalY - 14,
      size: 11,
      font: boldFont,
      color: rgb(0.6, 0.1, 0.1),
    });

    currentY = subtotalY - 60;

    // 5. 差引手取額 (Net Take-home Pay) 強調バナー
    drawRect(40, currentY - 50, width - 80, 50, { r: 0.12, g: 0.35, b: 0.25 });

    page.drawText('NET TAKE-HOME PAY (Sashihiki Teate):', {
      x: 60,
      y: currentY - 32,
      size: 13,
      font: boldFont,
      color: rgb(0.9, 1, 0.9),
    });

    const netPayStr = `JPY ${Number(payslip.snapshot_data?.net_pay ?? 0).toLocaleString('en-US')}`;
    page.drawText(netPayStr, {
      x: width - 230,
      y: currentY - 34,
      size: 20,
      font: boldFont,
      color: rgb(1, 1, 1),
    });

    // 6. フッター
    page.drawText('keiri-kaikei SaaS - Official Payroll Document | Generated by System', {
      x: 40,
      y: 35,
      size: 8,
      font: regularFont,
      color: rgb(0.5, 0.5, 0.6),
    });

    page.drawText(`Page 1 of 1 | Issued: ${payslip.issued_at ?? new Date().toISOString()}`, {
      x: width - 260,
      y: 35,
      size: 8,
      font: regularFont,
      color: rgb(0.5, 0.5, 0.6),
    });

    const pdfBytes = await doc.save();
    return Buffer.from(pdfBytes);
  }
}
