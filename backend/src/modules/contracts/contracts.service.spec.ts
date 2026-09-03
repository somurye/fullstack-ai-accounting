import { AppException } from '../../common/exceptions/app.exception';
import type { DatabaseService } from '../../database/database.service';
import type { AuditLogsService } from '../audit-logs/audit-logs.service';
import { ContractsService } from './contracts.service';

describe('ContractsService', () => {
  let service: ContractsService;
  let mockDb: { transaction: jest.Mock };
  let mockAuditLogs: { record: jest.Mock };
  let mockAiSuggestions: { generateContractSuggestion: jest.Mock };
  let mockClient: { query: jest.Mock };

  const TENANT_ID = '11111111-1111-1111-1111-111111111111';
  const USER_ID = '22222222-2222-2222-2222-222222222222';
  const CONTRACT_ID = '33333333-3333-3333-3333-333333333333';
  const ATTACHMENT_ID = '44444444-4444-4444-4444-444444444444';

  const sampleContractRow = {
    id: CONTRACT_ID,
    contract_no: 'CNT-2026-0001',
    title: '業務委託基本契約書',
    counterparty_name: '株式会社テストパートナー',
    contract_type: 'outsourcing',
    contract_amount: '1200000.00',
    currency: 'JPY',
    start_date: '2026-04-01',
    end_date: '2027-03-31',
    auto_renewal: true,
    renewal_notice_days: 30,
    status: 'draft',
    attachment_id: ATTACHMENT_ID,
    description: 'システム開発保守業務',
    approved_at: null,
    created_by: USER_ID,
    created_at: new Date('2026-04-01T10:00:00Z'),
    updated_at: new Date('2026-04-01T10:00:00Z'),
  };

  beforeEach(() => {
    mockClient = {
      query: jest.fn(),
    };
    mockDb = {
      transaction: jest.fn().mockImplementation((_tenantId, _userId, callback) => callback(mockClient)),
    };
    mockAuditLogs = {
      record: jest.fn().mockResolvedValue(undefined),
    };
    mockAiSuggestions = {
      generateContractSuggestion: jest.fn(),
    };

    service = new ContractsService(
      mockDb as unknown as DatabaseService,
      mockAuditLogs as unknown as AuditLogsService,
      mockAiSuggestions as any,
    );
  });

  describe('list', () => {
    it('契約書一覧を取得できる (ページネーション・フィルタ適用)', async () => {
      mockClient.query
        .mockResolvedValueOnce({ rows: [{ count: '1' }] }) // count
        .mockResolvedValueOnce({ rows: [sampleContractRow] }); // select

      const result = await service.list(TENANT_ID, USER_ID, {
        status: 'draft',
        contract_type: 'outsourcing',
        page: 1,
        page_size: 50,
      });

      expect(result.contracts).toHaveLength(1);
      expect(result.contracts[0].id).toBe(CONTRACT_ID);
      expect(result.contracts[0].contract_no).toBe('CNT-2026-0001');
      expect(result.contracts[0].contract_amount).toBe(1200000);
      expect(result.pagination.total_count).toBe(1);
    });
  });

  describe('getById', () => {
    it('契約書詳細（添付ファイルメタデータ・承認履歴含む）を取得できる', async () => {
      mockClient.query
        .mockResolvedValueOnce({ rowCount: 1, rows: [sampleContractRow] }) // select contract
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [
            {
              id: ATTACHMENT_ID,
              file_name: 'outsourcing_contract.pdf',
              mime_type: 'application/pdf',
              document_category: 'contract',
            },
          ],
        }) // select attachment
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'hist-1',
              step_number: 1,
              approver_id: USER_ID,
              action: 'approve',
              comment: '承認します',
              acted_at: new Date('2026-04-01T12:00:00Z'),
            },
          ],
        }); // select approval_history

      const result = await service.getById(TENANT_ID, USER_ID, CONTRACT_ID);

      expect(result.id).toBe(CONTRACT_ID);
      expect(result.attachment).not.toBeNull();
      expect(result.attachment?.file_name).toBe('outsourcing_contract.pdf');
      expect(result.approval_history).toHaveLength(1);
      expect(result.approval_history[0].action).toBe('approve');
    });

    it('存在しない契約書IDの場合はnotFound例外を投げる', async () => {
      mockClient.query.mockResolvedValueOnce({ rowCount: 0, rows: [] });

      await expect(service.getById(TENANT_ID, USER_ID, 'non-existent')).rejects.toThrow(
        AppException,
      );
    });
  });

  describe('create', () => {
    it('新規ドラフト契約書を正常に作成できる (自動採番・監査ログ記録)', async () => {
      mockClient.query
        .mockResolvedValueOnce({ rowCount: 1 }) // attachment check
        .mockResolvedValueOnce({ rows: [] }) // advisory lock
        .mockResolvedValueOnce({ rows: [{ count: '0' }] }) // count for contract_no
        .mockResolvedValueOnce({ rows: [sampleContractRow] }); // insert returning

      const result = await service.create(TENANT_ID, USER_ID, {
        title: '業務委託基本契約書',
        counterparty_name: '株式会社テストパートナー',
        contract_type: 'outsourcing',
        contract_amount: 1200000,
        currency: 'JPY',
        start_date: '2026-04-01',
        end_date: '2027-03-31',
        auto_renewal: true,
        renewal_notice_days: 30,
        attachment_id: ATTACHMENT_ID,
        description: 'システム開発保守業務',
      });

      expect(result.id).toBe(CONTRACT_ID);
      expect(result.status).toBe('draft');
      expect(mockAuditLogs.record).toHaveBeenCalledWith(
        mockClient,
        TENANT_ID,
        expect.objectContaining({
          action: 'contract.created',
          targetType: 'contract',
          targetId: CONTRACT_ID,
        }),
      );
    });
  });

  describe('update', () => {
    it('draft状態の契約書を正常に更新できる', async () => {
      mockClient.query
        .mockResolvedValueOnce({ rowCount: 1, rows: [sampleContractRow] }) // existing
        .mockResolvedValueOnce({
          rows: [{ ...sampleContractRow, title: '更新後のタイトル' }],
        }); // update returning

      const result = await service.update(TENANT_ID, USER_ID, CONTRACT_ID, {
        title: '更新後のタイトル',
      });

      expect(result.title).toBe('更新後のタイトル');
      expect(mockAuditLogs.record).toHaveBeenCalledWith(
        mockClient,
        TENANT_ID,
        expect.objectContaining({
          action: 'contract.updated',
          targetId: CONTRACT_ID,
        }),
      );
    });

    it('active状態の契約書を更新しようとするとconflict例外を投げる', async () => {
      mockClient.query.mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ ...sampleContractRow, status: 'active' }],
      });

      await expect(
        service.update(TENANT_ID, USER_ID, CONTRACT_ID, { title: '改ざん' }),
      ).rejects.toThrow(AppException);
    });
  });

  describe('delete', () => {
    it('draft状態の契約書を正常に削除できる', async () => {
      mockClient.query
        .mockResolvedValueOnce({ rowCount: 1, rows: [sampleContractRow] }) // existing
        .mockResolvedValueOnce({ rowCount: 1 }); // delete

      await service.delete(TENANT_ID, USER_ID, CONTRACT_ID);

      expect(mockAuditLogs.record).toHaveBeenCalledWith(
        mockClient,
        TENANT_ID,
        expect.objectContaining({
          action: 'contract.deleted',
          targetId: CONTRACT_ID,
        }),
      );
    });

    it('active状態の契約書を削除しようとするとconflict例外を投げる', async () => {
      mockClient.query.mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ ...sampleContractRow, status: 'active' }],
      });

      await expect(service.delete(TENANT_ID, USER_ID, CONTRACT_ID)).rejects.toThrow(
        AppException,
      );
    });
  });

  describe('submitForApproval (1人テナント vs 多段階承認)', () => {
    it('承認ルール未設定の場合: エラーを返し、自動的にactiveへ遷移しない (SoD偶発的無効化防止)', async () => {
      mockClient.query
        .mockResolvedValueOnce({ rowCount: 1, rows: [sampleContractRow] }) // existing draft
        .mockResolvedValueOnce({ rowCount: 0, rows: [] }); // rules check (0件 = 未設定)

      await expect(service.submitForApproval(TENANT_ID, USER_ID, CONTRACT_ID)).rejects.toThrow(
        AppException,
      );
      expect(mockAuditLogs.record).not.toHaveBeenCalled();
    });

    it('明示的自動承認ルール(is_explicit_auto_approve=true)の場合: 即座にactive(自動承認)となりcontract.auto_approvedが記録される', async () => {
      mockClient.query
        .mockResolvedValueOnce({ rowCount: 1, rows: [sampleContractRow] }) // existing draft
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [{ step_number: 0, is_explicit_auto_approve: true }],
        }) // rules check (明示的自動承認)
        .mockResolvedValueOnce({
          rows: [
            {
              ...sampleContractRow,
              status: 'active',
              approved_at: new Date('2026-04-01T12:00:00Z'),
            },
          ],
        }); // update returning active

      const result = await service.submitForApproval(TENANT_ID, USER_ID, CONTRACT_ID);

      expect(result.status).toBe('active');
      expect(result.approved_at).not.toBeNull();
      expect(mockAuditLogs.record).toHaveBeenCalledWith(
        mockClient,
        TENANT_ID,
        expect.objectContaining({
          action: 'contract.auto_approved',
          targetId: CONTRACT_ID,
          afterData: { status: 'active', auto_approved: true },
        }),
      );
    });

    it('承認ルール設定済(多段階)の場合: pending_approvalに遷移しapproval_requestsが起票される', async () => {
      mockClient.query
        .mockResolvedValueOnce({ rowCount: 1, rows: [sampleContractRow] }) // existing draft
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [{ step_number: 1, is_explicit_auto_approve: false }],
        }) // rules check (1 step)
        .mockResolvedValueOnce({
          rows: [{ ...sampleContractRow, status: 'pending_approval' }],
        }) // update returning pending
        .mockResolvedValueOnce({ rowCount: 1 }); // insert approval_requests

      const result = await service.submitForApproval(TENANT_ID, USER_ID, CONTRACT_ID);

      expect(result.status).toBe('pending_approval');
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO approval_requests'),
        expect.arrayContaining([TENANT_ID, CONTRACT_ID, USER_ID, 1]),
      );
      expect(mockAuditLogs.record).toHaveBeenCalledWith(
        mockClient,
        TENANT_ID,
        expect.objectContaining({
          action: 'contract.submitted_for_approval',
          targetId: CONTRACT_ID,
          afterData: { status: 'pending_approval', total_steps: 1 },
        }),
      );
    });

    it('既にactive状態の契約書を申請しようとするとconflict例外を投げる', async () => {
      mockClient.query.mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ ...sampleContractRow, status: 'active' }],
      });

      await expect(service.submitForApproval(TENANT_ID, USER_ID, CONTRACT_ID)).rejects.toThrow(
        AppException,
      );
    });
  });

  describe('extractTerms (P1-T2: 契約書アップロード〜AI条項抽出)', () => {
    it('契約書添付ファイルから条項を抽出し、ai_suggestionsの提案を返す (contractsテーブルへは直接書き込まない)', async () => {
      mockClient.query.mockResolvedValueOnce({
        rowCount: 1,
        rows: [
          {
            id: ATTACHMENT_ID,
            tenant_id: TENANT_ID,
            file_name: 'nda.pdf',
            document_category: 'contract',
          },
        ],
      }); // attachment select

      const mockSuggestion = {
        id: 'sug-extract-001',
        target_type: 'contract',
        target_id: ATTACHMENT_ID,
        suggestion_type: 'contract_terms',
        payload: {
          document_type: 'contract',
          suggested_fields: {
            contract_title: { value: '秘密保持契約書', confidence: 0.95 },
          },
        },
        confidence_score: 0.95,
        model_name: 'contract-extractor-v1',
      };
      mockAiSuggestions.generateContractSuggestion.mockResolvedValueOnce(mockSuggestion);

      const result = await service.extractTerms(TENANT_ID, USER_ID, {
        attachment_id: ATTACHMENT_ID,
      });

      expect(result.id).toBe('sug-extract-001');
      expect(result.model_name).toBe('contract-extractor-v1');
      expect(mockAiSuggestions.generateContractSuggestion).toHaveBeenCalledWith(
        mockClient,
        TENANT_ID,
        ATTACHMENT_ID,
        expect.any(String),
        'contract-extractor-v1',
      );
      expect(mockAuditLogs.record).toHaveBeenCalledWith(
        mockClient,
        TENANT_ID,
        expect.objectContaining({
          action: 'contract.terms_extracted',
          targetType: 'attachment',
          targetId: ATTACHMENT_ID,
        }),
      );
    });

    it('存在しない添付ファイルを指定した場合はnotFound例外を投げる', async () => {
      mockClient.query.mockResolvedValueOnce({ rowCount: 0, rows: [] });

      await expect(
        service.extractTerms(TENANT_ID, USER_ID, { attachment_id: ATTACHMENT_ID }),
      ).rejects.toThrow(AppException);
    });

    it('契約書以外の添付ファイル(例: receipt)を指定した場合はbadRequest例外を投げる', async () => {
      mockClient.query.mockResolvedValueOnce({
        rowCount: 1,
        rows: [
          {
            id: ATTACHMENT_ID,
            tenant_id: TENANT_ID,
            file_name: 'receipt.jpg',
            document_category: 'receipt',
          },
        ],
      });

      await expect(
        service.extractTerms(TENANT_ID, USER_ID, { attachment_id: ATTACHMENT_ID }),
      ).rejects.toThrow(AppException);
    });
  });
});
