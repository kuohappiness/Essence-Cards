import type { CatalogIndex } from './index.ts';
import { unitInScope } from './scope.ts';
import type { ScopeFile } from './scope.ts';

// 範圍和卡組對起來（tasks/exam-scope.md §3、§7、§8）：範圍檔只看字面（scope.ts），這裡才看索引。

/** 這份範圍裡的目標：自己的單元或出處的單元落在範圍內。對不到卡組的單元也算（§3），所以後來才建卡組只讓提示消失。 */
export function targetsInScope(file: Pick<ScopeFile, 'lines'>, index: CatalogIndex): Set<string> {
  const ids = new Set<string>();
  for (const member of index.members) if (member.units.some(unit => unitInScope(file, unit))) ids.add(member.id);
  return ids;
}
