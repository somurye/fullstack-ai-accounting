import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { AppException } from '../../../common/exceptions/app.exception';

// CommonJS環境で確実に動作するpdfjs-dist legacyビルドを使用
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');

/**
 * PDFバイナリバッファからテキストを抽出する。
 * スキャン画像等でテキストが一切抽出できない場合は例外を投げる。
 */
export async function extractTextFromPdfBuffer(buffer: Buffer | Uint8Array): Promise<string> {
  try {
    // pdfjs-distは純粋なUint8Array(非Buffer)を厳格に要求するため、Bufferの場合はメモリをコピーして純粋なUint8Arrayを生成
    let uint8Array: Uint8Array;
    if (Buffer.isBuffer(buffer)) {
      uint8Array = new Uint8Array(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
    } else if (buffer instanceof Uint8Array && buffer.constructor.name !== 'Uint8Array') {
      uint8Array = new Uint8Array(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
    } else {
      uint8Array = buffer;
    }
    const loadingTask = pdfjsLib.getDocument({
      data: uint8Array,
      isEvalSupported: false,
      useSystemFonts: true,
    });
    const pdfDoc = await loadingTask.promise;

    const pageTexts: string[] = [];
    for (let i = 1; i <= pdfDoc.numPages; i++) {
      const page = await pdfDoc.getPage(i);
      const content = await page.getTextContent();
      const pageText = content.items
        .map((item: any) => (typeof item.str === 'string' ? item.str : ''))
        .join(' ')
        .trim();
      if (pageText) {
        pageTexts.push(pageText);
      }
    }

    const fullText = pageTexts.join('\n').trim();

    if (!fullText) {
      throw AppException.badRequest(
        'PDFからテキストを抽出できませんでした。スキャン画像等の場合はテキストデータが含まれるPDFをご利用ください',
      );
    }
    return fullText;
  } catch (err: unknown) {
    if (err instanceof AppException) throw err;
    throw AppException.badRequest(
      `PDFファイルの解析に失敗しました: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * ディスク上のPDFファイルからテキストを抽出する。
 */
export async function extractTextFromPdfFile(filePath: string): Promise<string> {
  if (!filePath || !existsSync(filePath)) {
    throw AppException.notFound(`指定された添付ファイル実体が見つかりません: ${filePath}`);
  }
  const buffer = await readFile(filePath);
  return extractTextFromPdfBuffer(buffer);
}
