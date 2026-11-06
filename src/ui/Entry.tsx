import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { catalogView, entryView, examRow, examSubject, quizButton, quizViews, reminderView } from '../review/index.ts';
import type { FolderActions } from '../review/index.ts';
import type { Catalog, DeckStatusValue, QuizRef, State, StudyPick, UnitView } from '../state/index.ts';
import { Icon } from './entry-icon.tsx';
import { ExamScope } from './ExamScope.tsx';
import { QuizButton, QuizEntryRow } from './Quiz.tsx';
import type { TermOpen } from './prefs.ts';

// 入口與目錄（D-095、D-097、D-163）：同一個全螢幕裡切換，不開第二層；資料都來自 review 與 state，畫面不自己算。

export type EntryScreen = 'entry' | 'catalog' | 'scope';
/** 主機（entry-host）持有的外部狀態：現在是哪個畫面，資料有沒有變。 */
interface EntryStore {
  subscribe(listener: () => void): () => void;
  version(): number;
  screen(): EntryScreen;
  go(screen: EntryScreen): void;
  /** 考試範圍畫面是從哪裡進來的（D-163 第 2 點）：✕、返回、存好都回那裡。 */
  from(): EntryScreen;
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
  /** 系統資料夾的防呆：搬錯位置的列在提醒一區（tasks/system-folder-guard.md §2-4）。 */
  folders: FolderActions | null;
  terms: { get(): TermOpen; set(terms: TermOpen): void };
  /** 複習畫面蓋在上面：焦點是它的，這裡不搶。 */
  covered: () => boolean;
  /** 短暫的通知（存好了、已結束）。 */
  notify: (message: string) => void;
  /** 暫停或恢復一篇，回傳要提示的字（D-183 第 6 點）：只有電腦有，手機不寫卡組（D-142 第 4 點）。 */
  setDeckStatus?: (path: string, value: DeckStatusValue) => Promise<string | null>;
  /** 設定頁的「小考標記」（tasks/quiz-mark.md §2）：只管目錄的小考按鈕，入口那一列不看它。 */
  quizMark: () => boolean;
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
    if (screen === 'scope') store.go(store.from());
    else if (screen === 'catalog') store.go('entry');
    else props.close();
  };
  return <div className="ec-app ec-entry" ref={root} tabIndex={-1} onKeyDown={onKey}>
    {screen === 'entry' ? <Home {...props} /> : screen === 'catalog' ? <Directory {...props} version={version} /> : <ExamScope {...props} version={version} />}
  </div>;
}

function Home(props: EntryProps): React.JSX.Element {
  const state = props.state();
  const view = entryView(state);
  const ready = view.kind === 'ready';
  const quizzes = ready ? quizViews(state) : [];
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
      {ready && (quizzes.length > 0 || view.rows.length > 0) && <div className="ec-sb-list">
        {quizzes.map(row => <QuizEntryRow key={row.key} row={row} {...props} />)}
        {view.rows.map(row => <div key={row.name} className={'ec-sb' + (row.finished ? ' is-done' : '')}>
          <span className="ec-sb-left">
            <span className="ec-en-l1"><span className="ec-en-name">{row.name}</span><span className="ec-en-n">{row.done}/{row.total}</span></span>
            {row.countdown === 'today' && <span className="ec-sb-ex">今天考試</span>}
            {typeof row.countdown === 'number' && <span className="ec-sb-ex">距離考試：<b>{row.countdown}</b> 天</span>}
          </span>
          {row.finished
            ? <button type="button" className="ec-sb-btn" disabled>完成</button>
            : <button type="button" className="ec-sb-btn" aria-label={'開始' + row.name} onClick={() => { props.start(row.pick); }}><Icon type="play" size={14} /><span>{row.minutes} 分鐘</span></button>}
          <i className="ec-sb-bar" aria-hidden="true"><i style={{ width: String(row.total ? row.done / row.total * 100 : 0) + '%' }} /></i>
        </div>)}
      </div>}
      {ready && !view.rows.length && <p className="ec-en-none">{NOTHING_TODAY}</p>}
      {ready && view.more && <button type="button" className="ec-en-more" onClick={() => { props.start({ more: true }); }}>再複習一些</button>}
      <ExamRow {...props} />
      <button type="button" className="ec-en-row" onClick={() => { props.store.go('catalog'); }}><span>目錄</span><Icon type="next" size={18} /></button>
      {props.reminders && <Reminders state={state} folders={props.folders} />}
    </div>
    <p className="ec-en-mark" lang="en">Essence Cards</p>
  </>;
}

/** 「考試範圍與日期」那一列（tasks/exam-scope.md §7）：不收合，考前看範圍就是這一區的用途；點了進設定。 */
function ExamRow({ state, store }: EntryProps): React.JSX.Element {
  const view = examRow(state());
  return <button type="button" className="ec-en-row ec-sc-row" onClick={() => { store.go('scope'); }}>
    <span className="ec-sc-body">
      <span className="ec-sc-head"><span>考試範圍與日期</span>{view.status !== null && <span className="ec-sc-per">{view.status}</span>}</span>
      {view.subjects.length > 0 && <span className="ec-sc-lines">{view.subjects.map(each => <span key={each.subject} className="ec-sc-line"><b>{each.subject}</b><span>{each.label}</span></span>)}</span>}
      {view.after !== null && <span className="ec-sc-note">{view.after}</span>}
      {view.notes.map(note => <span key={note} className="ec-sc-note is-warn">{note}</span>)}
    </span>
    <Icon type="next" size={18} />
  </button>;
}

/** 提醒一區（D-163 第 5 點）：只有電腦；沒有提醒時整區消失。說明書還沒寫，先不放連結。 */
function Reminders({ state, folders }: { state: State | null; folders: FolderActions | null }): React.JSX.Element | null {
  const view = reminderView(state, folders?.issues());
  const [open, setOpen] = useState(false);
  /** 正在搬回的那一項：按鈕停用，不重複按。 */
  const [moving, setMoving] = useState<string | null>(null);
  if (!view.count) return null;
  return <section className="ec-rem">
    <h2>提醒</h2>
    {view.unread.length > 0 && <div className="ec-rem-row">
      <button type="button" className="ec-rem-go" aria-expanded={open} onClick={() => { setOpen(!open); }}><span>有 {view.unread.length} 個檔案暫時讀不到</span><Icon type="next" size={16} /></button>
      {open && <ul className="ec-rem-paths">{view.unread.map(path => <li key={path}>{path}</li>)}</ul>}
    </div>}
    {view.needsUpdate && <p className="ec-rem-row ec-rem-text">有內容需要新版才讀得懂，請更新外掛</p>}
    {folders && view.folders.map(item => <div key={item.folder} className="ec-rem-row">
      <p className="ec-rem-text">{item.text}</p>
      {item.action === 'move' && <button type="button" className="ec-rem-act" disabled={moving === item.folder} onClick={() => {
        setMoving(item.folder);
        // 失敗的原因防呆自己通知、記進錯誤紀錄；這裡只把按鈕恢復。
        void folders.moveBack(item.issue).catch(() => false).finally(() => { setMoving(null); });
      }}>搬回原位</button>}
      {item.action === 'dismiss' && <button type="button" className="ec-rem-act" onClick={() => { folders.dismiss(item.folder); }}>不用了</button>}
    </div>)}
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
      <ExamRow {...props} />
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
          <div className="ec-tr-sh">
            <h2 className="ec-tr-subject">{subject.subject}</h2>
            <ExamSubject {...props} term={group.key} subject={subject.subject} />
          </div>
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

function ExamSubject({ state, term, subject }: EntryProps & { term: string; subject: string }): React.JSX.Element | null {
  const text = examSubject(state(), term, subject);
  return text === null ? null : <span className="ec-tr-ex">{text}</span>;
}

const TAG = { draft: '草稿', paused: '暫停' } as const;
const PROBLEM = { target: '學習目標寫法有問題', property: '屬性寫法有問題' } as const;

/** 篇名：檔名；同一個單元裡有同名的，附資料夾名（D-189 第 3 點）。 */
function deckLabel(deck: UnitView['decks'][number], decks: UnitView['decks']): string {
  if (decks.filter(other => other.name === deck.name).length < 2) return deck.name;
  return `${deck.name}（${deck.path.split('/').at(-2) ?? ''}）`;
}

function UnitRow(props: TreeProps & { unit: UnitView }): React.JSX.Element {
  const { unit, openUnits, toggle, start, openNote, state, notify, setDeckStatus, quizMark } = props;
  const active = unit.status === 'active';
  const practiced = unit.decks.filter(deck => deck.status === 'active');
  // 兩篇以上啟用才有單篇的全部卡（D-189 第 3 點）：只有一篇時，單元的全部卡就是那一篇。
  const several = practiced.length > 1;
  /** 暫停／恢復（D-183 第 6 點）：電腦上、單元有兩篇以上；草稿沒有。 */
  const statusButton = (deck: UnitView['decks'][number]): React.JSX.Element | null => {
    if (!setDeckStatus || unit.decks.length < 2 || deck.status === 'draft') return null;
    const value = deck.status === 'paused' ? '啟用' : '暫停';
    return <button type="button" className="ec-u-btn is-quiet" onClick={() => { void setDeckStatus(deck.path, value).then(tip => { if (tip) notify(tip); }); }}>{value === '啟用' ? '恢復' : '暫停'}</button>;
  };
  const marks = quizMark();
  /** 這一篇的小考按鈕（§3）：兩篇以上啟用才有；只剩一篇時，手寫或之前設的小考還是找得到。草稿、暫停的篇沒有。 */
  const deckRef = (deck: UnitView['decks'][number]): QuizRef => ({ deck: deck.path });
  const deckQuiz = (deck: UnitView['decks'][number]): boolean => marks && (several || quizButton(state(), deckRef(deck)).kind !== 'none');
  const listed = several ? practiced : practiced.filter(deck => statusButton(deck) || deckQuiz(deck));
  // 全部是草稿或暫停：點了打開筆記（§3）；好幾篇時展開箭頭列出全部。
  const expandable = active || unit.decks.length > 1 || unit.problems.length > 0;
  const open = openUnits.has(unit.key) && expandable;
  const rest = active ? unit.decks.filter(deck => deck.status !== 'active') : unit.decks;
  return <>
    <div className={'ec-tr-u' + (open ? ' is-open' : '')}>
      <button type="button" className={'ec-tr-exp' + (open ? ' is-open' : '')} aria-expanded={open} aria-label={'展開' + unit.name} disabled={!expandable} onClick={() => { toggle(unit.key); }}><Icon type="next" size={16} /></button>
      <button type="button" className="ec-tr-name" onClick={() => { if (active) toggle(unit.key); else openNote(unit.decks[0].path); }}>
        <span>{unit.name}</span>
        {unit.inExam && <span className="ec-tr-tag is-exam">考試</span>}
        {unit.status !== 'active' && <span className="ec-tr-tag">{TAG[unit.status]}</span>}
      </button>
      {!open && unit.count !== null && <span className="ec-tr-due" data-m={unit.color}>{unit.count}</span>}
      {open && active && <span className="ec-tr-ub">
        <button type="button" className="ec-u-btn" disabled={unit.today === 0} onClick={() => { start({ unit: unit.key }); }}><Icon type="play" size={12} />當日卡 {unit.today}</button>
        <button type="button" className="ec-u-btn" disabled={unit.targets.length === 0} onClick={() => { start({ unit: unit.key, since: Date.now() }); }}><Icon type="play" size={12} />全部卡 {unit.targets.length}</button>
        {marks && (unit.code === null
          ? <QuizButton {...props} input={{ deck: unit.decks[0].path }} at={{ deck: unit.decks[0].path }} />
          : <QuizButton {...props} input={{ unit: { term: unit.term ?? '', subject: unit.subject ?? '', code: unit.code } }} at={{ unit: unit.key }} />)}
      </span>}
    </div>
    {open && <div className="ec-tr-open">
      {listed.map(deck => {
        const count = state()?.deckTargets(deck.path).length ?? 0;
        return <div key={deck.path} className="ec-tr-pc">
          <button type="button" className="ec-tr-deck" onClick={() => { openNote(deck.path); }}><span>{deckLabel(deck, unit.decks)}</span></button>
          {several && <button type="button" className="ec-u-btn" disabled={count === 0} onClick={() => { start({ deck: deck.path, since: Date.now() }); }}><Icon type="play" size={12} />全部卡 {count}</button>}
          {deckQuiz(deck) && <QuizButton {...props} input={{ deck: deck.path }} at={deckRef(deck)} />}
          {statusButton(deck)}
        </div>;
      })}
      {unit.problems.map(problem =><button key={problem.kind} type="button" className="ec-tr-problem" onClick={() => { openNote(problem.path, problem.line); }}>{problem.count} 個{PROBLEM[problem.kind]}</button>)}
      {unit.targets.length > 0 && <ul className="ec-tr-ts">
        {unit.targets.map(target => <li key={target.id} className="ec-tr-t">
          <i className="ec-tr-dot" data-m={target.color} />
          <span>{target.name}{target.from && <small className="ec-tr-from">來自{target.from}</small>}</span>
        </li>)}
      </ul>}
      {rest.map(deck => {
        const link = <button key={deck.path} type="button" className="ec-tr-deck" onClick={() => { openNote(deck.path); }}><span>{deckLabel(deck, unit.decks)}</span>{deck.status !== 'active' && <span className="ec-tr-tag">{TAG[deck.status]}</span>}</button>;
        const button = statusButton(deck);
        return button ? <div key={deck.path} className="ec-tr-pc">{link}{button}</div> : link;
      })}
    </div>}
  </>;
}
