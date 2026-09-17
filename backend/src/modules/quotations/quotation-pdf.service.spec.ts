import { QuotationPdfService } from './quotation-pdf.service';
import type { QuotationDetailDto } from './quotations.mapper';

describe('QuotationPdfService', () => {
  let service: QuotationPdfService;

  beforeEach(() => {
    service = new QuotationPdfService();
  });

  it('日本語文字（顧客名・商品名・備考）を含む見積書PDFを正常に生成できること', async () => {
    const sampleQuotation: QuotationDetailDto = {
      id: '11111111-1111-1111-1111-111111111111',
      tenant_id: '22222222-2222-2222-2222-222222222222',
      customer_id: '33333333-3333-3333-3333-333333333333',
      customer_code: 'CUST-001',
      customer_name: 'テスト商事株式会社',
      deal_id: null,
      quote_no: 'QT-2026-0001',
      title: '業務基盤クラウド移行および導入支援',
      status: 'sent',
      valid_until: '2026-10-31',
      issue_date: '2026-09-17',
      subtotal: 1200000,
      tax_amount: 120000,
      total_amount: 1320000,
      currency_code: 'JPY',
      version: 1,
      superseded_by: null,
      superseded_by_quote_no: null,
      notes: '納品後30日以内にお支払いください。分割支払いは応相談。',
      converted_invoice_id: null,
      converted_invoice_no: null,
      converted_at: null,
      converted_by: null,
      created_by: '44444444-4444-4444-4444-444444444444',
      creator_name: '営業 太郎',
      created_at: '2026-09-17T00:00:00.000Z',
      updated_at: '2026-09-17T00:00:00.000Z',
      lines: [
        {
          id: '55555555-5555-5555-5555-555555555551',
          quotation_id: '11111111-1111-1111-1111-111111111111',
          line_no: 1,
          item_name: 'クラウドインフラ設計・構築費',
          description: 'AWS/GCP 環境設計およびセキュリティ設定一式',
          quantity: 1,
          unit: '式',
          unit_price: 800000,
          amount: 800000,
          tax_rate: 0.1,
          tax_category_id: null,
          tax_category_name: null,
          created_at: '2026-09-17T00:00:00.000Z',
          updated_at: '2026-09-17T00:00:00.000Z',
        },
        {
          id: '55555555-5555-5555-5555-555555555552',
          quotation_id: '11111111-1111-1111-1111-111111111111',
          line_no: 2,
          item_name: '管理者向けトレーニング・マニュアル作成',
          description: '運用マニュアル納品および講習会2回',
          quantity: 2,
          unit: '回',
          unit_price: 200000,
          amount: 400000,
          tax_rate: 0.1,
          tax_category_id: null,
          tax_category_name: null,
          created_at: '2026-09-17T00:00:00.000Z',
          updated_at: '2026-09-17T00:00:00.000Z',
        },
      ],
    };

    const pdfBuffer = await service.generatePdf(sampleQuotation);

    expect(pdfBuffer).toBeInstanceOf(Buffer);
    expect(pdfBuffer.length).toBeGreaterThan(1000);
    // PDFヘッダーシグネチャ (%PDF-) の確認
    expect(pdfBuffer.subarray(0, 4).toString()).toBe('%PDF');
  });
});
