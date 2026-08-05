import { Injectable } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { AppException } from '../../common/exceptions/app.exception';

export interface OcrExtractionResult {
  transaction_date: string | null;
  amount: number | null;
  vendor_name: string | null;
  invoice_registration_number: string | null;
  confidence_score: number;
  model_name: string;
}

export interface OcrExtractionFile {
  buffer: Buffer;
  mimetype: string;
}

const EXTRACTION_TIMEOUT_MS = 30_000;

const EXTRACTION_PROMPT =
  '添付された画像から、写っているレシート・領収書をすべて検出し、取引情報を抽出してください。' +
  '1枚の画像の中に複数のレシート・領収書が写っている場合は、それぞれを個別の明細として' +
  'receipts配列の別要素で返してください。レシートが1枚のみの場合も、要素数1の配列として返してください。' +
  '金額は各レシートの消費税込みの合計金額を数値で、日付はYYYY-MM-DD形式で抽出してください。' +
  '判読できない項目はnullとしてください。インボイス制度の適格請求書発行事業者登録番号(T+13桁の形式)が' +
  '記載されていれば、そのまま抽出してください。';

/** 1件のレシート分の抽出項目スキーマ(nullable許容のためanyOfで表現)。 */
const RECEIPT_ITEM_SCHEMA = {
  type: 'object',
  properties: {
    transaction_date: {
      anyOf: [{ type: 'string' }, { type: 'null' }],
      description: '取引日(YYYY-MM-DD形式)。読み取れない場合はnull',
    },
    amount: {
      anyOf: [{ type: 'number' }, { type: 'null' }],
      description: '消費税込みの合計金額。読み取れない場合はnull',
    },
    vendor_name: {
      anyOf: [{ type: 'string' }, { type: 'null' }],
      description: '店舗名・取引先名。読み取れない場合はnull',
    },
    invoice_registration_number: {
      anyOf: [{ type: 'string' }, { type: 'null' }],
      description: 'インボイス登録番号(T+13桁)。記載がなければnull',
    },
  },
  required: ['transaction_date', 'amount', 'vendor_name', 'invoice_registration_number'],
  additionalProperties: false,
} as const;

/**
 * OpenAI/Anthropicのstructured outputs用JSON Schema。
 * 画像内に複数レシートが写っているケースに対応するため、ルートは単一オブジェクトではなく
 * `receipts`配列を1つだけ持つオブジェクトとする(OpenAIのstrict構造化出力はルート直下の
 * 配列型を許容しないため、`{ receipts: [...] }`でラップする設計とした)。
 */
const EXTRACTION_JSON_SCHEMA = {
  type: 'object',
  properties: {
    receipts: {
      type: 'array',
      items: RECEIPT_ITEM_SCHEMA,
    },
  },
  required: ['receipts'],
  additionalProperties: false,
} as const;

interface RawExtraction {
  transaction_date?: unknown;
  amount?: unknown;
  vendor_name?: unknown;
  invoice_registration_number?: unknown;
}

interface RawExtractionEnvelope {
  receipts?: unknown;
}

/**
 * AI応答テキストをJSONとしてパースする。AIが不正な形式のテキスト
 * (マークダウンのコードフェンス混入、出力の途中切れ等)を返した場合、
 * 生の`SyntaxError`をそのまま呼び出し元へ伝播させず、`AppException.badRequest`
 * (クリーンな400)へ変換する(未捕捉のままだとグローバル例外フィルターで
 * 汎用500として扱われ、実際には回復可能な状況であることが伝わらない)。
 */
function parseAiJsonResponse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw AppException.badRequest('AIからの応答を解析できませんでした。時間をおいて再度お試しください');
  }
}

function normalizeExtractionItem(raw: RawExtraction): Omit<OcrExtractionResult, 'model_name'> {
  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  const transaction_date =
    typeof raw.transaction_date === 'string' && dateRe.test(raw.transaction_date)
      ? raw.transaction_date
      : null;
  const amount =
    typeof raw.amount === 'number' && Number.isFinite(raw.amount) ? raw.amount : null;
  const vendor_name =
    typeof raw.vendor_name === 'string' && raw.vendor_name.trim() ? raw.vendor_name.trim() : null;
  const invoice_registration_number =
    typeof raw.invoice_registration_number === 'string' && raw.invoice_registration_number.trim()
      ? raw.invoice_registration_number.trim()
      : null;

  const filledCount = [transaction_date, amount, vendor_name, invoice_registration_number].filter(
    (v) => v !== null,
  ).length;

  return {
    transaction_date,
    amount,
    vendor_name,
    invoice_registration_number,
    confidence_score: Math.round((filledCount / 4) * 1000) / 1000,
  };
}

/**
 * `{ receipts: [...] }` 形式のAI応答を検証・正規化する。`receipts`が配列でない、または
 * 欠落している場合は「レシートを検出できなかった」ものとして空配列を返す(呼び出し元で
 * エラーにはせず、フロントエンドが「検出できませんでした」と案内する)。
 */
function normalizeReceiptsExtraction(raw: unknown): Array<Omit<OcrExtractionResult, 'model_name'>> {
  const envelope = raw as RawExtractionEnvelope;
  const receipts = Array.isArray(envelope?.receipts) ? (envelope.receipts as RawExtraction[]) : [];
  return receipts.map((item) => normalizeExtractionItem(item ?? {}));
}

/**
 * ReceiptOcrExtractionService
 * =============================
 * 設定済みのAIプロバイダー(Gemini/OpenAI/Anthropic)のVision機能を用いて、
 * レシート・領収書画像から構造化された取引情報を抽出する。
 * 1枚の画像に複数のレシートが写っている場合は、検出した数だけ配列で返す。
 *
 * 抽出結果はこのサービスの戻り値としてのみ返され、DBへの永続化は一切行わない
 * (呼び出し元の`ExpenseReportsService`が`ai_suggestions`への隔離保存を担当する)。
 */
@Injectable()
export class ReceiptOcrExtractionService {
  async extract(
    provider: string,
    apiKey: string,
    file: OcrExtractionFile,
  ): Promise<OcrExtractionResult[]> {
    switch (provider) {
      case 'gemini':
        return this.extractWithGemini(apiKey, file);
      case 'openai':
        return this.extractWithOpenAi(apiKey, file);
      case 'anthropic':
        return this.extractWithAnthropic(apiKey, file);
      default:
        throw AppException.badRequest(`未対応のAIプロバイダです: ${provider}`);
    }
  }

  private async extractWithGemini(apiKey: string, file: OcrExtractionFile): Promise<OcrExtractionResult[]> {
    // 'gemini-2.5-flash'固定は新規キーで404(廃止扱い)となるため、常に最新のFlash系
    // モデルへ解決される'gemini-flash-latest'エイリアスを使用する。
    const model = 'gemini-flash-latest';
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: EXTRACTION_PROMPT },
                { inline_data: { mime_type: file.mimetype, data: file.buffer.toString('base64') } },
              ],
            },
          ],
          generationConfig: {
            responseMimeType: 'application/json',
            responseSchema: {
              type: 'OBJECT',
              properties: {
                receipts: {
                  type: 'ARRAY',
                  items: {
                    type: 'OBJECT',
                    properties: {
                      transaction_date: { type: 'STRING', nullable: true },
                      amount: { type: 'NUMBER', nullable: true },
                      vendor_name: { type: 'STRING', nullable: true },
                      invoice_registration_number: { type: 'STRING', nullable: true },
                    },
                  },
                },
              },
            },
          },
        }),
        signal: AbortSignal.timeout(EXTRACTION_TIMEOUT_MS),
      },
    );

    if (!response.ok) {
      const errText = await response.text();
      throw AppException.badRequest(
        `Gemini Vision APIエラー(HTTP ${response.status}): ${errText.slice(0, 500)}`,
      );
    }

    const data = (await response.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      throw AppException.badRequest('Gemini Vision APIから抽出結果を取得できませんでした');
    }
    const parsed = parseAiJsonResponse(text);
    return normalizeReceiptsExtraction(parsed).map((item) => ({ ...item, model_name: model }));
  }

  private async extractWithOpenAi(apiKey: string, file: OcrExtractionFile): Promise<OcrExtractionResult[]> {
    if (file.mimetype === 'application/pdf') {
      throw AppException.badRequest(
        'OpenAIプロバイダは現在PDF形式の領収書に対応していません。JPEG/PNG形式でアップロードしてください',
      );
    }
    const model = 'gpt-4o-mini';
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: EXTRACTION_PROMPT },
              {
                type: 'image_url',
                image_url: { url: `data:${file.mimetype};base64,${file.buffer.toString('base64')}` },
              },
            ],
          },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'receipt_extraction',
            schema: EXTRACTION_JSON_SCHEMA,
            strict: true,
          },
        },
      }),
      signal: AbortSignal.timeout(EXTRACTION_TIMEOUT_MS),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw AppException.badRequest(
        `OpenAI Vision APIエラー(HTTP ${response.status}): ${errText.slice(0, 500)}`,
      );
    }

    const data = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const text = data.choices?.[0]?.message?.content;
    if (!text) {
      throw AppException.badRequest('OpenAI Vision APIから抽出結果を取得できませんでした');
    }
    const parsed = parseAiJsonResponse(text);
    return normalizeReceiptsExtraction(parsed).map((item) => ({ ...item, model_name: model }));
  }

  private async extractWithAnthropic(
    apiKey: string,
    file: OcrExtractionFile,
  ): Promise<OcrExtractionResult[]> {
    // claude-api skill方針: 明示的な指定がない限り常にclaude-opus-5を使用する。
    const model = 'claude-opus-5';
    // SDKデフォルトのタイムアウトは10分、かつタイムアウト自体もリトライ対象のため
    // 実質さらに長くなりうる。他プロバイダ(Gemini/OpenAI)と同じ30秒に統一し、
    // `extractReceiptOcr`がDBトランザクション(プールから借用したコネクション)を
    // 開いたままAI呼び出しを待つ時間の上限を抑える。
    const client = new Anthropic({ apiKey, timeout: EXTRACTION_TIMEOUT_MS, maxRetries: 0 });

    const content: Anthropic.ContentBlockParam[] =
      file.mimetype === 'application/pdf'
        ? [
            {
              type: 'document',
              source: { type: 'base64', media_type: 'application/pdf', data: file.buffer.toString('base64') },
            },
            { type: 'text', text: EXTRACTION_PROMPT },
          ]
        : [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: file.mimetype as 'image/jpeg' | 'image/png',
                data: file.buffer.toString('base64'),
              },
            },
            { type: 'text', text: EXTRACTION_PROMPT },
          ];

    let response: Anthropic.Message;
    try {
      response = await client.messages.create({
        model,
        max_tokens: 1024,
        // 単純な構造化抽出タスクのため、thinkingは無効化する
        // (Claude Opus 5ではeffort: highでdisabledが許容される)。
        thinking: { type: 'disabled' },
        output_config: {
          format: { type: 'json_schema', schema: EXTRACTION_JSON_SCHEMA },
        },
        messages: [{ role: 'user', content }],
      });
    } catch (err) {
      // 認証エラー・レート制限・タイムアウト等のAI呼び出し起因の異常系は、
      // 生の例外(未捕捉のままだとグローバル例外フィルターで汎用500になる)ではなく
      // クリーンな400として返す(Gemini/OpenAI側のHTTPエラー分岐と同じ方針)。
      if (err instanceof Anthropic.AuthenticationError) {
        throw AppException.badRequest('Anthropic APIキーが無効です(認証エラー)');
      }
      if (err instanceof Anthropic.APIError) {
        throw AppException.badRequest(`Anthropic Vision APIエラー: ${err.message}`);
      }
      throw AppException.badRequest(
        'Anthropic Vision API呼び出しに失敗しました(ネットワークエラーまたはタイムアウト)',
      );
    }

    if (response.stop_reason === 'refusal') {
      throw AppException.badRequest('Anthropic Vision APIがこの画像の処理を拒否しました');
    }

    const textBlock = response.content.find(
      (block): block is Anthropic.TextBlock => block.type === 'text',
    );
    if (!textBlock) {
      throw AppException.badRequest('Anthropic Vision APIから抽出結果を取得できませんでした');
    }
    const parsed = parseAiJsonResponse(textBlock.text);
    return normalizeReceiptsExtraction(parsed).map((item) => ({ ...item, model_name: model }));
  }
}
