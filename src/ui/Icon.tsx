export function Icon({ type }: { type: 'book' | 'bulb' | 'speaker' | 'muted' | 'check' | 'back' | 'close' | 'forward' | 'flag' }): React.JSX.Element {
  const paths: Record<typeof type, React.JSX.Element> = {
    flag: <path d="M5 21V4M5 4h11l-2 4 2 4H5" />,
    // 記憶錨點（D-184）：燈泡。
    bulb: <path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.6 10.8c.6.5 1 1.2 1 2v.2h5.2v-.2c0-.8.4-1.5 1-2A6 6 0 0 0 12 3Z" />,
    book: <path d="M12 5v15M12 5C8 2 3 3 2 4v15c4-2 7-1 10 1 3-2 6-3 10-1V4c-4-2-7-1-10 1Z" />,
    speaker: <path d="m11 4-6 5H2v6h3l6 5ZM15 8c2 2 2 6 0 8M18 5c4 4 4 10 0 14" />,
    // 自動朗讀關掉（D-188 第 4 點）：同一個喇叭，聲波換成 ×。
    muted: <path d="m11 4-6 5H2v6h3l6 5ZM15.5 9.5l5 5M20.5 9.5l-5 5" />,
    check: <path d="m4 12 5 5L20 6" />,
    back: <path d="m15 5-7 7 7 7" />,
    forward: <path d="m9 5 7 7-7 7" />,
    close: <path d="M6 6l12 12M18 6 6 18" />,
  };
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[type]}</svg>;
}
