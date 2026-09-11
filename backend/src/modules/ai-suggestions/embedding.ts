/**
 * 疑似埋め込み(pseudo-embedding)ユーティリティ
 * ============================================
 * 本MVPでは外部の埋め込みAPI(OpenAI Embeddings等)を呼び出さず、文字n-gramの
 * ハッシュに基づく決定的なベクトルを生成する。目的はあくまで
 * 「pgvectorによるコサイン類似度検索の配線」自体を実証することであり、
 * 実運用では `journal_entry_embeddings.model_name` を実際の埋め込みモデル名に
 * 差し替えた上でこの関数を置き換える想定(呼び出し側のインターフェースは
 * 変わらないため、差し替えコストは局所化されている)。
 *
 * 文字1〜3-gramをハッシュしてバケットへ加算するbag-of-n-gramsハッシュトリックにより、
 * 表記が近い(共通の部分文字列を多く含む)日本語テキスト同士は高いコサイン類似度を
 * 持つ。決定的であるため、動作確認(同一入力→同一ベクトル)が容易という利点もある。
 */

export const PSEUDO_EMBEDDING_MODEL = 'pseudo-char-ngram-hash-v1';
export const EMBEDDING_DIM = 1536;

function fnv1aHash(str: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function computeTextEmbedding(text: string): number[] {
  const vector = new Array<number>(EMBEDDING_DIM).fill(0);
  const normalized = text.normalize('NFKC').toLowerCase().trim();

  for (let i = 0; i < normalized.length; i++) {
    for (const n of [1, 2, 3]) {
      if (i + n > normalized.length) continue;
      const gram = normalized.slice(i, i + n);
      const bucket = fnv1aHash(gram) % EMBEDDING_DIM;
      vector[bucket] += 1;
    }
  }

  const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
  if (norm === 0) {
    return vector;
  }
  return vector.map((v) => v / norm);
}

/** pgvectorのテキスト入力形式(`[v1,v2,...]`)へ変換する。 */
export function toVectorLiteral(vector: number[]): string {
  return `[${vector.join(',')}]`;
}

/**
 * 契約書テキストを自然な境界(改行・句点)を考慮しつつチャンク分割する。
 * 各チャンクは pgvector による条項単位の近傍探索・類似検索に使用される。
 *
 * @param text 契約書本文
 * @param maxChunkSize 1チャンクの最大文字数 (デフォルト: 500)
 * @param overlap チャンク間のオーバーラップ文字数 (デフォルト: 100)
 */
export function chunkContractText(
  text: string,
  maxChunkSize = 500,
  overlap = 100,
): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.length <= maxChunkSize) return [trimmed];

  const chunks: string[] = [];
  let startIndex = 0;

  while (startIndex < trimmed.length) {
    let endIndex = startIndex + maxChunkSize;
    if (endIndex >= trimmed.length) {
      const remaining = trimmed.slice(startIndex).trim();
      if (remaining) chunks.push(remaining);
      break;
    }

    // 自然な境界 (改行または句点) を探して優先的に分割
    const slice = trimmed.slice(startIndex, endIndex);
    const lastNewline = slice.lastIndexOf('\n');
    const lastPeriod = slice.lastIndexOf('。');
    const splitPoint = Math.max(lastNewline, lastPeriod);

    if (splitPoint > maxChunkSize * 0.5) {
      endIndex = startIndex + splitPoint + 1;
    }

    const chunk = trimmed.slice(startIndex, endIndex).trim();
    if (chunk) {
      chunks.push(chunk);
    }

    startIndex = Math.max(startIndex + 1, endIndex - overlap);
  }

  return chunks;
}

