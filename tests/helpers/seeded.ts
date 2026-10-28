/** 固定種子的亂數（mulberry32）：性質測試每一輪用自己的種子，失敗時能用同一個種子重現。 */
export function seeded(seed: number): () => number {
  return () => {
    seed = seed + 0x6d2b79f5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
