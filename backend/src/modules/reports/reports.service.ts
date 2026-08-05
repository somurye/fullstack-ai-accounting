import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { DatabaseService } from '../../database/database.service';
import { AppException } from '../../common/exceptions/app.exception';
import type { components } from '../../types/api.generated';
import type { BsQuery, CashFlowQuery, PlQuery, TrialBalanceQuery } from './dto/report.schemas';

export type TrialBalanceLineDto = components['schemas']['TrialBalanceLine'];
export type FinancialStatementLineDto = components['schemas']['FinancialStatementLine'];

export interface FinancialStatementResult {
  periodLabel: string;
  lines: FinancialStatementLineDto[];
}

export interface CashFlowStatementResult {
  periodLabel: string;
  beginningCashBalance: number;
  operatingActivities: FinancialStatementLineDto[];
  operatingActivitiesTotal: number;
  investingActivities: FinancialStatementLineDto[];
  investingActivitiesTotal: number;
  financingActivities: FinancialStatementLineDto[];
  financingActivitiesTotal: number;
  netChangeInCash: number;
  endingCashBalance: number;
}

/**
 * キャッシュ・フロー計算書(CF)の勘定科目コード規約(MVP実装)。他モジュール(invoices/
 * fixed-assets/expense-reports)と同様、テナントごとの区分設定を保持する場所がスキーマに
 * 存在しないため固定code規約とする。
 */
const CASH_EQUIVALENT_CODES = ['1000', '1100']; // 現金・普通預金(bank_accounts.linked_account_idと合算)
const ACCUMULATED_DEPRECIATION_CODE = '1600'; // 減価償却累計額(固定資産のコントラ科目。fixed-assets.service.tsと同一規約)
const DISPOSAL_GAIN_CODE = '9000'; // 固定資産売却益
const DISPOSAL_LOSS_CODE = '9100'; // 固定資産除却損/売却損

type CashFlowSection = 'operating' | 'financing' | 'investing';

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

@Injectable()
export class ReportsService {
  constructor(private readonly db: DatabaseService) {}

  /**
   * 合計残高試算表。確定済み仕訳(`status='posted'`)のみを対象に、期首残高(期間開始日より前の
   * 累計)・当期借方合計・当期貸方合計・期末残高を勘定科目ごとに算出する。
   * `fiscal_period_id`が指定された場合はその期間の`start_date`/`end_date`を、
   * 未指定の場合は`date_from`/`date_to`(いずれか必須)を集計範囲として使用する。
   */
  async trialBalance(
    tenantId: string,
    userId: string | null,
    query: TrialBalanceQuery,
  ): Promise<TrialBalanceLineDto[]> {
    return this.db.transaction(tenantId, userId, async (client) => {
      const { startDate, endDate } = await this.resolveTrialBalancePeriod(client, tenantId, query);

      const result = await client.query<{
        account_id: string;
        account_code: string;
        account_name: string;
        normal_balance: 'debit' | 'credit';
        opening_debit: string;
        opening_credit: string;
        debit_total: string;
        credit_total: string;
      }>(
        `SELECT
           a.id AS account_id, a.code AS account_code, a.name AS account_name, a.normal_balance,
           COALESCE(SUM(jel.amount) FILTER (WHERE jel.debit_credit = 'debit' AND je.entry_date < $2), 0) AS opening_debit,
           COALESCE(SUM(jel.amount) FILTER (WHERE jel.debit_credit = 'credit' AND je.entry_date < $2), 0) AS opening_credit,
           COALESCE(SUM(jel.amount) FILTER (WHERE jel.debit_credit = 'debit' AND je.entry_date BETWEEN $2 AND $3), 0) AS debit_total,
           COALESCE(SUM(jel.amount) FILTER (WHERE jel.debit_credit = 'credit' AND je.entry_date BETWEEN $2 AND $3), 0) AS credit_total
         FROM accounts a
         LEFT JOIN journal_entry_lines jel ON jel.account_id = a.id AND jel.tenant_id = a.tenant_id
         LEFT JOIN journal_entries je
           ON je.id = jel.journal_entry_id AND je.tenant_id = jel.tenant_id AND je.status = 'posted'
         WHERE a.tenant_id = $1 AND a.is_active = TRUE
         GROUP BY a.id, a.code, a.name, a.normal_balance
         ORDER BY a.code ASC`,
        [tenantId, startDate, endDate],
      );

      return result.rows.map((row) => {
        const openingDebit = Number(row.opening_debit);
        const openingCredit = Number(row.opening_credit);
        const debitTotal = Number(row.debit_total);
        const creditTotal = Number(row.credit_total);
        const isDebitNormal = row.normal_balance === 'debit';
        const openingBalance = isDebitNormal ? openingDebit - openingCredit : openingCredit - openingDebit;
        const closingBalance = isDebitNormal
          ? openingBalance + debitTotal - creditTotal
          : openingBalance + creditTotal - debitTotal;
        return {
          account_id: row.account_id,
          account_code: row.account_code,
          account_name: row.account_name,
          opening_balance: round2(openingBalance),
          debit_total: round2(debitTotal),
          credit_total: round2(creditTotal),
          closing_balance: round2(closingBalance),
        };
      });
    });
  }

  /**
   * 損益計算書(PL)。収益・費用科目を対象に指定期間内の確定済み仕訳を集計し、
   * 科目ごとの金額に加え、売上高合計・費用合計・当期純利益の段階損益サマリー行を付加する。
   */
  async profitAndLoss(
    tenantId: string,
    userId: string | null,
    query: PlQuery,
  ): Promise<FinancialStatementResult> {
    return this.db.transaction(tenantId, userId, async (client) => {
      const { startDate, endDate, periodLabel } = await this.resolvePlPeriod(client, tenantId, query);

      const result = await client.query<{
        account_code: string;
        account_name: string;
        account_type: 'revenue' | 'expense';
        section: string | null;
        debit_total: string;
        credit_total: string;
      }>(
        `SELECT
           a.code AS account_code, a.name AS account_name, a.account_type, ac.name AS section,
           COALESCE(SUM(jel.amount) FILTER (WHERE jel.debit_credit = 'debit'), 0) AS debit_total,
           COALESCE(SUM(jel.amount) FILTER (WHERE jel.debit_credit = 'credit'), 0) AS credit_total
         FROM accounts a
         LEFT JOIN account_categories ac ON ac.id = a.category_id
         JOIN journal_entry_lines jel ON jel.account_id = a.id AND jel.tenant_id = a.tenant_id
         JOIN journal_entries je
           ON je.id = jel.journal_entry_id AND je.tenant_id = jel.tenant_id AND je.status = 'posted'
              AND je.entry_date BETWEEN $2 AND $3
         WHERE a.tenant_id = $1 AND a.account_type IN ('revenue', 'expense')
         GROUP BY a.code, a.name, a.account_type, ac.name
         ORDER BY a.account_type, a.code ASC`,
        [tenantId, startDate, endDate],
      );

      const lines: FinancialStatementLineDto[] = [];
      let totalRevenue = 0;
      let totalExpense = 0;
      for (const row of result.rows) {
        const debitTotal = Number(row.debit_total);
        const creditTotal = Number(row.credit_total);
        const isRevenue = row.account_type === 'revenue';
        const amount = round2(isRevenue ? creditTotal - debitTotal : debitTotal - creditTotal);
        if (amount === 0) continue;
        if (isRevenue) totalRevenue += amount;
        else totalExpense += amount;
        lines.push({
          account_code: row.account_code,
          account_name: row.account_name,
          amount,
          section: row.section ?? (isRevenue ? '売上高' : '販管費等'),
        });
      }

      lines.push({ account_code: '', account_name: '売上高合計', amount: round2(totalRevenue), section: '集計' });
      lines.push({ account_code: '', account_name: '費用合計', amount: round2(totalExpense), section: '集計' });
      lines.push({
        account_code: '',
        account_name: '当期純利益',
        amount: round2(totalRevenue - totalExpense),
        section: '集計',
      });

      return { periodLabel, lines };
    });
  }

  /**
   * 貸借対照表(BS)。資産・負債・純資産科目を対象に`as_of_date`時点までの累計残高を集計する。
   *
   * この システムには会計期間締め切り時に当期純利益を繰越利益剰余金へ振り替える
   * 「決算振替仕訳」の自動化機構が存在しないため、収益・費用科目の残高がそのまま
   * 貸借対照表の外に取り残されてしまう。会計恒等式(資産 = 負債 + 純資産 + (収益-費用))から、
   * 「当期純利益(未処分)」を純資産区分に含めることで、資産合計 = 負債合計 + 純資産合計の
   * 貸借一致を成立させる(決算整理前のBS表示として一般的な扱い)。
   */
  async balanceSheet(tenantId: string, userId: string | null, query: BsQuery): Promise<FinancialStatementResult> {
    return this.db.transaction(tenantId, userId, async (client) => {
      const asOfDate = query.as_of_date;

      const balanceResult = await client.query<{
        account_code: string;
        account_name: string;
        account_type: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
        normal_balance: 'debit' | 'credit';
        section: string | null;
        debit_total: string;
        credit_total: string;
      }>(
        `SELECT
           a.code AS account_code, a.name AS account_name, a.account_type, a.normal_balance, ac.name AS section,
           COALESCE(SUM(jel.amount) FILTER (WHERE jel.debit_credit = 'debit'), 0) AS debit_total,
           COALESCE(SUM(jel.amount) FILTER (WHERE jel.debit_credit = 'credit'), 0) AS credit_total
         FROM accounts a
         LEFT JOIN account_categories ac ON ac.id = a.category_id
         JOIN journal_entry_lines jel ON jel.account_id = a.id AND jel.tenant_id = a.tenant_id
         JOIN journal_entries je
           ON je.id = jel.journal_entry_id AND je.tenant_id = jel.tenant_id AND je.status = 'posted'
              AND je.entry_date <= $2
         WHERE a.tenant_id = $1
         GROUP BY a.code, a.name, a.account_type, a.normal_balance, ac.name
         ORDER BY a.account_type, a.code ASC`,
        [tenantId, asOfDate],
      );

      const lines: FinancialStatementLineDto[] = [];
      let totalAssets = 0;
      let totalLiabilities = 0;
      let totalEquity = 0;
      let netIncomeToDate = 0;

      for (const row of balanceResult.rows) {
        const debitTotal = Number(row.debit_total);
        const creditTotal = Number(row.credit_total);
        // 符号は科目ごとの`normal_balance`ではなく、区分(account_type)の標準符号で統一する。
        // 減価償却累計額のような貸方性資産(コントラ資産: account_type='asset'だが
        // normal_balance='credit')が存在するため、`normal_balance`基準で符号決定すると
        // 資産合計への加算方向が逆転し、資産 = 負債 + 純資産の恒等式が崩れる。
        const isAssetOrExpenseSection = row.account_type === 'asset' || row.account_type === 'expense';
        const balance = round2(
          isAssetOrExpenseSection ? debitTotal - creditTotal : creditTotal - debitTotal,
        );

        if (row.account_type === 'revenue') {
          netIncomeToDate += creditTotal - debitTotal;
          continue;
        }
        if (row.account_type === 'expense') {
          netIncomeToDate -= debitTotal - creditTotal;
          continue;
        }
        if (balance === 0) continue;

        if (row.account_type === 'asset') totalAssets += balance;
        else if (row.account_type === 'liability') totalLiabilities += balance;
        else totalEquity += balance;

        lines.push({
          account_code: row.account_code,
          account_name: row.account_name,
          amount: balance,
          section:
            row.section ??
            (row.account_type === 'asset' ? '資産' : row.account_type === 'liability' ? '負債' : '純資産'),
        });
      }

      netIncomeToDate = round2(netIncomeToDate);
      if (netIncomeToDate !== 0) {
        lines.push({
          account_code: '',
          account_name: '当期純利益(未処分)',
          amount: netIncomeToDate,
          section: '純資産',
        });
        totalEquity += netIncomeToDate;
      }

      lines.push({ account_code: '', account_name: '資産合計', amount: round2(totalAssets), section: '集計' });
      lines.push({ account_code: '', account_name: '負債合計', amount: round2(totalLiabilities), section: '集計' });
      lines.push({ account_code: '', account_name: '純資産合計', amount: round2(totalEquity), section: '集計' });

      return { periodLabel: `${asOfDate} 時点`, lines };
    });
  }

  /**
   * キャッシュ・フロー計算書(CF)。直接法: 現金及び現金同等物勘定に影響を与える確定済み
   * 仕訳行(status='posted')を、同一仕訳内の相手科目(現金以外の行)の区分に応じて
   * 「営業活動」「投資活動」「財務活動」の3区分に按分集計する。
   *
   * 相手科目の区分:
   *   - 投資活動: `fixed_assets.asset_account_id`(取得原価科目) ∪ 固定コード規約
   *     (減価償却累計額/固定資産売却益/固定資産除却損)
   *   - 財務活動: account_type = 'equity' の科目(資本金・配当金等。本スキーマの標準
   *     チャート・オブ・アカウントには現状存在しないため、通常は0円になる)
   *   - 営業活動: 上記いずれにも該当しない相手科目(売掛金・買掛金・給与関連預り金等)
   *
   * 同一仕訳内に複数の非現金行がある場合(固定資産売却など)は、各行の金額比率で
   * 現金の純増減額を按分する。現金同士の振替(相手科目も現金勘定)は非現金行の
   * 合計金額(按分の分母)が0になるため自動的に除外される。
   *
   * 期首残高・期末残高は現金及び現金同等物勘定の実残高から直接計算するため、
   * 「期首残高 + 3区分合計 = 期末残高」が必ず成立し、BSの現金・預金残高とも整合する。
   */
  async cashFlow(
    tenantId: string,
    userId: string | null,
    query: CashFlowQuery,
  ): Promise<CashFlowStatementResult> {
    return this.db.transaction(tenantId, userId, async (client) => {
      const { startDate, endDate, periodLabel } = await this.resolveCashFlowPeriod(client, tenantId, query);

      const cashAccountIds = await this.resolveCashAccountIds(client, tenantId);
      if (cashAccountIds.length === 0) {
        throw AppException.badRequest(
          '現金及び現金同等物として扱う勘定科目(code: 1000/1100、または銀行口座の紐付け科目)が見つかりません',
        );
      }
      const investingAccountIds = await this.resolveInvestingAccountIds(client, tenantId);
      const financingAccountIds = await this.resolveFinancingAccountIds(client, tenantId);

      const [beginningCashBalance, endingCashBalance] = await Promise.all([
        this.sumCashBalance(client, tenantId, cashAccountIds, this.previousDay(startDate)),
        this.sumCashBalance(client, tenantId, cashAccountIds, endDate),
      ]);

      const cashEntriesResult = await client.query<{ journal_entry_id: string; net_cash_amount: string }>(
        `SELECT jel.journal_entry_id,
                SUM(CASE WHEN jel.debit_credit = 'debit' THEN jel.amount ELSE -jel.amount END) AS net_cash_amount
         FROM journal_entry_lines jel
         JOIN journal_entries je ON je.id = jel.journal_entry_id AND je.tenant_id = jel.tenant_id
         WHERE jel.tenant_id = $1 AND jel.account_id = ANY($2::uuid[])
           AND je.status = 'posted' AND je.entry_date BETWEEN $3 AND $4
         GROUP BY jel.journal_entry_id`,
        [tenantId, cashAccountIds, startDate, endDate],
      );

      const netCashByEntry = new Map<string, number>();
      for (const row of cashEntriesResult.rows) {
        netCashByEntry.set(row.journal_entry_id, Number(row.net_cash_amount));
      }
      const entryIds = [...netCashByEntry.keys()];

      const sectionTotals: Record<CashFlowSection, Map<string, { account_code: string; account_name: string; amount: number }>> = {
        operating: new Map(),
        investing: new Map(),
        financing: new Map(),
      };

      if (entryIds.length > 0) {
        const counterLinesResult = await client.query<{
          journal_entry_id: string;
          account_id: string;
          account_code: string;
          account_name: string;
          amount: string;
        }>(
          `SELECT jel.journal_entry_id, jel.account_id, a.code AS account_code, a.name AS account_name, jel.amount
           FROM journal_entry_lines jel
           JOIN accounts a ON a.id = jel.account_id AND a.tenant_id = jel.tenant_id
           WHERE jel.tenant_id = $1 AND jel.journal_entry_id = ANY($2::uuid[])
             AND jel.account_id <> ALL($3::uuid[])`,
          [tenantId, entryIds, cashAccountIds],
        );

        const counterLinesByEntry = new Map<string, typeof counterLinesResult.rows>();
        for (const row of counterLinesResult.rows) {
          const list = counterLinesByEntry.get(row.journal_entry_id) ?? [];
          list.push(row);
          counterLinesByEntry.set(row.journal_entry_id, list);
        }

        for (const [entryId, netCashAmount] of netCashByEntry) {
          if (netCashAmount === 0) continue;
          const counterLines = counterLinesByEntry.get(entryId) ?? [];
          const totalWeight = counterLines.reduce((sum, l) => sum + Math.abs(Number(l.amount)), 0);
          if (totalWeight === 0) continue;

          for (const line of counterLines) {
            const weight = Math.abs(Number(line.amount));
            if (weight === 0) continue;
            const section = this.classifyCounterAccount(
              line.account_id,
              investingAccountIds,
              financingAccountIds,
            );
            const key = `${line.account_code}:${line.account_name}`;
            const bucket = sectionTotals[section];
            const existing = bucket.get(key);
            // 複数行への按分を経由するため、丸めは最終出力時(toLines/sumAmounts)にのみ行い、
            // 集計途中では丸めない(行ごとに丸めると仕訳単位では合っていても口座残高との
            // 差額(数円のずれ)が蓄積する)。
            const amount = netCashAmount * (weight / totalWeight);
            bucket.set(key, {
              account_code: line.account_code,
              account_name: line.account_name,
              amount: (existing?.amount ?? 0) + amount,
            });
          }
        }
      }

      const toLines = (section: CashFlowSection, label: string): FinancialStatementLineDto[] =>
        [...sectionTotals[section].values()]
          .map((v) => ({ ...v, amount: round2(v.amount) }))
          .filter((v) => v.amount !== 0)
          .sort((a, b) => a.account_code.localeCompare(b.account_code))
          .map((v) => ({ account_code: v.account_code, account_name: v.account_name, amount: v.amount, section: label }));

      const operatingActivities = toLines('operating', '営業活動によるキャッシュフロー');
      const investingActivities = toLines('investing', '投資活動によるキャッシュフロー');
      const financingActivities = toLines('financing', '財務活動によるキャッシュフロー');

      const sumAmounts = (lines: FinancialStatementLineDto[]): number =>
        round2(lines.reduce((sum, l) => sum + (l.amount ?? 0), 0));

      const operatingActivitiesTotal = sumAmounts(operatingActivities);
      const investingActivitiesTotal = sumAmounts(investingActivities);
      const financingActivitiesTotal = sumAmounts(financingActivities);

      return {
        periodLabel,
        beginningCashBalance: round2(beginningCashBalance),
        operatingActivities,
        operatingActivitiesTotal,
        investingActivities,
        investingActivitiesTotal,
        financingActivities,
        financingActivitiesTotal,
        // 期首/期末残高は現金及び現金同等物勘定から直接算出しているため、増減額は
        // 3区分の再集計ではなくこの差分を用いる(按分計算による端数の影響を受けず、
        // BSの残高と必ず一致することを保証する)。
        netChangeInCash: round2(endingCashBalance - beginningCashBalance),
        endingCashBalance: round2(endingCashBalance),
      };
    });
  }

  // --------------------------------------------------------------------------
  // 内部ヘルパー
  // --------------------------------------------------------------------------

  private async resolveTrialBalancePeriod(
    client: PoolClient,
    tenantId: string,
    query: TrialBalanceQuery,
  ): Promise<{ startDate: string; endDate: string }> {
    if (query.fiscal_period_id) {
      const result = await client.query<{ start_date: string; end_date: string }>(
        `SELECT TO_CHAR(start_date, 'YYYY-MM-DD') AS start_date, TO_CHAR(end_date, 'YYYY-MM-DD') AS end_date
         FROM fiscal_periods WHERE tenant_id = $1 AND id = $2`,
        [tenantId, query.fiscal_period_id],
      );
      if (result.rowCount === 0) {
        throw AppException.badRequest(`指定された会計期間(id: ${query.fiscal_period_id})が見つかりません`);
      }
      return { startDate: result.rows[0].start_date, endDate: result.rows[0].end_date };
    }
    if (!query.date_to) {
      throw AppException.badRequest('fiscal_period_id、または date_to(必要に応じ date_from)を指定してください');
    }
    return { startDate: query.date_from ?? '0001-01-01', endDate: query.date_to };
  }

  private async resolvePlPeriod(
    client: PoolClient,
    tenantId: string,
    query: PlQuery,
  ): Promise<{ startDate: string; endDate: string; periodLabel: string }> {
    if (query.fiscal_year_id) {
      const result = await client.query<{ start_date: string; end_date: string }>(
        `SELECT TO_CHAR(start_date, 'YYYY-MM-DD') AS start_date, TO_CHAR(end_date, 'YYYY-MM-DD') AS end_date
         FROM fiscal_years WHERE tenant_id = $1 AND id = $2`,
        [tenantId, query.fiscal_year_id],
      );
      if (result.rowCount === 0) {
        throw AppException.badRequest(`指定された会計年度(id: ${query.fiscal_year_id})が見つかりません`);
      }
      return {
        startDate: result.rows[0].start_date,
        endDate: result.rows[0].end_date,
        periodLabel: `${result.rows[0].start_date} 〜 ${result.rows[0].end_date}`,
      };
    }
    if (!query.date_from || !query.date_to) {
      throw AppException.badRequest('fiscal_year_id、または date_from と date_to の両方を指定してください');
    }
    return { startDate: query.date_from, endDate: query.date_to, periodLabel: `${query.date_from} 〜 ${query.date_to}` };
  }

  private async resolveCashFlowPeriod(
    client: PoolClient,
    tenantId: string,
    query: CashFlowQuery,
  ): Promise<{ startDate: string; endDate: string; periodLabel: string }> {
    if (query.fiscal_year_id) {
      const result = await client.query<{ start_date: string; end_date: string }>(
        `SELECT TO_CHAR(start_date, 'YYYY-MM-DD') AS start_date, TO_CHAR(end_date, 'YYYY-MM-DD') AS end_date
         FROM fiscal_years WHERE tenant_id = $1 AND id = $2`,
        [tenantId, query.fiscal_year_id],
      );
      if (result.rowCount === 0) {
        throw AppException.badRequest(`指定された会計年度(id: ${query.fiscal_year_id})が見つかりません`);
      }
      return {
        startDate: result.rows[0].start_date,
        endDate: result.rows[0].end_date,
        periodLabel: `${result.rows[0].start_date} 〜 ${result.rows[0].end_date}`,
      };
    }
    if (!query.date_from || !query.date_to) {
      throw AppException.badRequest('fiscal_year_id、または date_from と date_to の両方を指定してください');
    }
    return { startDate: query.date_from, endDate: query.date_to, periodLabel: `${query.date_from} 〜 ${query.date_to}` };
  }

  private previousDay(dateStr: string): string {
    const date = new Date(`${dateStr}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() - 1);
    return date.toISOString().slice(0, 10);
  }

  private async resolveCashAccountIds(client: PoolClient, tenantId: string): Promise<string[]> {
    const result = await client.query<{ id: string }>(
      `SELECT DISTINCT a.id
       FROM accounts a
       LEFT JOIN bank_accounts ba ON ba.linked_account_id = a.id AND ba.tenant_id = a.tenant_id
       WHERE a.tenant_id = $1 AND (a.code = ANY($2::text[]) OR ba.id IS NOT NULL)`,
      [tenantId, CASH_EQUIVALENT_CODES],
    );
    return result.rows.map((row) => row.id);
  }

  private async resolveInvestingAccountIds(client: PoolClient, tenantId: string): Promise<Set<string>> {
    const result = await client.query<{ id: string }>(
      `SELECT asset_account_id AS id FROM fixed_assets WHERE tenant_id = $1
       UNION
       SELECT id FROM accounts WHERE tenant_id = $1 AND code = ANY($2::text[])`,
      [tenantId, [ACCUMULATED_DEPRECIATION_CODE, DISPOSAL_GAIN_CODE, DISPOSAL_LOSS_CODE]],
    );
    return new Set(result.rows.map((row) => row.id));
  }

  private async resolveFinancingAccountIds(client: PoolClient, tenantId: string): Promise<Set<string>> {
    const result = await client.query<{ id: string }>(
      `SELECT id FROM accounts WHERE tenant_id = $1 AND account_type = 'equity'`,
      [tenantId],
    );
    return new Set(result.rows.map((row) => row.id));
  }

  private classifyCounterAccount(
    accountId: string,
    investingAccountIds: Set<string>,
    financingAccountIds: Set<string>,
  ): CashFlowSection {
    if (investingAccountIds.has(accountId)) return 'investing';
    if (financingAccountIds.has(accountId)) return 'financing';
    return 'operating';
  }

  private async sumCashBalance(
    client: PoolClient,
    tenantId: string,
    cashAccountIds: string[],
    asOfDate: string,
  ): Promise<number> {
    const result = await client.query<{ debit_total: string; credit_total: string }>(
      `SELECT
         COALESCE(SUM(jel.amount) FILTER (WHERE jel.debit_credit = 'debit'), 0) AS debit_total,
         COALESCE(SUM(jel.amount) FILTER (WHERE jel.debit_credit = 'credit'), 0) AS credit_total
       FROM journal_entry_lines jel
       JOIN journal_entries je ON je.id = jel.journal_entry_id AND je.tenant_id = jel.tenant_id
       WHERE jel.tenant_id = $1 AND jel.account_id = ANY($2::uuid[])
         AND je.status = 'posted' AND je.entry_date <= $3`,
      [tenantId, cashAccountIds, asOfDate],
    );
    const row = result.rows[0];
    return Number(row.debit_total) - Number(row.credit_total);
  }
}
