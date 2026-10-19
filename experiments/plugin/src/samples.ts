export interface Card { front: string; back: string; kind: 'qa' | 'cloze' | 'typing'; lt: string; v: string; en?: boolean; spell?: string; say?: string; isNew?: boolean; }
const long = Array.from({ length: 15 }, (_, i) => '**觀察 ' + (i + 1) + '**\n\n把少量色水滴入透明水杯，不攪拌，觀察顏色如何慢慢散開。每次只改變水溫，並保持水量和色水量相同，才能比較擴散的快慢。\n\n').join('');
const data: Omit<Card, 'lt' | 'v'>[] = [
  { kind: 'qa', front: '比較兩杯水的密度，需要知道哪些量？', back: '需要知道水的**質量**與**體積**。\n\n---\n\n密度表示單位體積的質量。', isNew: true },
  { kind: 'cloze', front: '密度等於==質量==除以==體積==。', back: '比較時記得先統一單位。' },
  { kind: 'typing', front: 'May I ==borrow== your ruler?（借入）', back: '向別人借入東西用 **borrow**。', spell: 'borrow', en: true, say: 'May I borrow your ruler?' },
  { kind: 'qa', front: '如何公平比較不同水溫的擴散速度？', back: long },
  { kind: 'qa', front: '兩杯水之間的箭頭代表什麼操作？\n\n![[t2-小圖.png]]', back: '把少量色水加入另一杯水，觀察變化。\n\n![[t2-大圖.png]]' },
  { kind: 'qa', front: '公式 $\\rho = \\frac{m}{V}$ 的三個符號代表什麼？', back: '**密度、質量、體積**。\n\n$$\\rho = \\frac{20\\,g}{10\\,cm^3} = 2\\,g/cm^3$$' },
  { kind: 'qa', front: '聽聽三個不同高度的音。', back: '![[t2-音.wav]]\n\n音高依序上升。' },
  { kind: 'qa', front: 'observe', back: '**觀察**\n\n---\n\nObserve the color of the water.\n\n觀察水的顏色。', en: true, say: 'observe', isNew: true },
  { kind: 'cloze', front: 'Keep the ==volume== the same and change the ==temperature==.', back: '控制水量，只改變溫度。', en: true },
  { kind: 'typing', front: 'Please ==measure== the water.（測量）', back: '**measure** 表示測量。', spell: 'measure', en: true, say: 'Please measure the water.' },
  { kind: 'qa', front: '同樣質量、較小體積的物體，密度較大還是較小？', back: '**較大**。\n\n---\n\n質量固定時，體積越小，每單位體積的質量越大。' },
  { kind: 'qa', front: '一杯水的質量是 50 g，體積是 50 cm³。密度是多少？', back: '**1 g/cm³**。\n\n$$\\rho = \\frac{50}{50} = 1$$' }
];
// 固定自編題的 SHA-256 前 8 碼；先合併空白，填空只取整行，詳解與附件補充不計入。
const fingerprints = ["4edb7010","1714603e","e71277dc","361d661e","85f7d1ba","af58ff24","9d0dd437","ef3cb98f","518faf92","0b1a5299","fec3880b","408165ba"];
export const samples: Card[] = data.map((c, i) => ({ ...c, lt: 't2' + i.toString(36).padStart(4, '0'), v: fingerprints[i] }));
export const SOURCE = 'Essence-T2/轉錄稿.md';

