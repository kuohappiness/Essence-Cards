import { Component, MarkdownRenderer, type App } from 'obsidian';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { postProcess } from './rendered.ts';

// 卡片的內容交給 Obsidian 渲染（D-052、D-109、W6 §3-3）：圖片、公式、音檔照樣呈現；sourcePath 是卡組的路徑。
// 填空題：渲染後把 <mark> 換成空格（一條底線，翻面後答案在同一條線上淡入）。
// 打字卡：題目裡第一處 ＿＿ 換成幾條一樣長的線，條數是答案的字數（D-122）；翻面後答案的字照順序寫在線上。
// 線包在 .ec-slot 裡，打字時輸入框放進同一格（D-145：在空格裡直接打字），由 onSlot 交給複習畫面。
// 渲染後的處理（空格、換行、冠詞、喇叭的位置）在 rendered.ts。

export interface MarkdownProps {
  app: App;
  text: string;
  sourcePath: string;
  /** cloze：<mark> 變空格；typed：＿＿ 變幾條線。 */
  mode?: 'plain' | 'cloze' | 'typed';
  /** 翻面後：填空的答案出現；打字卡的字寫在線上。 */
  revealed?: boolean;
  /** 打字卡：線的條數與寫在線上的字（照空白切）。 */
  lines?: number;
  words?: readonly string[];
  /** 渲染失敗（錯誤已記在 console）：交出錯誤與 sourcePath，由主機記進錯誤紀錄（D-155）。 */
  onFail?: (error: unknown, sourcePath: string) => void;
  /** 渲染好（第一張卡畫好的量測用）。 */
  onReady?: () => void;
  className?: string;
  /** 打字卡渲染好：空格（.ec-slot）交給複習畫面放輸入框；題目裡找不到 ＿＿ 時是 null。 */
  onSlot?: (slot: HTMLElement | null) => void;
  /** 接在最後一個字後面的東西（喇叭，D-145）：和最後一個字包在一起，換行時不會單獨掉到下一行。 */
  tail?: React.ReactNode;
  /** 英文卡的題目：冠詞和後面的字連在一起換行（glueArticles）。 */
  english?: boolean;
}

function applyState(container: HTMLElement, props: MarkdownProps): void {
  const revealed = !!props.revealed;
  for (const blank of Array.from(container.querySelectorAll<HTMLElement>('.ec-blank'))) {
    blank.classList.toggle('ec-filled', revealed);
    blank.setAttribute('aria-label', revealed ? blank.textContent ?? '' : '空格');
  }
  const lines = container.querySelectorAll<HTMLElement>('.ec-line');
  lines.forEach((line, index) => {
    line.classList.toggle('ec-filled', revealed);
    const word = line.querySelector<HTMLElement>('.ec-line-word');
    if (word) word.textContent = revealed ? props.words?.[index] ?? '' : '';
  });
}

export function Markdown(props: MarkdownProps): React.JSX.Element {
  const host = useRef<HTMLDivElement>(null);
  const latest = useRef(props);
  latest.current = props;
  const [tailEl, setTailEl] = useState<HTMLElement | null>(null);
  const { app, text, sourcePath, mode = 'plain', lines = 0 } = props;
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const component = new Component();
    component.load();
    let active = true;
    const container = document.createElement('div');
    container.className = 'ec-markdown';
    element.replaceChildren(container);
    void (async () => {
      try {
        await MarkdownRenderer.render(app, text, container, sourcePath, component);
        if (!active) return;
        const { slot, tail } = postProcess(container, { mode, lines, english: !!latest.current.english });
        applyState(container, latest.current);
        // 一律先包好最後一個字：英翻中的喇叭在翻面前就有，中翻英的在答案出現後才有，不用為此重新渲染。
        setTailEl(tail);
        if (mode === 'typed') latest.current.onSlot?.(slot);
        latest.current.onReady?.();
      } catch (error) {
        console.error('Essence Cards：卡片顯示不出來', sourcePath, error);
        if (!active) return;
        container.replaceChildren();
        const note = document.createElement('p');
        note.className = 'ec-render-failed';
        note.textContent = '這張卡顯示不出來';
        container.append(note);
        latest.current.onFail?.(error, sourcePath);
      }
    })();
    return () => {
      active = false;
      component.unload();
      for (const audio of Array.from(container.querySelectorAll('audio'))) audio.pause();
      container.remove();
      setTailEl(null);
    };
  }, [app, text, sourcePath, mode, lines]);
  // 翻面：不重新渲染，只切換空格與線上的字。
  useLayoutEffect(() => {
    const container = host.current?.querySelector<HTMLElement>('.ec-markdown');
    if (container) applyState(container, props);
  }, [props.revealed, props.words, props]);
  return <>
    <div className={'ec-markdown-host' + (props.className ? ' ' + props.className : '')} ref={host} />
    {tailEl && props.tail ? createPortal(props.tail, tailEl) : null}
  </>;
}
