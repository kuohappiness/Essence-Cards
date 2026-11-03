import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { catalogView, entryView, reminderView } from '../review/index.ts';
import type { Catalog, State, StudyPick, UnitView } from '../state/index.ts';
import type { TermOpen } from './prefs.ts';

// 入口與目錄（D-095、D-097、D-163）：同一個全螢幕裡切換，不開第二層；資料都來自 review 與 state，畫面不自己算。

export type EntryScreen = 'entry' | 'catalog';
/** 主機（entry-host）持有的外部狀態：現在是哪個畫面，資料有沒有變。 */
interface EntryStore {
  subscribe(listener: () => void): () => void;
  version(): number;
  screen(): EntryScreen;
  go(screen: EntryScreen): void;
}
export interface EntryProps {
  store: EntryStore;
  state: () => State | null;
  /** 開始一次複習：複習畫面蓋在上面，做完或 ✕ 回到這裡。 */
  start: (pick: StudyPick) => void;
  /** 入口關掉，打開那篇筆記（line 從 0 算）。 */
  openNote: (path: string, line?: number) => void;
  /** 入口關掉，打開設定頁的 Essence Cards 分頁。 */
  openSettings: () => void;
  close: () => void;
  /** 提醒一區：只有電腦（D-103、D-163 第 5 點）。 */
  reminders: boolean;
  terms: { get(): TermOpen; set(terms: TermOpen): void };
  /** 複習畫面蓋在上面：焦點是它的，這裡不搶。 */
  covered: () => boolean;
}

const PATHS = {
  play: <path d="M7 4.5v15l12-7.5z" fill="currentColor" stroke="none" />,
  gear: <><circle cx="12" cy="12" r="3" /><path d="M12 2.8v2.6M12 18.6v2.6M2.8 12h2.6M18.6 12h2.6M5.5 5.5l1.8 1.8M16.7 16.7l1.8 1.8M18.5 5.5l-1.8 1.8M7.3 16.7l-1.8 1.8" /></>,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  back: <path d="m15 5-7 7 7 7" />,
  next: <path d="m9 5 7 7-7 7" />,
};
function Icon({ type, size = 20 }: { type: keyof typeof PATHS; size?: number }): React.JSX.Element {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{PATHS[type]}</svg>;
}
const NOTHING_TODAY = '今天沒有要複習的卡';

export function Entry(props: EntryProps): React.JSX.Element {
  const { store } = props;
  const version = useSyncExternalStore(listener => store.subscribe(listener), () => store.version(), () => store.version());
  const root = useRef<HTMLDivElement>(null);
  const screen = store.screen();
  // 按鈕或列消失時（做完一科、換畫面），焦點回到畫面上：不然掉到 body，Esc 和 Tab 都沒有作用（R6）。
  useEffect(() => {
    if (!props.covered() && root.current && !root.current.contains(document.activeElement)) root.current.focus({ preventScroll: true });
  });
  const onKey = (event: React.KeyboardEvent): void => {
    if (event.key !== 'Escape' || event.nativeEvent.isComposing) return;
    event.preventDefault();
    if (screen === 'catalog') store.go('entry');
    else props.close();
  };
  return <div className="ec-app ec-entry" ref={root} tabIndex={-1} onKeyDown={onKey}>
    {screen === 'entry' ? <Home {...props} /> : <Directory {...props} version={version} />}
  </div>;
}

function Home(props: EntryProps): React.JSX.Element {
  const state = props.state();
  const view = entryView(state);
  const ready = view.kind === 'ready';
  return <>
    <div className="ec-en-top">
      <p className={'ec-en-today' + (ready && view.finished ? ' is-done' : '')}>
        <span className="ec-en-name">今日複習</span>
        {ready && <span className="ec-en-n">{view.done}/{view.total}</span>}
      </p>
      <span className="ec-en-tools">
        <button type="button" className="ec-ico" aria-label="設定" onClick={props.openSettings}><Icon type="gear" /></button>
        <button type="button" className="ec-ico" aria-label="關閉" onClick={props.close}><Icon type="close" /></button>
      </span>
    </div>
    <div className="ec-en-scroll">
      {view.kind === 'loading' && <p className="ec-en-none">正在讀取卡組…</p>}
      {ready && !view.rows.length && <p className="ec-en-none">{NOTHING_TODAY}</p>}
      {ready && view.rows.length > 0 && <div className="ec-sb-list">
        {view.rows.map(row => <div key={row.name} className={'ec-sb' + (row.finished ? ' is-done' : '')}>
          <span className="ec-en-l1"><span className="ec-en-name">{row.name}</span><span className="ec-en-n">{row.done}/{row.total}</span></span>
          {row.finished
            ? <button type="button" className="ec-sb-btn" disabled>完成</button>
            : <button type="button" className="ec-sb-btn" aria-label={'開始' + row.name} onClick={() => { props.start(row.pick); }}><Icon type="play" size={14} /><span>{row.minutes} 分鐘</span></button>}
          <i className="ec-sb-bar" aria-hidden="true"><i style={{ width: String(row.total ? row.done / row.total * 100 : 0) + '%' }} /></i>
        </div>)}
      </div>}
      {ready && view.more && <button type="button" className="ec-en-more" onClick={() => { props.start({ more: true }); }}>再複習一些</button>}
      <button type="button" className="ec-en-row" onClick={() => { props.store.go('catalog'); }}><span>目錄</span><Icon type="next" size={18} /></button>
      {props.reminders && <Reminders state={state} />}
    </div>
    <p className="ec-en-mark" lang="en">Essence Cards</p>
  </>;
}

/** 提醒一區（D-163 第 5 點）：只有電腦；沒有提醒時整區消失。說明書還沒寫，先不放連結。 */
function Reminders({ state }: { state: State | null }): React.JSX.Element | null {
  const view = reminderView(state);
  const [open, setOpen] = useState(false);
  if (!view.count) return null;
  return <section className="ec-rem">
    <h2>提醒</h2>
    {view.unread.length > 0 && <div className="ec-rem-row">
      <button type="button" className="ec-rem-go" aria-expanded={open} onClick={() => { setOpen(!open); }}><span>有 {view.unread.length} 個檔案暫時讀不到</span><Icon type="next" size={16} /></button>
      {open && <ul className="ec-rem-paths">{view.unread.map(path => <li key={path}>{path}</li>)}</ul>}
    </div>}
    {view.needsUpdate && <p className="ec-rem-row ec-rem-text">有內容需要新版才讀得懂，請更新外掛</p>}
  </section>;
}

/** 「其他」組的收合鍵：學期名稱不會這樣寫。 */
const OTHERS = '*其他';

function Directory(props: EntryProps & { version: number }): React.JSX.Element {
  const { version, store } = props;
  // 資料變了才重算：要重播紀錄算顏色。
  const catalog = useMemo(() => catalogView(props.state()), [version]);
  const [mode, setMode] = useState<'today' | 'all'>('all');
  const [openUnits, setOpenUnits] = useState<ReadonlySet<string>>(new Set());
  const [terms, setTerms] = useState(() => props.terms.get());
  const toggle = (key: string): void => {
    const next = new Set(openUnits);
    if (!next.delete(key)) next.add(key);
    setOpenUnits(next);
  };
  const back = (): void => { store.go('entry'); };
  const setTerm = (key: string, on: boolean): void => {
    const next = { ...terms, [key]: on };
    setTerms(next);
    props.terms.set(next);
  };
  return <>
    <div className="ec-en-top is-nav">
      <button type="button" className="ec-ico" aria-label="返回" onClick={back}><Icon type="back" /></button>
      <h1 className="ec-en-title">目錄</h1>
      <button type="button" className="ec-ico" aria-label="關閉目錄" onClick={back}><Icon type="close" /></button>
    </div>
    <div className="ec-en-scroll">
      <div className="ec-seg" role="group" aria-label="目錄">
        {(['today', 'all'] as const).map(each => <button key={each} type="button" aria-pressed={mode === each} onClick={() => { setMode(each); }}>{each === 'today' ? '當日' : '全部'}</button>)}
      </div>
      {catalog
        ? <Tree catalog={catalog} mode={mode} termOpen={terms} setTerm={setTerm} openUnits={openUnits} toggle={toggle} {...props} />
        : <p className="ec-en-none">正在讀取卡組…</p>}
    </div>
  </>;
}

interface TreeProps extends EntryProps {
  catalog: Catalog;
  mode: 'today' | 'all';
  termOpen: TermOpen;
  setTerm: (key: string, on: boolean) => void;
  openUnits: ReadonlySet<string>;
  toggle: (key: string) => void;
}

function Tree(props: TreeProps): React.JSX.Element {
  const { catalog, mode, termOpen, setTerm } = props;
  const today = mode === 'today';
  const shown = (units: readonly UnitView[]): readonly UnitView[] => today ? units.filter(unit => unit.today > 0) : units;
  const groups = catalog.terms.map(term => ({ key: term.term, label: term.term, subjects: term.subjects.map(subject => ({ ...subject, units: shown(subject.units) })).filter(subject => subject.units.length) }));
  const others = shown(catalog.others);
  const isOpen = (key: string, fallback: boolean): boolean => today || (termOpen[key] ?? fallback);
  const header = (key: string, label: string, on: boolean): React.JSX.Element =>
    <button type="button" className={'ec-tr-sem' + (on ? ' is-open' : '')} aria-expanded={on} onClick={() => { setTerm(key, !on); }}><span>{label}</span><Icon type="next" size={16} /></button>;
  const empty = !others.length && groups.every(group => !group.subjects.length);
  if (empty) return <p className="ec-en-none">{today ? NOTHING_TODAY : '還沒有卡組'}</p>;
  return <>
    {groups.filter(group => group.subjects.length).map(group => {
      const on = isOpen(group.key, group.key === catalog.latest);
      return <div key={group.key} className="ec-tr-group">
        {header(group.key, group.label, on)}
        {on && group.subjects.map(subject => <section key={subject.subject}>
          <h2 className="ec-tr-subject">{subject.subject}</h2>
          {subject.units.map(unit => <UnitRow key={unit.key} unit={unit} {...props} />)}
        </section>)}
      </div>;
    })}
    {others.length > 0 && (() => {
      const on = isOpen(OTHERS, catalog.latest === null);
      return <div className="ec-tr-group">
        {header(OTHERS, '其他', on)}
        {on && others.map(unit => <UnitRow key={unit.key} unit={unit} {...props} />)}
      </div>;
    })()}
  </>;
}

const TAG = { draft: '草稿', paused: '暫停' } as const;
const PROBLEM = { target: '學習目標寫法有問題', property: '屬性寫法有問題' } as const;

function UnitRow({ unit, openUnits, toggle, start, openNote }: TreeProps & { unit: UnitView }): React.JSX.Element {
  const active = unit.status === 'active';
  // 全部是草稿或暫停：點了打開筆記（§3）；好幾篇時展開箭頭列出全部。
  const expandable = active || unit.decks.length > 1 || unit.problems.length > 0;
  const open = openUnits.has(unit.key) && expandable;
  const rest = active ? unit.decks.filter(deck => deck.status !== 'active') : unit.decks;
  return <>
    <div className={'ec-tr-u' + (open ? ' is-open' : '')}>
      <button type="button" className={'ec-tr-exp' + (open ? ' is-open' : '')} aria-expanded={open} aria-label={'展開' + unit.name} disabled={!expandable} onClick={() => { toggle(unit.key); }}><Icon type="next" size={16} /></button>
      <button type="button" className="ec-tr-name" onClick={() => { if (active) toggle(unit.key); else openNote(unit.decks[0].path); }}>
        <span>{unit.name}</span>
        {unit.status !== 'active' && <span className="ec-tr-tag">{TAG[unit.status]}</span>}
      </button>
      {!open && unit.count !== null && <span className="ec-tr-due" data-m={unit.color}>{unit.count}</span>}
      {open && active && <span className="ec-tr-ub">
        <button type="button" className="ec-u-btn" disabled={unit.today === 0} onClick={() => { start({ unit: unit.key }); }}><Icon type="play" size={12} />當日卡 {unit.today}</button>
        <button type="button" className="ec-u-btn" disabled={unit.targets.length === 0} onClick={() => { start({ unit: unit.key, since: Date.now() }); }}><Icon type="play" size={12} />全部卡 {unit.targets.length}</button>
      </span>}
    </div>
    {open && <div className="ec-tr-open">
      {unit.problems.map(problem => <button key={problem.kind} type="button" className="ec-tr-problem" onClick={() => { openNote(problem.path, problem.line); }}>{problem.count} 個{PROBLEM[problem.kind]}</button>)}
      {unit.targets.length > 0 && <ul className="ec-tr-ts">
        {unit.targets.map(target => <li key={target.id} className="ec-tr-t">
          <i className="ec-tr-dot" data-m={target.color} />
          <span>{target.name}{target.from && <small className="ec-tr-from">來自{target.from}</small>}</span>
        </li>)}
      </ul>}
      {rest.map(deck => <button key={deck.path} type="button" className="ec-tr-deck" onClick={() => { openNote(deck.path); }}><span>{deck.name}</span>{deck.status !== 'active' && <span className="ec-tr-tag">{TAG[deck.status]}</span>}</button>)}
    </div>}
  </>;
}
