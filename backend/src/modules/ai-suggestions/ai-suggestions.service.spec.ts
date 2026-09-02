import { AiSuggestionsService } from './ai-suggestions.service';
import type { DatabaseService } from '../../database/database.service';
import type { AiSuggestionRow } from './ai-suggestions.mapper';

describe('AiSuggestionsService (Phase 0 P0-T3)', () => {
  let service: AiSuggestionsService;
  let mockDb: { transaction: jest.Mock };
  let mockClient: { query: jest.Mock };

  const tenantId = '00000000-0000-0000-0000-000000000001';
  const userId = '00000000-0000-0000-0000-000000000010';

  beforeEach(() => {
    mockClient = {
      query: jest.fn(),
    };
    mockDb = {
      transaction: jest.fn().mockImplementation((_tId, _uId, cb) => cb(mockClient)),
    };
    service = new AiSuggestionsService(mockDb as unknown as DatabaseService);
  });

  describe('extractContractTerms', () => {
    it('契約書テキストから契約書名、当事者、期間、金額、自動更新、裁判所、解約予告が構造化抽出される', () => {
      const sampleContractText = `
        業務委託契約書
        甲： 株式会社テストコーポレーション
        乙： 株式会社パートナーソリューションズ
        契約期間： 2026年10月1日から2027年09月30日までとする。
        委託料： 月額 550,000 円（税込）を支払うものとする。
        期間満了の30日前までに甲または乙から申し出がないときは、同一条件で1年間自動的に更新される。
        本契約に関する紛争については、東京地方裁判所を第一審の専属的合意管轄裁判所とする。
      `;

      const { suggested_fields, confidenceScore } = service.extractContractTerms(sampleContractText);

      expect(suggested_fields.contract_title).toBeDefined();
      expect(suggested_fields.contract_title?.value).toBe('業務委託契約書');
      expect(suggested_fields.contract_title?.confidence).toBeGreaterThanOrEqual(0.9);

      expect(suggested_fields.contract_parties).toBeDefined();
      expect(suggested_fields.contract_parties?.value).toContain('甲: 株式会社テストコーポレーション');
      expect(suggested_fields.contract_parties?.value).toContain('乙: 株式会社パートナーソリューションズ');

      expect(suggested_fields.contract_start_date?.value).toBe('2026-10-01');
      expect(suggested_fields.contract_end_date?.value).toBe('2027-09-30');

      expect(suggested_fields.contract_amount?.value).toBe(550000);

      expect(suggested_fields.auto_renewal?.value).toBe(true);

      expect(suggested_fields.governing_law_jurisdiction?.value).toContain('東京地方裁判所');

      expect(suggested_fields.notice_period_days?.value).toBe(30);

      expect(confidenceScore).toBeGreaterThan(0.7);
    });
  });

  describe('generateContractSuggestion', () => {
    it('契約書テキストから条項を抽出し ai_suggestions に隔離保存する (確定テーブルへは書き込まない)', async () => {
      const targetId = '11111111-1111-1111-1111-111111111111';
      const sampleText = '秘密保持契約書 甲： 株式会社A 乙： 株式会社B 2026-04-01から2027-03-31';

      const mockRow: AiSuggestionRow = {
        id: 'sug-contract-001',
        tenant_id: tenantId,
        target_type: 'contract',
        target_id: targetId,
        suggestion_type: 'contract_terms',
        payload: {
          document_type: 'contract',
          suggested_fields: {
            contract_title: { value: '秘密保持契約書', confidence: 0.95, rationale: '表題より抽出' },
          },
        },
        confidence_score: '0.90',
        model_name: 'claude-3-5-sonnet-20241022',
        accepted: null,
        created_at: new Date('2026-09-02T10:00:00Z'),
      };
      mockClient.query.mockResolvedValueOnce({ rows: [mockRow] });

      const result = await service.generateContractSuggestion(
        mockClient as any,
        tenantId,
        targetId,
        sampleText,
      );

      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO ai_suggestions'),
        expect.arrayContaining([tenantId, targetId, expect.stringContaining('"document_type":"contract"')]),
      );
      expect(result.id).toBe('sug-contract-001');
      expect(result.target_type).toBe('contract');
      expect(result.suggestion_type).toBe('contract_terms');
      expect(result.payload?.document_type).toBe('contract');
      expect(result.payload?.suggested_fields?.contract_title?.value).toBe('秘密保持契約書');
    });
  });

  describe('generateGenericSuggestion', () => {
    it('任意の文書種別と構造化フィールドを汎用形式で保存できる', async () => {
      const targetId = '22222222-2222-2222-2222-222222222222';
      const mockRow: AiSuggestionRow = {
        id: 'sug-generic-001',
        tenant_id: tenantId,
        target_type: 'purchase_request',
        target_id: targetId,
        suggestion_type: 'generic_fields',
        payload: {
          document_type: 'purchase_order',
          suggested_fields: {
            item_name: { value: '開発用MacBook Pro', confidence: 0.92, rationale: '品名欄から抽出' },
            estimated_price: { value: 380000, confidence: 0.88 },
          },
        },
        confidence_score: '0.90',
        model_name: 'claude-3-5-sonnet-20241022',
        accepted: null,
        created_at: new Date('2026-09-02T10:00:00Z'),
      };
      mockClient.query.mockResolvedValueOnce({ rows: [mockRow] });

      const result = await service.generateGenericSuggestion(
        mockClient as any,
        tenantId,
        'purchase_request',
        targetId,
        'generic_fields',
        'purchase_order',
        {
          item_name: { value: '開発用MacBook Pro', confidence: 0.92, rationale: '品名欄から抽出' },
          estimated_price: { value: 380000, confidence: 0.88 },
        },
        0.9,
        'claude-3-5-sonnet-20241022',
      );

      expect(result.target_type).toBe('purchase_request');
      expect(result.suggestion_type).toBe('generic_fields');
      expect(result.payload?.document_type).toBe('purchase_order');
      expect(result.payload?.suggested_fields?.item_name?.value).toBe('開発用MacBook Pro');
    });
  });

  describe('generateOcrSuggestion (後方互換性)', () => {
    it('既存のレシートOCR提案がデグレなく動作する', async () => {
      const expenseReportId = '33333333-3333-3333-3333-333333333333';
      const mockRow: AiSuggestionRow = {
        id: 'sug-ocr-001',
        tenant_id: tenantId,
        target_type: 'expense_report',
        target_id: expenseReportId,
        suggestion_type: 'ocr',
        payload: {
          transaction_date: '2026-09-01',
          amount: 1500,
          vendor_name: 'カフェ テスト',
          invoice_registration_number: 'T1234567890123',
        },
        confidence_score: '0.95',
        model_name: 'gemini-1.5-pro',
        accepted: null,
        created_at: new Date('2026-09-02T10:00:00Z'),
      };
      mockClient.query.mockResolvedValueOnce({ rows: [mockRow] });

      const result = await service.generateOcrSuggestion(
        mockClient as any,
        tenantId,
        expenseReportId,
        {
          transaction_date: '2026-09-01',
          amount: 1500,
          vendor_name: 'カフェ テスト',
          invoice_registration_number: 'T1234567890123',
        },
        0.95,
        'gemini-1.5-pro',
      );

      expect(result.suggestion_type).toBe('ocr');
      expect(result.payload?.vendor_name).toBe('カフェ テスト');
      expect(result.payload?.amount).toBe(1500);
    });
  });

  describe('list / findById', () => {
    it('target_type=contract で一覧絞り込みができる', async () => {
      mockClient.query
        .mockResolvedValueOnce({ rows: [{ count: '1' }] }) // COUNT
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'sug-c1',
              tenant_id: tenantId,
              target_type: 'contract',
              target_id: '11111111-1111-1111-1111-111111111111',
              suggestion_type: 'contract_terms',
              payload: { document_type: 'contract' },
              confidence_score: '0.9',
              model_name: 'claude-3-5-sonnet',
              accepted: null,
              created_at: new Date('2026-09-02T10:00:00Z'),
            },
          ],
        }); // SELECT

      const result = await service.list(tenantId, userId, {
        page: 1,
        page_size: 10,
        target_type: 'contract',
      });

      expect(result.suggestions).toHaveLength(1);
      expect(result.suggestions[0].target_type).toBe('contract');
      expect(result.pagination.total_count).toBe(1);
    });
  });
});
