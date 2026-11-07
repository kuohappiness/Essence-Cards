import { codeKey, sourceLinks, splitSource, termKey, termRank } from '../deck/index.ts';
import type { SourceItem, SourceLink, SourceOwner, SourceScope } from '../deck/index.ts';

// 填出處的小表單（D-169 第 4、5 點、D-170 第 2、9、10 點，tasks/edit-markup.md §4-1、§4-2）：先填好的內容與會寫成的字。
// 只建議，不改歸屬：家長按套用才寫，寫的是 syntax §2-5 本來就有的寫法。要看目錄（同一科有哪些單元），所以放在 catalog。

/** 目錄裡的一個單元（同一科）：年級學期、編號與名稱照目錄顯示的原字。 */
export interface CatalogUnit { term: string; code: string; name: string }
/** 表單上的一個單元選項；exists 是 false 時目錄裡還沒有它的卡組（顯示「還沒有卡組」）。 */
export interface UnitChoice extends CatalogUnit { exists: boolean }
export type PlaceKind = '頁' | '圖' | '表' | '例題' | '筆記連結';
export interface Place { kind: PlaceKind; value: string }
/** 每一欄的來源：原文照實帶進來、猜的（虛線框加「猜的」）、沒選。 */
type Origin = 'original' | 'guessed' | 'unset';
export interface SourceForm {
  /** 'own' 是「這一篇」；null 是沒選。 */
  unit: 'own' | UnitChoice | null;
  unitOrigin: Origin;
  /** 「這一篇」與「其他單元…」之間列出的候選。 */
  candidates: UnitChoice[];
  places: Place[];
  placesOrigin: Origin;
  remark: string;
  remarkOrigin: Origin;
  /** 表單底下的一句說明（橘色）：位置看不懂、當場教的寫法；一直留著。沒有是 null。 */
  note: string | null;
  /** 單元底下的一句說明（原文沒寫年級學期、猜的）：選了單元之後不再顯示。 */
  unitNote: string | null;
}

const TEACH = '可以這樣寫：p.44、圖 2-14、國二上 1-3 p.20、[[筆記#標題]]；只想記一句話，請寫在「備註」';
const BLOCK_KIND: Record<string, PlaceKind> = { p: '頁', fig: '圖', tab: '表', ex: '例題' };

/** 讀法的位置 → 表單的一格；標題不是位置（照說明處理）。 */
function placeOf(link: SourceLink): Place | null {
  if (link.kind === 'block') {
    const found = /^(p|fig|tab|ex)(.+)$/.exec(link.id);
    return found ? { kind: BLOCK_KIND[found[1]], value: found[2] } : null;
  }
  if (link.kind === 'note') return { kind: '筆記連結', value: link.alias ? `${link.link}|${link.alias}` : link.link };
  return null;
}
const sameUnit = (unit: CatalogUnit, term: string, code: string): boolean => termKey(unit.term) === termKey(term) && codeKey(unit.code) === codeKey(code);
const byTerm = (a: CatalogUnit, b: CatalogUnit): number => (termRank(termKey(a.term)) ?? 99) - (termRank(termKey(b.term)) ?? 99);

/**
 * 一項看不懂的出處（或 null：從圖示、命令打開的空白表單）→ 先填好的表單（§4-1 的表）。
 * follows：接在它後面、同一個單元的位置（`1-3 p.20、21` 的 `21`，§4-3 第 1 點），寫回時一起換掉，所以位置一起帶進來。
 * scope：這一段跟著哪個單元（readSourceParts 的 scope）；跟著別的單元、自己又沒寫單元時預選那個單元（L2 第一輪 R3：
 * `國二上 1-3 p.20、老師說過 p.21` 的第二段是 1-3 的 p.21，選「這一篇」寫回會把頁碼改到這一篇）。
 */
export function guessSource(item: SourceItem | null, own: SourceOwner, units: readonly CatalogUnit[], follows: readonly SourceItem[] = [], scope: SourceScope = null): SourceForm {
  const blank: SourceForm = { unit: 'own', unitOrigin: 'original', candidates: [], places: [], placesOrigin: 'unset', remark: '', remarkOrigin: 'unset', note: null, unitNote: null };
  if (!item) return blank;
  const teach = (): SourceForm => ({ ...blank, note: TEACH });
  if (item.problem === 'negative') return teach();
  const parts = splitSource(item.text, own);
  const ownTerm = own.term === null ? null : termKey(own.term);
  const isOwn = (unit: CatalogUnit): boolean => ownTerm !== null && own.unit !== null && sameUnit(unit, ownTerm, own.unit.code);
  const choice = (term: string, code: string): UnitChoice => {
    const found = units.find(unit => sameUnit(unit, term, code));
    return found ? { ...found, exists: true } : { term, code, name: '', exists: false };
  };
  const followed = follows.map(each => placeOf(each.link.kind === 'unit' && each.link.rest ? each.link.rest : each.link));
  const places = parts.bad ? [] : [...parts.places.map(placeOf), ...followed].filter((each): each is Place => each !== null);
  const filled = {
    places, placesOrigin: places.length ? 'original' as const : 'unset' as const,
    remark: parts.left, remarkOrigin: parts.left ? 'original' as const : 'unset' as const,
  };
  const badNote = parts.bad ? '頁碼看不懂，請重新填' : null;
  // 寫了年級學期與編號：那個單元照原文；目錄裡沒有時沒選，候選列出同編號的單元。
  if (parts.term && parts.code) {
    const code = parts.code;
    const found = units.find(unit => sameUnit(unit, parts.term ?? '', code));
    if (found) return { ...blank, ...filled, unit: isOwn(found) ? 'own' : { ...found, exists: true }, unitOrigin: 'original', note: badNote };
    const others = units.filter(unit => codeKey(unit.code) === codeKey(code) && !isOwn(unit)).sort(byTerm).map(unit => ({ ...unit, exists: true }));
    return { ...blank, ...filled, unit: null, unitOrigin: 'unset', candidates: others, note: badNote, unitNote: '找不到這個單元，請選一個' };
  }
  // 短的學期寫法（`二上`）：照這一篇的學制補上，猜的；這一篇沒有認得的學期時列出小、國、高裡目錄有的。
  if (parts.short) {
    const stage = ownTerm && termRank(ownTerm) !== null ? ownTerm[0] : null;
    const said = `原文寫「${parts.short}」`;
    if (stage) {
      const term = stage + parts.short;
      if (parts.code) {
        const unit = choice(term, parts.code);
        return { ...blank, ...filled, unit: unit.exists && isOwn(unit) ? 'own' : unit, unitOrigin: 'guessed', note: badNote, unitNote: `${said}，猜是${term}` };
      }
      return { ...blank, ...filled, unit: null, unitOrigin: 'unset', candidates: termUnits(term), note: badNote, unitNote: `${said}，請選一個單元` };
    }
    const terms = ['小', '國', '高'].map(each => each + parts.short);
    const candidates = units.filter(unit => terms.includes(termKey(unit.term)) && (!parts.code || codeKey(unit.code) === codeKey(parts.code))).sort(byTerm).map(unit => ({ ...unit, exists: true }));
    return { ...blank, ...filled, unit: null, unitOrigin: 'unset', candidates, note: badNote, unitNote: `${said}，不知道是哪個學制，請選一個` };
  }
  // 寫了年級學期、沒寫編號：列出那一學期目錄裡的單元。
  if (parts.term) {
    return { ...blank, ...filled, unit: null, unitOrigin: 'unset', candidates: termUnits(parts.term), note: badNote, unitNote: '原文沒寫單元編號，請選一個' };
  }
  // 編號沒寫年級學期：一律有疑問，不預選（D-170 第 9、10 點）；這一篇的學期排第一，其他照學期順序。
  if (parts.code && (own.unit === null || codeKey(parts.code) !== codeKey(own.unit.code))) {
    const code = parts.code;
    const first = ownTerm && termRank(ownTerm) !== null ? [choice(ownTerm, code)] : [];
    const rest = units.filter(unit => codeKey(unit.code) === codeKey(code) && !first.some(each => sameUnit(each, unit.term, unit.code))).sort(byTerm).map(unit => ({ ...unit, exists: true }));
    return { ...blank, ...filled, unit: null, unitOrigin: 'unset', candidates: [...first, ...rest], note: badNote, unitNote: '原文沒寫年級學期，請選一個' };
  }
  // 這一篇的位置：位置前面有一句話、頁碼看不懂。
  if (places.length || parts.bad || parts.places.length) {
    const unit = scope && scope !== 'this' ? choice(scope.term, scope.unit) : null;
    return { ...blank, ...filled, unit: unit && !isOwn(unit) ? unit : 'own', unitOrigin: 'original', note: badNote };
  }
  // 舊標題找不到、猜不出來的：照 D-169 第 4 點當場教。
  return teach();

  function termUnits(term: string): UnitChoice[] {
    return units.filter(unit => termKey(unit.term) === termKey(term) && !isOwn(unit)).map(unit => ({ ...unit, exists: true }));
  }
}

// ── §4-2 會寫成什麼 ──

const PLACE_FORMAT: Record<PlaceKind, RegExp> = {
  頁: /^\d+$/,
  圖: /^\d+-\d+[a-z]?$/i,
  表: /^\d+-\d+$/,
  例題: /^\d+-\d+$/,
  筆記連結: /^(?:\[\[)?[^[\]\n|]+(?:\|[^[\]\n]+)?(?:\]\])?$/,
};
/** 這一格的格式對不對；空的不算錯（不寫）。 */
export const placeValid = (place: Place): boolean => !place.value.trim() || PLACE_FORMAT[place.kind].test(place.value.trim());
function placeText({ kind, value }: Place): string {
  const text = value.trim();
  if (kind === '頁') return 'p.' + text;
  if (kind === '筆記連結') return '[[' + text.replace(/^\[\[|\]\]$/g, '') + ']]';
  return kind + ' ' + text;
}
/** 一項的寫法：`[單元] [位置…] [說明]`，中間一個半形空白；「這一篇」不寫單元。 */
export function sourceText(form: Pick<SourceForm, 'unit' | 'places' | 'remark'>): string {
  const unit = form.unit && form.unit !== 'own' ? `${form.unit.term} ${form.unit.code}` : '';
  const places = form.places.filter(place => place.value.trim()).map(placeText);
  return [unit, ...places, form.remark.trim()].filter(Boolean).join(' ');
}
/** 「會算進」：選的單元的 `年級學期 編號 名稱`；「這一篇」寫這一篇的單元。 */
export function countedUnit(form: Pick<SourceForm, 'unit'>, own: SourceOwner & { unit: { code: string; name?: string } | null }): string {
  if (form.unit === null) return '';
  const unit = form.unit === 'own' ? { term: own.term ?? '', code: own.unit?.code ?? '', name: own.unit?.name ?? '' } : form.unit;
  return [unit.term, unit.code, unit.name].filter(Boolean).join(' ');
}

/** 能不能套用；不能時是那一句原因（null 是可以）。preceding：寫進去的位置前面那幾項（同一欄、照實，§4-3 給）。 */
export function applyBlock(form: SourceForm, own: SourceOwner, preceding: readonly string[] = []): string | null {
  if (form.unit === null) return '請先選單元';
  if (form.places.some(place => !placeValid(place))) return '位置的格式不對';
  const text = sourceText(form);
  if (!text) return '還沒有要寫的字';
  // 用讀法讀回這一項（D-170 第 10 點）：單元與位置就是表單上的、沒有 problem、不是舊標題。
  const before = sourceLinks(preceding, own).length;
  const read = sourceLinks([...preceding, text], own).slice(before);
  if (!read.length) return '這一項已經寫過了';
  const remark = form.remark.trim() !== '';
  const expected = form.places.filter(place => place.value.trim()).map(place => placeText(place).toLowerCase());
  if (!expected.length && read.every(item => item.link.kind === 'heading' || item.link.kind === 'text')) return '只有說明會被當成標題，請加位置，或寫在「備註」';
  const unit = form.unit;
  const got: string[] = [];
  for (const item of read) {
    const inner = item.link.kind === 'unit' ? item.link.rest : item.link;
    const sameUnit = unit === 'own' ? item.link.kind !== 'unit'
      : item.link.kind === 'unit' && termKey(item.link.term) === termKey(unit.term) && codeKey(item.link.unit) === codeKey(unit.code);
    const place = inner && placeOf(inner);
    if (item.problem || !sameUnit || (inner && !place) || item.link.kind === 'heading' || item.link.kind === 'text') {
      return remark ? '說明裡有像單元或頁碼的字，請改寫，或寫在「備註」' : '讀回來和表單不一樣，請改寫';
    }
    if (place) got.push(placeText(place).toLowerCase());
  }
  if (got.join(' ') !== expected.join(' ')) return remark ? '說明裡有像單元或頁碼的字，請改寫，或寫在「備註」' : '讀回來和表單不一樣，請改寫';
  return null;
}
