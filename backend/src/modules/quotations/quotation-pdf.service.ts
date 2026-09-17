import { Injectable, Logger } from '@nestjs/common';
import { PDFDocument, rgb, PDFFont, StandardFonts } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import * as fs from 'fs';
import * as path from 'path';
import type { QuotationDetailDto } from './quotations.mapper';

// 日本語フォントバイト列のインメモリキャッシュ
let cachedJapaneseFontBytes: Buffer | null = null;

@Injectable()
export class QuotationPdfService {
  private readonly logger = new Logger(QuotationPdfService.name);

  /**
   * 利用可能な日本語フォント (TrueType/OpenType) を探索・ロードする
   */
  private getJapaneseFontBytes(): Buffer | null {
    if (cachedJapaneseFontBytes) {
      return cachedJapaneseFontBytes;
    }

    const candidatePaths = [
      // 1. プロジェクトバンドルフォント (ipaexg.ttf)
      path.resolve(__dirname, '../../assets/fonts/ipaexg.ttf'),
      path.resolve(process.cwd(), 'src/assets/fonts/ipaexg.ttf'),
      path.resolve(process.cwd(), 'backend/src/assets/fonts/ipaexg.ttf'),
      path.resolve(process.cwd(), 'dist/src/assets/fonts/ipaexg.ttf'),
      path.resolve(process.cwd(), 'assets/fonts/ipaexg.ttf'),
      // 2. Windows システムフォント
      'C:\\Windows\\Fonts\\yumin.ttf',
      // 3. Linux / Docker システムフォント
      '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
      '/usr/share/fonts/truetype/fonts-japanese-gothic.ttf',
      '/usr/share/fonts/ipaexg.ttf',
    ];

    for (const p of candidatePaths) {
      try {
        if (fs.existsSync(p)) {
          const bytes = fs.readFileSync(p);
          if (bytes.length > 0) {
            cachedJapaneseFontBytes = bytes;
            this.logger.log(`Loaded Japanese font from: ${p} (${(bytes.length / 1024 / 1024).toFixed(2)} MB)`);
            return bytes;
          }
        }
      } catch {
        // 次の候補へ
      }
    }

    this.logger.warn('Japanese font file not found in candidate paths; falling back to StandardFonts.Helvetica');
    return null;
  }

  /**
   * QuotationDetailDto から 見積書 PDF バイナリ (Buffer) を生成する
   */
  async generatePdf(quotation: QuotationDetailDto): Promise<Buffer> {
    const doc = await PDFDocument.create();
    doc.registerFontkit(fontkit);

    const page = doc.addPage([595.28, 841.89]); // A4 縦 (ポイント単位: 595.28 x 841.89)
    const { width, height } = page.getSize();

    // 日本語フォントの読み込み
    const fontBytes = this.getJapaneseFontBytes();
    let regularFont: PDFFont;
    let boldFont: PDFFont;
    let isJapaneseFont = false;

    if (fontBytes) {
      try {
        const embedded = await doc.embedFont(fontBytes);
        regularFont = embedded;
        boldFont = embedded; // 日本語フォントは単一ウェイトの場合レギュラーを兼用
        isJapaneseFont = true;
      } catch (err) {
        this.logger.warn(`Failed to embed Japanese font, falling back to Helvetica: ${err}`);
        regularFont = await doc.embedFont(StandardFonts.Helvetica);
        boldFont = await doc.embedFont(StandardFonts.HelveticaBold);
      }
    } else {
      regularFont = await doc.embedFont(StandardFonts.Helvetica);
      boldFont = await doc.embedFont(StandardFonts.HelveticaBold);
    }

    // 背景色描画ヘルパー
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

    // 枠線描画ヘルパー
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

    // 安全な文字列描画ヘルパー (欧文フォールバック時の文字化け・例外防止)
    const safeText = (text: string | null | undefined, fallback = ''): string => {
      if (!text) return fallback;
      if (isJapaneseFont) {
        // 日本語フォントの場合は全文字をそのまま表示可能
        return text;
      }
      // 欧文フォールバック時はASCII文字のみにサニタイズ
      return text
        .replace(/年/g, '-')
        .replace(/月/g, '-')
        .replace(/日/g, '')
        .replace(/[^\x20-\x7E]/g, ' ')
        .trim()
        .replace(/\s+/g, ' ') || fallback;
    };

    const formatCurrency = (val: number): string => {
      const code = quotation.currency_code || 'JPY';
      const formatted = Number(val).toLocaleString('ja-JP');
      return code === 'JPY' ? `¥${formatted}` : `${code} ${formatted}`;
    };

    // 1. トップヘッダーバンド (深いインディゴ・ネイビー)
    drawRect(0, height - 90, width, 90, { r: 0.08, g: 0.16, b: 0.32 });

    const titleText = isJapaneseFont ? '御 見 積 書' : 'QUOTATION / ESTIMATE';
    page.drawText(titleText, {
      x: 40,
      y: height - 48,
      size: 20,
      font: boldFont,
      color: rgb(1, 1, 1),
    });

    const quoteNoText = isJapaneseFont
      ? `見積番号: ${quotation.quote_no} (第${quotation.version}版)   発行日: ${quotation.issue_date || '—'}   有効期限: ${quotation.valid_until || '—'}`
      : `Quote No: ${safeText(quotation.quote_no)} (v${quotation.version})  |  Date: ${safeText(quotation.issue_date)}  |  Valid: ${safeText(quotation.valid_until)}`;

    page.drawText(quoteNoText, {
      x: 40,
      y: height - 72,
      size: 9.5,
      font: regularFont,
      color: rgb(0.85, 0.9, 1),
    });

    // ステータスバッジ
    let statusLabel = (quotation.status || 'draft').toUpperCase();
    let statusColor = rgb(0.8, 0.8, 0.8);
    if (quotation.status === 'sent') {
      statusLabel = isJapaneseFont ? '提示済み' : 'SENT';
      statusColor = rgb(0.3, 0.7, 1);
    } else if (quotation.status === 'accepted') {
      statusLabel = isJapaneseFont ? '受注確定' : 'ACCEPTED';
      statusColor = rgb(0.2, 0.85, 0.4);
    } else if (quotation.status === 'rejected') {
      statusLabel = isJapaneseFont ? '失注/却下' : 'REJECTED';
      statusColor = rgb(0.95, 0.35, 0.35);
    } else if (quotation.status === 'draft') {
      statusLabel = isJapaneseFont ? '下書き' : 'DRAFT';
    }

    const badgeWidth = isJapaneseFont ? 70 : 80;
    drawRect(width - 40 - badgeWidth, height - 60, badgeWidth, 22, { r: 0.15, g: 0.25, b: 0.45 });
    page.drawText(statusLabel, {
      x: width - 40 - badgeWidth + 10,
      y: height - 45,
      size: 10,
      font: boldFont,
      color: statusColor,
    });

    // 2. 宛名 & 発行元エリア
    const customerName = quotation.customer_name || 'お得意様';
    const customerText = isJapaneseFont ? `${customerName}  御中` : `${safeText(customerName)} Dear Sir/Madam`;

    page.drawText(customerText, {
      x: 40,
      y: height - 125,
      size: 14,
      font: boldFont,
      color: rgb(0.1, 0.15, 0.2),
    });

    // 下線
    page.drawLine({
      start: { x: 40, y: height - 132 },
      end: { x: 300, y: height - 132 },
      thickness: 1.5,
      color: rgb(0.1, 0.15, 0.2),
    });

    const leadText = isJapaneseFont
      ? '下記の通り、御見積申し上げます。'
      : 'We are pleased to submit the following quotation for your consideration.';
    page.drawText(leadText, {
      x: 40,
      y: height - 148,
      size: 9,
      font: regularFont,
      color: rgb(0.35, 0.4, 0.45),
    });

    // 件名 (Title)
    const subjectLabel = isJapaneseFont ? '件名:' : 'Subject:';
    page.drawText(`${subjectLabel} ${safeText(quotation.title)}`, {
      x: 40,
      y: height - 165,
      size: 11,
      font: boldFont,
      color: rgb(0.08, 0.2, 0.4),
    });

    // 発行元情報ボックス (右側)
    const issuerBoxX = 330;
    const issuerBoxY = height - 185;
    const issuerBoxW = width - 40 - issuerBoxX;
    drawRect(issuerBoxX, issuerBoxY, issuerBoxW, 75, { r: 0.97, g: 0.98, b: 1 });
    strokeRect(issuerBoxX, issuerBoxY, issuerBoxW, 75, { r: 0.85, g: 0.9, b: 0.95 });

    const issuerTitle = isJapaneseFont ? '【発 行 元】' : '[ISSUER]';
    page.drawText(issuerTitle, {
      x: issuerBoxX + 12,
      y: issuerBoxY + 58,
      size: 9,
      font: boldFont,
      color: rgb(0.2, 0.25, 0.35),
    });
    page.drawText('keiri-kaikei SaaS Platform', {
      x: issuerBoxX + 12,
      y: issuerBoxY + 42,
      size: 10,
      font: boldFont,
      color: rgb(0.1, 0.15, 0.25),
    });
    const issuerNote = isJapaneseFont ? '全社バックオフィス統合基盤' : 'Integrated Back-Office SaaS';
    page.drawText(issuerNote, {
      x: issuerBoxX + 12,
      y: issuerBoxY + 26,
      size: 8,
      font: regularFont,
      color: rgb(0.4, 0.45, 0.5),
    });

    // 3. 御見積金額強調サマリーカード
    const sumCardY = height - 235;
    drawRect(40, sumCardY, width - 80, 40, { r: 0.93, g: 0.96, b: 1 });
    strokeRect(40, sumCardY, width - 80, 40, { r: 0.6, g: 0.75, b: 0.95 }, 1.5);

    const sumLabel = isJapaneseFont ? '御 見 積 金 額 (税込)' : 'TOTAL ESTIMATE (INCL. TAX)';
    page.drawText(sumLabel, {
      x: 55,
      y: sumCardY + 14,
      size: 11,
      font: boldFont,
      color: rgb(0.1, 0.2, 0.4),
    });

    const sumAmountStr = formatCurrency(quotation.total_amount);
    page.drawText(sumAmountStr, {
      x: 230,
      y: sumCardY + 11,
      size: 16,
      font: boldFont,
      color: rgb(0.05, 0.25, 0.65),
    });

    // 4. 明細テーブルヘッダー
    let currentY = sumCardY - 20;
    const tableHeaderHeight = 24;
    drawRect(40, currentY - tableHeaderHeight, width - 80, tableHeaderHeight, {
      r: 0.12,
      g: 0.22,
      b: 0.38,
    });

    const colX = {
      no: 45,
      item: 70,
      qty: 290,
      unit: 340,
      price: 380,
      rate: 450,
      amount: 495,
    };

    const headerLabels = isJapaneseFont
      ? { no: '#', item: '品名・項目', qty: '数量', unit: '単位', price: '単価', rate: '税率', amount: '金額' }
      : { no: '#', item: 'Item Description', qty: 'Qty', unit: 'Unit', price: 'Unit Price', rate: 'Tax', amount: 'Amount' };

    page.drawText(headerLabels.no, { x: colX.no, y: currentY - 16, size: 8.5, font: boldFont, color: rgb(1, 1, 1) });
    page.drawText(headerLabels.item, { x: colX.item, y: currentY - 16, size: 8.5, font: boldFont, color: rgb(1, 1, 1) });
    page.drawText(headerLabels.qty, { x: colX.qty, y: currentY - 16, size: 8.5, font: boldFont, color: rgb(1, 1, 1) });
    page.drawText(headerLabels.unit, { x: colX.unit, y: currentY - 16, size: 8.5, font: boldFont, color: rgb(1, 1, 1) });
    page.drawText(headerLabels.price, { x: colX.price, y: currentY - 16, size: 8.5, font: boldFont, color: rgb(1, 1, 1) });
    page.drawText(headerLabels.rate, { x: colX.rate, y: currentY - 16, size: 8.5, font: boldFont, color: rgb(1, 1, 1) });
    page.drawText(headerLabels.amount, { x: colX.amount, y: currentY - 16, size: 8.5, font: boldFont, color: rgb(1, 1, 1) });

    currentY -= tableHeaderHeight;

    // 5. 明細行描画
    const lineHeight = 22;
    const lines = quotation.lines || [];

    lines.forEach((line, idx) => {
      const isEven = idx % 2 === 0;
      const rowBg = isEven ? { r: 1, g: 1, b: 1 } : { r: 0.97, g: 0.98, b: 0.99 };
      drawRect(40, currentY - lineHeight, width - 80, lineHeight, rowBg);
      strokeRect(40, currentY - lineHeight, width - 80, lineHeight, { r: 0.88, g: 0.9, b: 0.92 }, 0.5);

      const safeItem = safeText(line.item_name);
      const safeUnit = safeText(line.unit || '式');
      const taxRatePercent = Math.round((line.tax_rate ?? 0.1) * 100);
      const taxRateText = `${taxRatePercent}%`;

      page.drawText(String(line.line_no), { x: colX.no, y: currentY - 15, size: 8, font: regularFont, color: rgb(0.2, 0.2, 0.2) });
      page.drawText(safeItem.slice(0, 24), { x: colX.item, y: currentY - 15, size: 8, font: regularFont, color: rgb(0.1, 0.1, 0.1) });
      page.drawText(String(line.quantity), { x: colX.qty, y: currentY - 15, size: 8, font: regularFont, color: rgb(0.2, 0.2, 0.2) });
      page.drawText(safeUnit, { x: colX.unit, y: currentY - 15, size: 8, font: regularFont, color: rgb(0.2, 0.2, 0.2) });
      page.drawText(formatCurrency(line.unit_price), { x: colX.price, y: currentY - 15, size: 8, font: regularFont, color: rgb(0.2, 0.2, 0.2) });
      page.drawText(taxRateText, { x: colX.rate, y: currentY - 15, size: 8, font: regularFont, color: rgb(0.3, 0.3, 0.3) });
      page.drawText(formatCurrency(line.amount), { x: colX.amount, y: currentY - 15, size: 8, font: boldFont, color: rgb(0.1, 0.15, 0.25) });

      currentY -= lineHeight;
    });

    // 6. 内訳サマリーボックス (小計、消費税額、合計金額)
    currentY -= 15;
    const summaryW = 240;
    const summaryX = width - 40 - summaryW;
    drawRect(summaryX, currentY - 65, summaryW, 65, { r: 0.98, g: 0.99, b: 1 });
    strokeRect(summaryX, currentY - 65, summaryW, 65, { r: 0.8, g: 0.85, b: 0.9 });

    const subtotalLabel = isJapaneseFont ? '小計 (税抜):' : 'Subtotal (excl. tax):';
    const taxLabel = isJapaneseFont ? '消費税額:' : 'Tax:';
    const totalLabel = isJapaneseFont ? '合計金額 (税込):' : 'Total (incl. tax):';

    page.drawText(subtotalLabel, { x: summaryX + 15, y: currentY - 18, size: 8.5, font: regularFont, color: rgb(0.3, 0.3, 0.3) });
    page.drawText(formatCurrency(quotation.subtotal), { x: summaryX + 120, y: currentY - 18, size: 8.5, font: boldFont, color: rgb(0.1, 0.1, 0.1) });

    page.drawText(taxLabel, { x: summaryX + 15, y: currentY - 34, size: 8.5, font: regularFont, color: rgb(0.3, 0.3, 0.3) });
    page.drawText(formatCurrency(quotation.tax_amount), { x: summaryX + 120, y: currentY - 34, size: 8.5, font: boldFont, color: rgb(0.1, 0.1, 0.1) });

    page.drawLine({
      start: { x: summaryX + 15, y: currentY - 42 },
      end: { x: summaryX + summaryW - 15, y: currentY - 42 },
      thickness: 1,
      color: rgb(0.8, 0.85, 0.9),
    });

    page.drawText(totalLabel, { x: summaryX + 15, y: currentY - 56, size: 9.5, font: boldFont, color: rgb(0.08, 0.2, 0.4) });
    page.drawText(formatCurrency(quotation.total_amount), { x: summaryX + 115, y: currentY - 56, size: 10.5, font: boldFont, color: rgb(0.08, 0.35, 0.75) });

    // 7. 備考欄 (Notes)
    if (quotation.notes) {
      const notesLabel = isJapaneseFont ? '【備考】' : 'Notes:';
      page.drawText(notesLabel, { x: 45, y: currentY - 18, size: 8.5, font: boldFont, color: rgb(0.4, 0.45, 0.5) });
      const safeNotes = safeText(quotation.notes);
      page.drawText(safeNotes.slice(0, 100), { x: 45, y: currentY - 34, size: 8, font: regularFont, color: rgb(0.2, 0.25, 0.3) });
    }

    // 8. フッター
    const footerText = isJapaneseFont
      ? '※ 本見積書の有効期限を過ぎた場合は、再見積となります。ご不明な点がございましたら担当までお問い合わせください。'
      : 'This quotation is generated by keiri-kaikei SaaS Platform. For inquiries, please contact our sales team.';
    page.drawText(footerText, {
      x: 40,
      y: 35,
      size: 7.5,
      font: regularFont,
      color: rgb(0.5, 0.55, 0.6),
    });

    const pdfBytes = await doc.save();
    return Buffer.from(pdfBytes);
  }
}
