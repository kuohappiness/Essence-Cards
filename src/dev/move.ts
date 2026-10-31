/**
 * 開發命令 lock 的「上下移動整行」（技術債 N1）：命令真的執行了（executeCommandById 回傳 true）、那一行往上移了，
 * 而且只換了順序（每一行都還在，沒有多也沒有少）才算做到。命令沒執行或正文沒變都算失敗，不能靠「那一行還在」過關。
 */
export function movedUp(executed: boolean, before: string, after: string, line: string): boolean {
  const old = before.split('\n'), now = after.split('\n');
  const at = now.indexOf(line);
  return executed && at >= 0 && at < old.indexOf(line) && [...old].sort().join('\n') === [...now].sort().join('\n');
}
