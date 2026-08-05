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
