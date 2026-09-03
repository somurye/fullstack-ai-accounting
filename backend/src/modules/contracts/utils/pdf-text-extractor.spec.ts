import { PDFDocument, StandardFonts } from 'pdf-lib';
import { AppException } from '../../../common/exceptions/app.exception';
import { extractTextFromPdfBuffer } from './pdf-text-extractor';

describe('pdf-text-extractor', () => {
  it('有効なテキストを含むPDFバッファからテキストを正常に抽出できる', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([600, 400]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    page.drawText('Contract Agreement\nParties: Alpha Corp and Beta Inc\nPeriod: 2026-05-01 to 2027-04-30\nAmount: JPY 800000', {
      x: 50,
      y: 350,
      size: 12,
      font,
    });
    const pdfBytes = await doc.save();

    const text = await extractTextFromPdfBuffer(Buffer.from(pdfBytes));
    expect(text).toContain('Contract Agreement');
    expect(text).toContain('Alpha Corp and Beta Inc');
    expect(text).toContain('2026-05-01 to 2027-04-30');
    expect(text).toContain('JPY 800000');
  });

  it('異なる内容のPDFからそれぞれ異なるテキストが正しく抽出される (PDF内容依存性の証明)', async () => {
    // PDF 1
    const doc1 = await PDFDocument.create();
    const page1 = doc1.addPage([600, 400]);
    const font1 = await doc1.embedFont(StandardFonts.Helvetica);
    page1.drawText('Document One\nAmount: JPY 100000', { x: 50, y: 350, size: 12, font: font1 });
    const bytes1 = await doc1.save();
    const text1 = await extractTextFromPdfBuffer(Buffer.from(bytes1));

    // PDF 2
    const doc2 = await PDFDocument.create();
    const page2 = doc2.addPage([600, 400]);
    const font2 = await doc2.embedFont(StandardFonts.Helvetica);
    page2.drawText('Document Two\nAmount: JPY 999999', { x: 50, y: 350, size: 12, font: font2 });
    const bytes2 = await doc2.save();
    const text2 = await extractTextFromPdfBuffer(Buffer.from(bytes2));

    expect(text1).toContain('Document One');
    expect(text1).toContain('100000');
    expect(text1).not.toContain('Document Two');

    expect(text2).toContain('Document Two');
    expect(text2).toContain('999999');
    expect(text2).not.toContain('Document One');
  });

  it('テキストが一切含まれない空白PDFの場合はbadRequest例外を投げる (ダミー文章へのフォールバック阻止)', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([600, 400]); // 描画なしの白紙ページ
    const pdfBytes = await doc.save();

    await expect(extractTextFromPdfBuffer(Buffer.from(pdfBytes))).rejects.toThrow(
      AppException,
    );
  });

  it('破損したバイナリを渡した場合はbadRequest例外を投げる', async () => {
    const corruptedBuffer = Buffer.from('NOT_A_VALID_PDF_BINARY_DATA');

    await expect(extractTextFromPdfBuffer(corruptedBuffer)).rejects.toThrow(
      AppException,
    );
  });
});
