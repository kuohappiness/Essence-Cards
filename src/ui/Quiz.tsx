import { useEffect, useRef, useState } from 'react';
import { checkQuizDate, COPIES_NOTE, quizButton, quizChoices, quizFailure } from '../review/index.ts';
import type { QuizButtonView, QuizRowView } from '../review/index.ts';
import type { QuizInput, QuizRef, QuizResult, QuizRow } from '../state/index.ts';
import { Icon } from './entry-icon.tsx';
import type { EntryProps } from './Entry.tsx';
import { DateField } from './ExamScope.tsx';

// 小考（tasks/quiz-mark.md §3、§4）：入口最上面的一列、目錄的按鈕。字與規則在 review/quiz.ts，檔的讀寫在 state。

type Actions = Pick<EntryProps, 'state' | 'start' | 'openNote' | 'notify'>;

/** 同一個識別碼、兩份不一樣（§1）：列出來請家長留下對的那一份，不自己挑。 */
function QuizCopies({ row, openNote }: { row: QuizRow; openNote: EntryProps['openNote'] }): React.JSX.Element {
  return <div className="ec-qz-copies">
    {COPIES_NOTE}
    <ul>{row.paths.map(path => <li key={path}><button type="button" onClick={() => { openNote(path); }}>{path}</button></li>)}</ul>
  </div>;
}

/** 入口那一列（§4）。正常的按全部卡；待修正的寫原因，點了打開那份檔（兩份不一樣的列出兩份）。 */
/** Esc 先收起選單或列出的兩份（L2 R4）：焦點還在按鈕上時事件不經過選單，所以收在包住兩者的那一層，收起後焦點回到按鈕。 */
function useEscape(open: boolean, close: () => void): { trigger: React.RefObject<HTMLButtonElement | null>; onKey: (event: React.KeyboardEvent) => void } {
  const trigger = useRef<HTMLButtonElement>(null);
  const onKey = (event: React.KeyboardEvent): void => {
    if (!open || event.key !== 'Escape' || event.nativeEvent.isComposing) return;
    // 只收起這一層，不離開目錄、不關掉入口。
    event.stopPropagation();
    close();
    trigger.current?.focus();
  };
  return { trigger, onKey };
}

export function QuizEntryRow({ row, state, start, openNote, notify }: Actions & { row: QuizRowView }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const { trigger, onKey } = useEscape(open, () => { setOpen(false); });
  const title = row.subject ? `${row.subject} ${row.name}` : row.name;
  const practice = <button type="button" className="ec-sb-btn" disabled={row.problem !== null || row.count === 0} onClick={() => { const ref = row.refs[0]; start({ ...ref, since: Date.now() }); }}><Icon type="play" size={14} /><span>全部卡 {row.count}</span></button>;
  const line = <i className="ec-sb-bar" aria-hidden="true" />;
  const cancel = (): void => {
    // 擋下來的原因交給通知：這一列沒有放字的地方，也不用留著。
    void state()?.cancelQuiz(row).then(result => { if (result.kind !== 'done') notify(quizFailure(result)); });
  };
  const quiet = row.cancellable && <button type="button" className="ec-qz-quiet" onClick={cancel}>取消</button>;
  if (row.problem === null) return <div className="ec-sb ec-qz">
    <span className="ec-sb-left">
      <span className="ec-en-name">{title}</span>
      <span className="ec-sb-ex">{row.when}</span>
    </span>
    {row.cancellable ? <span className="ec-qz-side">{practice}{quiet}</span> : practice}
    {line}
  </div>;
  const copies = row.problem === 'copies';
  return <div className="ec-sb ec-qz" onKeyDown={onKey}>
    <button ref={trigger} type="button" className="ec-qz-fix" aria-expanded={copies ? open : undefined} onClick={() => { if (copies) setOpen(!open); else openNote(row.paths[0]); }}>
      <span className="ec-en-name">{title}</span>
      {row.when !== null && <span className="ec-sb-ex">{row.when}</span>}
      <span className="ec-sb-ex is-warn">{row.word}</span>
      {row.repair !== null && <span className="ec-qz-hint">{row.repair}</span>}
    </button>
    {(row.problem === 'unmatched' || row.cancellable) && <span className="ec-qz-side">
      {row.problem === 'unmatched' && practice}
      {quiet}
    </span>}
    {open && <QuizCopies row={row} openNote={openNote} />}
    {line}
  </div>;
}

/** 目錄的「小考」按鈕（§3）：按下去選日期；設好之後寫日期，再按一次可以改或取消；只有壞掉的檔時寫原因，點了去修。 */
export function QuizButton({ state, openNote, input, at }: Pick<EntryProps, 'state' | 'openNote'> & { input: QuizInput; at: QuizRef }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const { trigger, onKey } = useEscape(open, () => { setOpen(false); });
  const view = quizButton(state(), at);
  const warn = view.kind === 'problem' ? ' is-warn' : '';
  const press = (): void => {
    if (view.kind === 'problem' && view.row.problem !== 'copies') openNote(view.row.paths[0]);
    else setOpen(!open);
  };
  return <span className="ec-qz-ctl" onKeyDown={onKey}>
    <button ref={trigger} type="button" className={'ec-u-btn' + warn} aria-expanded={open} onClick={press}>{view.label}</button>
    {open && (view.kind === 'problem'
      ? <QuizCopies row={view.row} openNote={openNote} />
      : <QuizMenu state={state} openNote={openNote} view={view} input={input} close={() => { setOpen(false); }} />)}
  </span>;
}

const CHANGED = quizFailure({ kind: 'blocked', reason: 'changed' });

function QuizMenu({ state, openNote, view, input, close }: Pick<EntryProps, 'state' | 'openNote'> & { view: Exclude<QuizButtonView, { kind: 'problem' }>; input: QuizInput; close: () => void }): React.JSX.Element | null {
  // 打開選單時的那一次小考（L2 R3）：之後的改日期與取消都對它做。別台裝置取消、同一個目標換成另一份時，不悄悄改成建新的或改另一份。
  const [opened] = useState(view.row);
  const [other, setOther] = useState(false);
  const [typed, setTyped] = useState(view.row?.date ?? '');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const current = state();
  if (!current) return null;
  const { day } = current.exam();
  async function run(work: () => Promise<QuizResult>): Promise<void> {
    setBusy(true);
    setFailure(null);
    const result = await work();
    if (!alive.current) return;
    setBusy(false);
    if (result.kind === 'done') close();
    else setFailure(quizFailure(result));
  }
  const set = (date: string): void => { void run(() => current.setQuiz(input, date, opened)); };
  const check = checkQuizDate(typed, day);
  // 自己按的還在寫時，畫面先看到自己的結果，不算別處改的。
  if (!busy && (view.row?.key ?? null) !== (opened?.key ?? null)) return <div className="ec-qz-menu">
    <p className="ec-sc-word is-bad" role="alert">{CHANGED}</p>
  </div>;
  return <div className="ec-qz-menu">
    <div className="ec-qz-days">
      {quizChoices(day).map(choice => <button key={choice.label} type="button" className="ec-u-btn" disabled={busy} onClick={() => { set(choice.date); }}>{choice.label}</button>)}
      <button type="button" className="ec-u-btn" aria-expanded={other} disabled={busy} onClick={() => { setOther(!other); }}>其他日期</button>
      {opened && <button type="button" className="ec-u-btn is-quiet" disabled={busy} onClick={() => { void run(() => current.cancelQuiz(opened)); }}>取消小考</button>}
    </div>
    {other && <form className="ec-qz-other" onSubmit={event => { event.preventDefault(); if (check.date !== null && !busy) set(check.date); }}>
      <DateField label="日期" name="小考日期" hint="例如 2026-11-07" value={typed} set={setTyped} bad={check.word !== null} />
      {check.word !== null && <p className="ec-sc-word is-bad">{check.word}</p>}
      <button type="submit" className="ec-qz-ok" disabled={busy || check.date === null}>確定</button>
    </form>}
    {view.others.map(row => <button key={row.key} type="button" className="ec-tr-problem" onClick={() => { openNote(row.paths[0]); }}>另有一份小考日期有問題：{row.paths[0]}</button>)}
    {failure !== null && <p className="ec-sc-word is-bad" role="alert">{failure}</p>}
  </div>;
}
