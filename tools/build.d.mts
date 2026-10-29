/** tools/build.mjs 的型別：給 tools 的 TypeScript 檔 import。 */
export function buildVersion(root?: string): Promise<string>;
export function buildPlugin(options?: { root?: string; dev?: boolean; outdir?: string }): Promise<{ version: string; dev: boolean }>;
