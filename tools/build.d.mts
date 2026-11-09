/** tools/build.mjs 的型別：給 tools 的 TypeScript 檔 import。 */
export function buildVersion(root?: string): Promise<string>;
export function buildPlugin(options?: { root?: string; dev?: boolean; outdir?: string; sourcemap?: string }): Promise<{ version: string; dev: boolean }>;
/** D-148：電腦專用的資料夾與它能用的 Node、Electron 模組。 */
export const DESKTOP: string;
export const DESKTOP_ONLY: string[];
export function desktopOnly(root?: string): import('esbuild').Plugin;
export function desktopViolations(metafile: import('esbuild').Metafile): string[];
/** AI 製卡的規則檔（tasks/ai-cards-mvp.md §1）。 */
export function ruleFiles(): string[];
export function embedRules(root?: string): Promise<Record<string, { name: string; version: string; text: string; sha256: string }[]>>;
