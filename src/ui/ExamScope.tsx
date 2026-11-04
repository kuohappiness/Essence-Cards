import { useEffect, useRef, useState } from 'react';
import { checkDates, examFailure, examForm, formChange, normalDate, ORDER_WORD, toggleRow } from '../review/index.ts';
import type { ExamForm, ScopeRow } from '../review/index.ts';
import type { ScopeCheck } from '../state/index.ts';
import { Icon } from './entry-icon.tsx';
import type { EntryProps } from './Entry.tsx';

// 設定考試範圍（tasks/exam-scope.md §6、§8）：入口全螢幕的第三個畫面。勾選連動、變動與日期的規則都在 review/exam-form.ts。

const TAG = { draft: '草稿', paused: '暫停' } as const;
/** §8 每一類最多列幾個；總數還是實際的數字。 */
const LIST_LIMIT = 20;
const DONE = '考試範圍已設定';
const DONE_PAST = '已存，這個日期已經過了，不會生效';
const ENDED = '這次考試已結束';

export function ExamScope(props: EntryProps & { version: number }): React.JSX.Element {
  const { store } = props;
  const back = (): void => { store.go(store.from()); };
  // 使用者還沒動之前跟著最新的資料（還在讀 → 讀完、別台裝置改了）；動了之後固定，交出去的是變動（§2-4）。
  const [touched, setTouched] = useState(false);
  const [form, setForm] = useState<ExamForm | null>(() => examForm(props.state()));
  const [checked, setChecked] = useState<ReadonlySet<string>>(() => form?.checked ?? new Set());
  const [start, setStart] = useState(form?.start ?? '');
  const [end, setEnd] = useState(form?.end ?? '');
  useEffect(() => {
    if (touched) return;
    const next = examForm(props.state());
    setForm(next);
    if (next) {
      setChecked(next.checked);
      setStart(next.start);
      setEnd(next.end);
    }
  }, [props.version, touched]);
  const nav = <div className="ec-en-top is-nav">
    <button type="button" className="ec-ico" aria-label="返回" onClick={back}><Icon type="back" /></button>
    <h1 className="ec-en-title">考試範圍與日期</h1>
    <button type="button" className="ec-ico" aria-label="關閉考試範圍" onClick={back}><Icon type="close" /></button>
  </div>;
  if (!form) return <>{nav}<div className="ec-en-scroll"><p className="ec-en-none">正在讀取卡組…</p></div></>;
  const touch = (work: () => void): void => { setTouched(true); work(); };
  return <>
    {nav}
    <Editor state={props.state} notify={props.notify} openNote={props.openNote} form={form} checked={checked} from={start} to={end} back={back}
      setChecked={value => { touch(() => { setChecked(value); }); }}
      setFrom={value => { touch(() => { setStart(value); }); }}
      setTo={value => { touch(() => { setEnd(value); }); }} />
  </>;
}

interface EditorProps extends Pick<EntryProps, 'state' | 'notify' | 'openNote'> {
  form: ExamForm;
  checked: ReadonlySet<string>;
  from: string;
  to: string;
  back: () => void;
  setChecked: (value: ReadonlySet<string>) => void;
  setFrom: (value: string) => void;
  setTo: (value: string) => void;
}

function Editor(props: EditorProps): React.JSX.Element {
  const { form, checked, from, to, back, notify, state } = props;
  const [closedTerms, setClosedTerms] = useState<Record<string, boolean>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [armed, setArmed] = useState(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const current = state();
  const day = current?.exam().day ?? 0;
  const dates = checkDates(from, to, day);
  const change = formChange(form, checked, from, to);
  const blocked = dates.start !== null || dates.end !== null || dates.order;
  async function run(work: () => Promise<Parameters<typeof examFailure>[0] | { kind: 'done' }>, message: string): Promise<void> {
    setBusy(true);
    setFailure(null);
    const result = await work();
    if (!alive.current) return;
    setBusy(false);
    if (result.kind === 'done') {
      notify(message);
      back();
    } else setFailure(examFailure(result));
  }
  const save = (): void => {
    if (!current) return;
    props.setFrom(normalDate(from));
    props.setTo(normalDate(to));
    // 用按下去這一刻的複習日：畫面可能還停在跨過 4 點之前。
    const past = checkDates(from, to, current.exam().day).past;
    void run(() => current.setExam(change, form), past ? DONE_PAST : DONE);
  };
  const finish = (): void => {
    if (!armed) { setArmed(true); return; }
    if (current) void run(() => current.endExam(form), ENDED);
  };
  return <>
    <div className="ec-en-scroll">
      {form.preset && <p className="ec-sc-lead">勾選這次要考的單元；最近學的已經先勾好了。</p>}
      {form.unknown && <p className="ec-sc-other">考試範圍暫時讀不到，等一下再試</p>}
      {form.others.map(path => <p key={path} className="ec-sc-other">還有另一份也生效：{path}</p>)}
      {form.terms.map(term => {
        const open = !(closedTerms[term.term] ?? term.term !== form.latest);
        return <div key={term.term} className="ec-tr-group">
          <button type="button" className={'ec-tr-sem' + (open ? ' is-open' : '')} aria-expanded={open} onClick={() => { setClosedTerms({ ...closedTerms, [term.term]: open }); }}><span>{term.term}</span><Icon type="next" size={16} /></button>
          {open && term.subjects.map(subject => <section key={subject.subject}>
            <div className="ec-tr-sh"><h2 className="ec-tr-subject">{subject.subject}</h2></div>
            {subject.rows.map(row => <Row key={row.key} row={row} on={checked.has(row.key)} set={on => { props.setChecked(toggleRow(checked, row, on)); }} />)}
          </section>)}
        </div>;
      })}
      {form.unreadable.length + form.category.length > 0 && <section className="ec-sc-raw">
        <h2>範圍檔裡的其他行</h2>
        {form.unreadable.map((raw, at) => <p key={'u' + String(at)}>{raw}<small>這一行看不懂，不會算進範圍，會留著；一行只寫一個編號</small></p>)}
        {form.category.map((raw, at) => <p key={'c' + String(at)}>{raw}<small>這一行目前不支援</small></p>)}
      </section>}
      {current && <Checks check={current.examCheck(change)} openNote={props.openNote} />}
    </div>
    <div className="ec-sc-dock">
      <DateField label="開始" value={from} set={props.setFrom} bad={dates.start !== null || dates.order} />
      {dates.start !== null && <p className="ec-sc-word is-bad">{dates.start}</p>}
      <DateField label="結束" value={to} set={props.setTo} bad={dates.end !== null || dates.order} />
      {dates.end !== null && <p className="ec-sc-word is-bad">{dates.end}</p>}
      {dates.order && <p className="ec-sc-word is-bad">{ORDER_WORD}</p>}
      {dates.past && <p className="ec-sc-word">這個日期已經過了，不會排進今天的複習</p>}
      <p className="ec-sc-tip">填了考試期間，考前會自動多複習範圍內的卡，考完自動取消。</p>
      {failure !== null && <p className="ec-sc-word is-bad" role="alert">{failure}</p>}
      <button type="button" className="ec-sc-ok" disabled={busy || blocked || checked.size === 0} onClick={save}>確定</button>
      {form.usable && <button type="button" className={'ec-sc-end' + (armed ? ' is-armed' : '')} disabled={busy} onClick={finish} onBlur={() => { setArmed(false); }}>{armed ? '再按一次結束這次考試' : '結束這次考試'}</button>}
    </div>
  </>;
}

function Row({ row, on, set }: { row: ScopeRow; on: boolean; set: (on: boolean) => void }): React.JSX.Element {
  // 讀回來和要寫的不一樣：不能用勾選加入（§2-4）；已經在範圍裡的可以取消。
  const off = !row.writable && !on;
  return <label className={'ec-sc-u' + (off ? ' is-off' : '')}>
    <input type="checkbox" className="ec-cb" checked={on} disabled={off} onChange={event => { set(event.currentTarget.checked); }} />
    <span className="ec-sc-name">
      <span>{row.label}</span>
      {row.status !== null && <span className="ec-tr-tag">{TAG[row.status]}</span>}
      {row.kind === 'extra' && <span className="ec-tr-tag">還沒有卡組</span>}
      {off && <span className="ec-sc-why">這個單元的屬性寫法特殊，不能用勾選加入</span>}
    </span>
  </label>;
}

function DateField({ label, value, set, bad }: { label: string; value: string; set: (value: string) => void; bad: boolean }): React.JSX.Element {
  const normal = normalDate(value);
  return <div className="ec-sc-date">
    <label>{label}</label>
    <input type="text" aria-label={'考試' + label} className={bad ? 'is-bad' : ''} placeholder="選填，例如 2026-10-28" value={value}
      onChange={event => { set(event.currentTarget.value); }} onBlur={() => { if (normal !== value) set(normal); }} />
    <span className="ec-sc-pick">
      <Icon type="calendar" />
      <input type="date" tabIndex={-1} aria-label={'用日曆選' + label + '日'} value={/^\d{4}-\d{2}-\d{2}$/.test(normal) ? normal : ''} onChange={event => { set(event.currentTarget.value); }} />
    </span>
  </div>;
}

function Checks({ check, openNote }: { check: ScopeCheck | null; openNote: (path: string, line?: number) => void }): React.JSX.Element | null {
  if (!check || (!check.fromOther.length && !check.unsure.length)) return null;
  return <section className="ec-sc-check">
    <CheckList title={`這次範圍裡有 ${String(check.fromOther.length)} 個目標來自別的單元`} items={check.fromOther.map(each => ({ key: each.id, text: `第 ${String(each.line + 1)} 行〈${each.name}〉：來自${each.own}`, path: each.path, line: each.line }))} openNote={openNote} />
    <CheckList title={`${String(check.unsure.length)} 個出處還不確定`} items={check.unsure.map(each => ({ key: each.id, text: `第 ${String(each.line + 1)} 行〈${each.name}〉：${each.source}（${each.reasons.join('、')}）`, path: each.path, line: each.line }))} openNote={openNote} />
  </section>;
}

function CheckList({ title, items, openNote }: { title: string; items: { key: string; text: string; path: string; line: number }[]; openNote: (path: string, line?: number) => void }): React.JSX.Element | null {
  const [open, setOpen] = useState(false);
  if (!items.length) return null;
  return <div>
    <button type="button" className="ec-sc-go" aria-expanded={open} onClick={() => { setOpen(!open); }}><span>{title}</span><Icon type="next" size={16} /></button>
    {open && <ul className="ec-sc-list">
      {items.slice(0, LIST_LIMIT).map(item => <li key={item.key}><button type="button" className="ec-sc-item" onClick={() => { openNote(item.path, item.line); }}>{item.text}</button></li>)}
    </ul>}
    {open && items.length > LIST_LIMIT && <p className="ec-sc-more">另有 {items.length - LIST_LIMIT} 個</p>}
  </div>;
}
