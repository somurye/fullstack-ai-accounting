import { Injectable } from '@nestjs/common';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import type { QuotationDetailDto } from './quotations.mapper';

@Injectable()
export class QuotationPdfService {
  /**
   * QuotationDetailDto から 見積書 PDF バイナリ (Buffer) を生成する
   */
  async generatePdf(quotation: QuotationDetailDto): Promise<Buffer> {
    const doc = await PDFDocument.create();
    const page = doc.addPage([595.28, 841.89]); // A4 縦
    const { width, height } = page.getSize();

    const regularFont = await doc.embedFont(StandardFonts.Helvetica);
    const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);

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
        .replace(/月/g, '-')
        .replace(/日/g, '')
        .replace(/[^\x20-\x7E]/g, ' ')
        .trim()
        .replace(/\s+/g, ' ');
      return normalized.length > 0 ? normalized : fallback;
    };

    const formatCurrency = (val: number): string => {
      const code = quotation.currency_code || 'JPY';
      return `${code} ${Number(val).toLocaleString('en-US')}`;
    };

    // 1. トップヘッダーバンド (深いインディゴ・ネイビー)
    drawRect(0, height - 90, width, 90, { r: 0.08, g: 0.16, b: 0.32 });

    page.drawText('QUOTATION / ESTIMATE', {
      x: 40,
      y: height - 48,
      size: 22,
      font: boldFont,
      color: rgb(1, 1, 1),
    });

    const safeQuoteNo = toSafeAscii(quotation.quote_no, 'QT-UNKNOWN');
    const safeIssueDate = toSafeAscii(quotation.issue_date, 'N/A');
    const safeValidUntil = toSafeAscii(quotation.valid_until, 'N/A');

    page.drawText(`Quote No: ${safeQuoteNo} (v${quotation.version})  |  Date: ${safeIssueDate}  |  Valid: ${safeValidUntil}`, {
      x: 40,
      y: height - 72,
      size: 10,
      font: regularFont,
      color: rgb(0.85, 0.9, 1),
    });

    const statusUpper = (quotation.status || 'draft').toUpperCase();
    let statusColor = rgb(0.8, 0.8, 0.8);
    if (quotation.status === 'sent') statusColor = rgb(0.3, 0.7, 1);
    else if (quotation.status === 'accepted') statusColor = rgb(0.2, 0.85, 0.4);
    else if (quotation.status === 'rejected') statusColor = rgb(0.95, 0.35, 0.35);

    page.drawText(statusUpper, {
      x: width - 140,
      y: height - 50,
      size: 15,
      font: boldFont,
      color: statusColor,
    });

    let currentY = height - 120;

    // 2. 顧客情報 & 発行者情報セクション
    // 顧客側
    drawRect(40, currentY - 70, 240, 70, { r: 0.96, g: 0.98, b: 1 });
    strokeRect(40, currentY - 70, 240, 70, { r: 0.85, g: 0.9, b: 0.95 });

    const safeCustomer = toSafeAscii(quotation.customer_name, 'Customer');
    const safeCustomerCode = toSafeAscii(quotation.customer_code, '');

    page.drawText('Customer:', {
      x: 52,
      y: currentY - 20,
      size: 9,
      font: boldFont,
      color: rgb(0.4, 0.5, 0.6),
    });
    page.drawText(`${safeCustomer} ${safeCustomerCode ? `[${safeCustomerCode}]` : ''}`, {
      x: 52,
      y: currentY - 38,
      size: 13,
      font: boldFont,
      color: rgb(0.1, 0.15, 0.25),
    });
    page.drawText('Dear Sir/Madam', {
      x: 52,
      y: currentY - 55,
      size: 9,
      font: regularFont,
      color: rgb(0.3, 0.35, 0.45),
    });

    // 発行者側
    drawRect(315, currentY - 70, 240, 70, { r: 0.98, g: 0.98, b: 0.99 });
    strokeRect(315, currentY - 70, 240, 70, { r: 0.88, g: 0.9, b: 0.92 });

    const safeCreator = toSafeAscii(quotation.creator_name, 'Sales Representative');
    page.drawText('Issued By:', {
      x: 327,
      y: currentY - 20,
      size: 9,
      font: boldFont,
      color: rgb(0.4, 0.5, 0.6),
    });
    page.drawText('AI Backoffice Accounting System', {
      x: 327,
      y: currentY - 38,
      size: 11,
      font: boldFont,
      color: rgb(0.15, 0.2, 0.3),
    });
    page.drawText(`Rep: ${safeCreator}`, {
      x: 327,
      y: currentY - 55,
      size: 9,
      font: regularFont,
      color: rgb(0.35, 0.4, 0.45),
    });

    currentY -= 95;

    // 3. 件名 & 合計見積金額ハイライトボックス
    drawRect(40, currentY - 50, width - 80, 50, { r: 0.92, g: 0.95, b: 1 });
    strokeRect(40, currentY - 50, width - 80, 50, { r: 0.75, g: 0.85, b: 0.95 });

    const safeTitle = toSafeAscii(quotation.title, 'Quotation Title');
    page.drawText(`Subject: ${safeTitle}`, {
      x: 55,
      y: currentY - 23,
      size: 12,
      font: boldFont,
      color: rgb(0.1, 0.2, 0.4),
    });

    const totalText = `Total: ${formatCurrency(quotation.total_amount)}`;
    page.drawText(totalText, {
      x: 55,
      y: currentY - 42,
      size: 14,
      font: boldFont,
      color: rgb(0.08, 0.35, 0.75),
    });

    currentY -= 75;

    // 4. 明細テーブルヘッダー
    const colX = {
      no: 45,
      item: 80,
      qty: 290,
      unit: 340,
      price: 390,
      rate: 460,
      amount: 505,
    };

    drawRect(40, currentY - 22, width - 80, 22, { r: 0.15, g: 0.25, b: 0.45 });

    page.drawText('#', { x: colX.no, y: currentY - 15, size: 9, font: boldFont, color: rgb(1, 1, 1) });
    page.drawText('Item Description', { x: colX.item, y: currentY - 15, size: 9, font: boldFont, color: rgb(1, 1, 1) });
    page.drawText('Qty', { x: colX.qty, y: currentY - 15, size: 9, font: boldFont, color: rgb(1, 1, 1) });
    page.drawText('Unit', { x: colX.unit, y: currentY - 15, size: 9, font: boldFont, color: rgb(1, 1, 1) });
    page.drawText('Unit Price', { x: colX.price, y: currentY - 15, size: 9, font: boldFont, color: rgb(1, 1, 1) });
    page.drawText('Tax', { x: colX.rate, y: currentY - 15, size: 9, font: boldFont, color: rgb(1, 1, 1) });
    page.drawText('Amount', { x: colX.amount, y: currentY - 15, size: 9, font: boldFont, color: rgb(1, 1, 1) });

    currentY -= 22;

    // 5. 明細行描画
    const lines = quotation.lines || [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const isEven = i % 2 === 0;
      const rowHeight = 22;

      if (isEven) {
        drawRect(40, currentY - rowHeight, width - 80, rowHeight, { r: 0.97, g: 0.98, b: 0.99 });
      }
      strokeRect(40, currentY - rowHeight, width - 80, rowHeight, { r: 0.9, g: 0.92, b: 0.95 });

      const safeItem = toSafeAscii(line.item_name, `Item ${line.line_no}`);
      const safeUnit = toSafeAscii(line.unit, 'ea');
      const taxRateText = `${Math.round(line.tax_rate * 100)}%`;

      page.drawText(String(line.line_no), { x: colX.no, y: currentY - 15, size: 8, font: regularFont, color: rgb(0.2, 0.2, 0.2) });
      page.drawText(safeItem.slice(0, 32), { x: colX.item, y: currentY - 15, size: 8, font: regularFont, color: rgb(0.1, 0.1, 0.1) });
      page.drawText(String(line.quantity), { x: colX.qty, y: currentY - 15, size: 8, font: regularFont, color: rgb(0.2, 0.2, 0.2) });
      page.drawText(safeUnit, { x: colX.unit, y: currentY - 15, size: 8, font: regularFont, color: rgb(0.2, 0.2, 0.2) });
      page.drawText(formatCurrency(line.unit_price), { x: colX.price, y: currentY - 15, size: 8, font: regularFont, color: rgb(0.2, 0.2, 0.2) });
      page.drawText(taxRateText, { x: colX.rate, y: currentY - 15, size: 8, font: regularFont, color: rgb(0.3, 0.3, 0.3) });
      page.drawText(formatCurrency(line.amount), { x: colX.amount, y: currentY - 15, size: 8, font: boldFont, color: rgb(0.1, 0.15, 0.25) });

      currentY -= rowHeight;
      if (currentY < 180) break; // 簡易オーバーフロー防止
    }

    currentY -= 20;

    // 6. 金額合計サマリー (右寄せブロック)
    const summaryWidth = 200;
    const summaryX = width - 40 - summaryWidth;

    drawRect(summaryX, currentY - 70, summaryWidth, 70, { r: 0.95, g: 0.97, b: 0.99 });
    strokeRect(summaryX, currentY - 70, summaryWidth, 70, { r: 0.8, g: 0.85, b: 0.9 });

    page.drawText('Subtotal (excl. tax):', { x: summaryX + 15, y: currentY - 20, size: 9, font: regularFont, color: rgb(0.3, 0.3, 0.3) });
    page.drawText(formatCurrency(quotation.subtotal), { x: summaryX + 110, y: currentY - 20, size: 9, font: boldFont, color: rgb(0.1, 0.1, 0.1) });

    page.drawText('Tax:', { x: summaryX + 15, y: currentY - 38, size: 9, font: regularFont, color: rgb(0.3, 0.3, 0.3) });
    page.drawText(formatCurrency(quotation.tax_amount), { x: summaryX + 110, y: currentY - 38, size: 9, font: boldFont, color: rgb(0.1, 0.1, 0.1) });

    drawRect(summaryX + 10, currentY - 45, summaryWidth - 20, 1, { r: 0.75, g: 0.8, b: 0.85 });

    page.drawText('Total (incl. tax):', { x: summaryX + 15, y: currentY - 60, size: 10, font: boldFont, color: rgb(0.08, 0.2, 0.4) });
    page.drawText(formatCurrency(quotation.total_amount), { x: summaryX + 105, y: currentY - 60, size: 11, font: boldFont, color: rgb(0.08, 0.35, 0.75) });

    // 7. 備考欄 (Notes)
    if (quotation.notes) {
      const safeNotes = toSafeAscii(quotation.notes, '');
      if (safeNotes) {
        drawRect(40, currentY - 70, summaryX - 60, 70, { r: 0.99, g: 0.99, b: 0.99 });
        strokeRect(40, currentY - 70, summaryX - 60, 70, { r: 0.88, g: 0.9, b: 0.92 });
        page.drawText('Notes:', { x: 50, y: currentY - 20, size: 9, font: boldFont, color: rgb(0.4, 0.45, 0.5) });
        page.drawText(safeNotes.slice(0, 120), { x: 50, y: currentY - 38, size: 8, font: regularFont, color: rgb(0.2, 0.25, 0.3) });
      }
    }

    // 8. フッター
    page.drawText('Generated by Fullstack AI Accounting - Sales Operations Module', {
      x: 40,
      y: 35,
      size: 8,
      font: regularFont,
      color: rgb(0.5, 0.55, 0.6),
    });

    const pdfBytes = await doc.save();
    return Buffer.from(pdfBytes);
  }
}
