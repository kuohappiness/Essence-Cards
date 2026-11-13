import { anchorParts, questionOf, RATING_LABELS } from '../review/index.ts';
import type { CardView, PickView } from '../review/index.ts';
import { Markdown } from './Markdown.tsx';
import { Rates, type BodyProps, type BottomProps, type Screen } from './screen.tsx';

// 點選填空的畫面（tasks/question-type-seam.md §7、D-182、D-179）：沒有 hook，狀態都在 review/pick.ts。樣式在 PickCard.css。

/** 這張卡的組與目前的狀態；只有比較卡會走到這裡。 */
function partsOf(view: CardView): { pick: PickView; group: NonNullable<CardView['card']['group']> } {
  const { pick } = view, { group } = view.card;
  if (!pick || !group) throw Error('比較卡沒有作答的狀態');
  return { pick, group };
}

/** 字從字鍵飛到空格（示意頁的 flyTo）：可有可無，尊重 prefers-reduced-motion；手機切到背景時動畫可能停住，分身不能留在畫面上。 */
function fly(button: HTMLElement, index: number): void {
  if (typeof button.animate !== 'function' || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const root = button.closest('.ec-app');
  const slot = root?.querySelector(`.ec-pick-slot[data-index="${String(index)}"]`);
  if (!root || !slot) return;
  const from = button.getBoundingClientRect(), to = slot.getBoundingClientRect();
  const clone = document.createElement('span');
  clone.className = 'ec-pick-fly';
  clone.textContent = button.textContent;
  root.append(clone);
  const size = clone.getBoundingClientRect();
  const point = (box: DOMRect): string => `${String(box.left + box.width / 2 - size.width / 2)}px,${String(box.top + box.height / 2 - size.height / 2)}px`;
  const motion = clone.animate([
    { transform: `translate(${point(from)}) scale(1)`, opacity: 1 },
    { transform: `translate(${point(to)}) scale(.7)`, opacity: .35 },
  ], { duration: 150, easing: 'ease-out' });
  const remove = (): void => { clone.remove(); };
  motion.onfinish = remove;
  motion.oncancel = remove;
  window.setTimeout(remove, 400);
}

const MARKS: Partial<Record<PickView['cells'][number]['state'], string>> = { right: '✓', near: '✓', miss: '✕', retry: '✕' };

type Row = NonNullable<CardView['card']['group']>['rows'][number];

/** 對照的順序（D-203 第 3 點）：考到的照句子的順序，沒考到的照組裡的順序接在後面。 */
function compareOrder(rows: readonly Row[], tested: readonly (string | null | undefined)[]): Row[] {
  const first = tested.flatMap(answer => rows.filter(row => row.member === answer));
  return [...new Set([...first, ...rows])];
}

function PickBody({ view, app, act, onPainted, onFail }: BodyProps): React.JSX.Element {
  const { card } = view;
  const { pick, group } = partsOf(view);
  return <article className="ec-card ec-pick" lang="zh-Hant">
    <div className="ec-meta">{card.isNew && <span className="ec-new">新</span>}<span>{view.crumb}</span></div>
    <p className="ec-pick-title">{group.title ? `${group.title}：${group.members.join('、')}` : group.members.join('、')}</p>
    <ul className="ec-pick-rows">{card.blanks.map((blank, index) => {
      const cell = pick.cells[index];
      const movable = pick.stage === 'answer' || (pick.stage === 'retry' && cell.state === 'retry');
      return <li key={blank.prompt.fingerprint + String(index)} className={'ec-pick-row' + (index === pick.cursor ? ' is-on' : '') + (movable ? '' : ' is-locked')} onClick={() => { act({ kind: 'row', index }); }}>
        <span className="ec-pick-mark" data-state={cell.state}>{MARKS[cell.state] ?? ''}</span>
        <div className="ec-pick-text">
          <Markdown app={app} text={questionOf(blank.prompt)} sourcePath={card.deck} mode="pick"
            slotNode={<button type="button" className="ec-pick-slot" data-state={cell.state} data-index={index} aria-label={`第 ${String(index + 1)} 格`}>{cell.state === 'retry' ? <s>{cell.text}</s> : cell.text || '　'}</button>}
            onReady={index === 0 ? onPainted : undefined} onFail={(error, path) => { onFail('front', error, path); }} />
        </div>
      </li>;
    })}</ul>
    {/* 對照（D-203）：上下排、不標結果；這次考到的照句子的順序排前面 */}
    {pick.stage === 'result' && <div className="ec-pick-compare ec-answer">{compareOrder(group.rows, card.blanks.map(blank => blank.answer)).map(row => {
      const parts = row.anchor === null ? null : anchorParts(row.anchor);
      return <div key={row.member} className="ec-cmp">
        <span className="ec-cmp-ch">{row.member}</span>
        <span className="ec-cmp-why">
          {parts && <Markdown app={app} text={parts.why} sourcePath={card.deck} revealed onFail={(error, path) => { onFail('back', error, path); }} />}
          {parts?.words && <span className="ec-cmp-words">{parts.words}</span>}
        </span>
      </div>;
    })}</div>}
  </article>;
}

/**
 * 字鍵幾個一排（D-182 第 6 點）：一個字的 6 個以內一排、7 個以上兩排。
 * 詞比字長（375 寬實測：6 個一排一格 52px，give up 超出字鍵）：一排最多 4 個，5、6 個排成兩排各 3 個。
 */
function keyColumns(count: number, words: boolean): number {
  if (!words) return count <= 6 ? count : Math.ceil(count / 2);
  if (count <= 4) return count;
  return count <= 6 ? 3 : 4;
}

/** 字鍵與兩個動作（§7）：手指最常停的地方，字鍵在上，動作在下，中間留空，連點才不會誤按「對答案」。 */
function Tray({ view, animating, act, focusApp }: BottomProps): React.JSX.Element {
  const { pick, group } = partsOf(view);
  const retrying = pick.stage === 'retry';
  const cursor = pick.cursor;
  // 用滑鼠或手指點完，焦點回到畫面：Space、Enter 才是「對答案」，不是再按一次這個字鍵。Tab 過來用鍵盤按的（detail 是 0）留在原處。
  const after = (event: React.MouseEvent): void => { if (event.detail > 0) focusApp(); };
  const words = group.keys.some(key => [...key].length > 1);
  return <div className="ec-pick-tray">
    <div className={'ec-pick-keys' + (words ? ' is-words' : '')} style={{ '--ec-pick-columns': String(keyColumns(group.keys.length, words)) } as React.CSSProperties}>
      {group.keys.map(key => <button key={key} type="button" className="ec-pick-key" disabled={animating || key === pick.spent} onClick={event => {
        const target = cursor;
        act({ kind: 'key', key });
        if (target !== null) fly(event.currentTarget, target);
        after(event);
      }}>{key}</button>)}
    </div>
    <div className="ec-pick-acts">
      <button type="button" className="ec-pick-act ec-pick-skip" disabled={animating} onClick={event => { act({ kind: 'skip' }); after(event); }}>{RATING_LABELS.miss}</button>
      <button type="button" className={'ec-pick-act ec-pick-check' + (retrying ? ' is-again' : pick.filled ? ' is-ready' : '')} disabled={animating} onClick={event => {
        act({ kind: 'check' });
        if (!retrying && !pick.filled && typeof event.currentTarget.animate === 'function' && !matchMedia('(prefers-reduced-motion: reduce)').matches) event.currentTarget.animate([{ transform: 'none' }, { transform: 'scale(1.03)' }, { transform: 'none' }], { duration: 300 });
        after(event);
      }}>{retrying ? '再選一次' : '對答案'}</button>
    </div>
  </div>;
}

export const pickScreen: Screen = {
  Body: PickBody,
  bottom(props) {
    const { view, animating, rate, commit } = props;
    const { pick } = partsOf(view);
    if (pick.stage !== 'result') return <Tray {...props} />;
    // 回看：全對的能改評分；被停掉的只留當時按的；有錯的是程式判的，沒有按鈕。
    if (view.viewing) {
      const shown = view.allowed.length ? view.allowed : view.pressed ? [view.pressed] : [];
      return shown.length ? <Rates view={view} shown={shown} animating={animating} rate={rate} /> : null;
    }
    if (view.allowed.length) return <Rates view={view} shown={view.allowed} animating={animating} rate={rate} />;
    // 預覽下面已經有自己的「下一張」。
    return view.nextLabel ? null : <button type="button" className="ec-show" disabled={animating} onClick={commit}>下一張</button>;
  },
  tap() {},
  enter(view, { act, commit }) {
    const { pick } = partsOf(view);
    if (pick.stage === 'answer') act({ kind: 'check' });
    else if (pick.committable) commit();
  },
  stage: () => '',
};
