import fs from 'node:fs/promises';
import path from 'node:path';
import { exists, readJson, slug } from './core.mjs';

// 字形清單只做機械比對；不宣稱是完整的簡繁或用語判斷。
const simplified = new Set([...`万与专业东丝丢两严丧个丰临为丽举义乌乐乔习乡书买乱争于亏亚产亩亲亵亿仅从仑仓仪们价众优会伞伟传伤伦伪体余佣侠侣侥侧侦侨侩侪侬俣俦俭债倾偿储儿兑党兰关兴养兽内冈册写军农冯冲决况冻净凉减凑凛几凤凭凯击凿刍刘则刚创删别刬剂剑剥剧劝办务动励劲劳势勋匀匦匮区医华协单卖卢卤卧卫却厂厅历厉压厌厕厢厦厨厩县参双发变叠号叹叽吁吕吗吨听启吴呐呕员呛呜咏咙咛咝哑哒哓哗哙响哟唛唠啧啬啭啮啸喷嘱噜团园围囵国图圆圣场坏块坚坛坝坞坟坠垄垒垦垫垭垮埘埙埚堑墙壮声壳壶处备复够头夸夹夺奁奂奋奖奥妆妇妈妩妪姗娱娄娅娆娇娈婴婵婶媪嫒嫔嫱嬷孙学宁宝实宠审宪宫宽宾寝对寻导寿将尔尘尝尧尽层屉届属屡岁岂岖岗岚岛岭岳峄峡峤峥峦崂崃崭嵘嵚嵝巅巩币帅师帐帘帜带帧帮帱帻帼幂并广庄庆庐庑库应庙庞废廪开异弃张弥弯弹强归当录彻径徕忆忧怀态怂怃怄怅怆怜总怼怿恋恳恶恸恹恺恻恼恽悦悫悬悭悯惊惧惨惩惫惬惭惮惯愤愦愿慑懑懒懔戆戋戏戗战戬戯户扑执扩扫扬扰抚抛抟抠抡抢护报担拟拢拣拥拦拧拨择挚挛挞挟挠挡挢挣挤挥挦捞损捡换捣掳掴掷掸掺掼揽揿搀搁搂搅携摄摆摇摈摊撄撑撵撷撸撺敌敛数斋斓斗斩断无旧时旷旸昙昼昽显晋晒晓晔晕晖暂暧术朴机杀杂权条来杨杩杰极构枞枢枣枥枨枪枫枭柜柠柽栀栅标栈栉栊栋栌栎栏树样栾桠桡桢档桤桥桦桧桨桩梦梼梿检棂椁椟椠椤椭楼榄榅榇榈榉槛槟槠横樯樱橥橱橹橼檩欢欤欧歼殁殇残殒殓殚殡毁毂毕毙毡毵气氢氩氲汇汉汤沟没沣沤沥沦沧沪泞泪泶泷泸泺泻泼泽泾洁洒洼浃浅浆浇浈浊测浍济浏浑浒浓浔涛涝涞涟涡涣涤润涧涨涩渊渌渍渎渐渑渔渖渗温湾湿溃溅滚滞满滤滥滦滨滩潇潜潋潍澜濑濒灏灭灯灵灾灿炀炉炖炜炝点炼炽烁烂烃烛烟烦烧烨烩烫烬热焕焖焘煴爱爷牍牵犊状犷犸犹狈狞独狭狮狯狰狱狲猃猎猕猡猪猫猬献獭玑玛玮环现玱玺珐珑珰珲琎琏琐琼瑶瑷璎瓒瓮瓯电画畅畴疖疗疟疠疡疬疭疮疯疱疴痈痉痒痨痪痫瘅瘆瘗瘘瘪瘫瘾瘿癞癣癫皑皱皲盏盐监盖盗盘眍眦眬睁睐睑瞒瞩矫矿码砖砗砚砜砺砻砾础硁硕硖硗硙确硷碍碛碜礼祎祢祯祷祸禀禄禅离秃秆种积称秽秾稆税稣稳穑穷窃窍窑窜窝窥窦窭竖竞笃笋笔笕笺笼笾筚筛筜筝筹签简箓箦箧箨箩箪箫篑篓篮篱簖籁类籼粜粝粤粪粮糁糇糍糟糠糸紧纟纠纡红纣纤纥约级纨纩纪纫纬纭纯纰纱纲纳纵纶纷纸纹纺纽线绀练组绅细织终绉绊绌绍绎经绑绒结绕绘给绚绛络绝绞统绢绣绥绦继绩绪绫续绮绯绰绳维绵绶绷绸绺绻综绽绿缀缁缂缃缄缅缆缇缈缉缊缌缍缎缏缑缒缓缔缕编缗缘缙缚缛缜缝缟缠缡缢缣缤缥缦缧缨缩缪缫缬缭缮缯缰缱缲缳缴缵罂网罗罚罢羁翘耸耻聂聋职联聪肃肠肤肾肿胀胁胆胜胧胨胪胶脉脍脏脐脑脓脚脱脸腊腌腘腭腻腼腽腾膑臜舆舰舱艰艳艺节芈芗芜芦苁苇苈苋苌苍苎苏苹范茏茑茔茕茧荆荐荚荛荜荞荟荠荡荣荤荥荦荧荨荩荪荫药莅莱莲莳莴莶获莸莹莺莼萝萤营萦萧萨葱蒇蒉蒋蒌蓝蓟蓠蓣蓥蓦蔷蔹蔺蔼蕲蕴薮藓蘖虏虑虚虫虬虮虽虾虿蚀蚁蚂蚕蚬蛊蛎蛏蛮蛰蛱蛲蛳蛴蜕蜗蝇蝈蝉蝼蝾螀螨蟏衅衔补衬衮袄袅袜袭装裆裈裢裣裤裥褛褴襕见观规觅视觇览觉觊觋觌觎觏觐觑觞触誉誊计订讣认讥讦讧讨让讪训议讯记讲讳讴讵讶讷许讹论讼讽设访诀证诂诃评诅识诈诉诊诋诌词诎诏译诒诓诔试诗诘诙诚诛话诞诟诠诡询诣诤该详诧诨诩诫诬语诮误诰诱诲诳说诵诶请诸诹诺读诼诽课诿谀谁谂调谄谅谆谇谈谊谋谌谍谎谏谐谑谒谓谔谕谖谗谙谚谛谜谝谟谠谡谢谣谤谥谦谧谨谩谪谫谬谭谮谯谰谱谲谳谴谵谶贝贞负贡财责贤败账货质贩贪贫贬购贮贯贰贱贲贳贴贵贶贷贸费贺贻贼贽贾贿赀赁赂赃资赅赈赉赊赋赌赍赎赏赐赓赔赕赖赘赙赚赛赜赝赞赟赠赡赢赣赵赶趋趱践跷跸跹跻踌踪踬踯蹑蹒蹿躏躯车轧轨轩轫转轭轮软轰轱轲轳轴轵轶轸轹轺轻轼载轾轿辁辂较辄辅辆辇辈辉辊辋辍辎辏辐辑输辔辕辖辗辘辙辚辞辩辫边辽达迁过迈运还这进远违连迟迩迳迹适选逊递逦逻遗遥邓邝邬邮邹邺邻郏郑郓郦郧郸酝酱酽酾酿释鉴銮錾钅针钉钊钋钌钍钎钏钐钒钓钔钕钗钙钚钛钜钝钞钟钠钡钢钣钤钥钦钧钨钩钪钫钬钭钮钯钱钲钳钴钵钶钻钸钹钺钼钽钾钿铀铁铂铃铄铅铆铈铉铊铋铍铎铐铑铒铕铗铙铛铜铝铞铟铠铡铢铣铤铥铧铨铩铪铫铬铭铮铯铰铱铲铳铵银铷铸铺链铿销锁锂锄锅锆锇锈锉锊锋锌锍锎锏锐锑锒锓锔锕锖锗错锚锛锜锝锞锟锡锢锣锤锥锦锨锩锫锬锭键锯锰锱锲锴锵锶锷锸锹锺锻锼锾锿镀镁镂镄镅镆镇镈镉镊镌镍镎镏镐镑镒镓镔镖镗镘镙镛镜镝镞镟镡镢镣镤镥镦镧镨镩镪镫镬镭镯镰镱镲镳镶长门闩闪闫闭问闯闰闱闲闳间闵闷闸闹闺闻闼闽闾阀阁阂阃阄阅阆阈阉阊阋阌阍阎阏阐阑阒阔阕阖阗阙阚队阳阴阵阶际陆陇陈陉陕陧陨险随隐隶隽难雏雠雳雾霁霉霭靓静靥鞑鞒鞯韦韧韩韪韫韬页顶顷项顺须顼顾顿颀颁颂颃预颅领颇颈颉颊颌颍颏颐频颓颔颖颗题颚颛颜额颞颟颠颡颢颤颥颦颧风飏飒飓飕飘飙飞饣饥饧饨饩饪饫饬饭饮饯饰饱饲饴饵饶饷饺饼饽饿馀馁馄馅馆馈馊馋馍馏馐馑馒馓馔馕马驭驮驯驰驱驳驴驵驶驷驸驹驺驻驼驽驾驿骀骁骂骄骅骆骇骈骊骋验骏骐骑骒骓骖骗骘骚骛骜骝骞骟骠骡骢骣骤骥骧鱼鱿鲁鲂鲅鲆鲇鲈鲋鲍鲎鲐鲑鲒鲔鲕鲚鲛鲜鲞鲟鲠鲡鲢鲣鲤鲥鲦鲧鲨鲩鲫鲭鲮鲰鲱鲲鲳鲵鲶鲷鲸鲺鲻鲼鲽鳃鳄鳅鳆鳇鳊鳋鳌鳍鳎鳏鳐鳓鳔鳕鳖鳗鳙鳜鳝鳞鳟鳢鸟鸠鸡鸢鸣鸥鸦鸨鸩鸪鸫鸬鸭鸯鸱鸲鸳鸵鸶鸷鸸鸹鸺鸽鸾鸿鹁鹂鹃鹄鹅鹆鹇鹈鹉鹊鹋鹌鹎鹏鹑鹕鹗鹘鹚鹛鹜鹞鹣鹤鹦鹧鹨鹩鹪鹫鹬鹭鹰鹱鹳鹾麦麸黄黉黩黪黾鼋鼍鼹齐齑齿龀龃龄龅龆龇龈龉龊龋龌龙龚龛龟`]);
// 去除繁體也正常使用的同形字，避免把「程序」「范例」等當成單字字形錯誤。
for (const char of '于余佣匀吁垮岳并强斗朴杰范获虫霉糟糠糸') simplified.delete(char);
const terms = ['視頻', '信息', '軟件', '網絡', '數據', '默認', '菜單', '程序'];
const count = (text, regex) => [...text.matchAll(regex)].length;
export function languageStats(text) {
  return { simplified: [...text].filter(c => simplified.has(c)).length,
    terms: Object.fromEntries(terms.map(term => [term, text.split(term).length - 1])) };
}
export function inspectCards(text) {
  const lines = text.split(/\r?\n/), errors = [], goals = [];
  const requiredSections = ['學習目標', '候選但未採用', '給家長的備註'];
  let section, goal, awaitingAnswer = false, questionIds = [], sections = [];
  const add = (line, message) => errors.push({ line, message });
  const close = line => {
    if (!goal) return;
    for (const field of ['類型', '重要性', '出處']) if (!goal.fields[field]) add(goal.line, `缺少${field}`);
    if (!goal.questions) add(goal.line, '沒有題目');
    if (goal.questions < 2 || goal.questions > 3) add(goal.line, '初次題目池應為 Q1 加 1～2 題進階題');
    if (questionIds.join(',') !== Array.from({ length: questionIds.length }, (_, i) => i + 1).join(',')) add(goal.line, 'Q 編號應從 1 連續遞增');
    if (awaitingAnswer) add(line, '題目缺少 A');
    goal = null; questionIds = []; awaitingAnswer = false;
  };
  lines.forEach((line, i) => {
    const n = i + 1;
    if (!line.trim()) return;
    const heading = line.match(/^## (.+)$/);
    if (heading) {
      close(n); section = heading[1]; sections.push(section);
      if (!requiredSections.includes(section)) add(n, '不允許的第二層標題');
      return;
    }
    const title = line.match(/^### LT-(\d+) (能.+)$/);
    if (title && section === '學習目標') {
      close(n); goal = { line: n, id: title[1], fields: {}, questions: 0 }; goals.push(goal);
      if (goals.some(g => g !== goal && g.id === goal.id)) add(n, 'LT 編號重複');
      return;
    }
    if (section === '學習目標' && goal) {
      const field = line.match(/^- (類型|重要性|出處)：(.+)$/);
      if (field) {
        if (goal.fields[field[1]]) add(n, `${field[1]}重複`);
        goal.fields[field[1]] = field[2].trim();
        if (field[1] === '重要性' && !['高', '中', '低'].includes(field[2])) add(n, '重要性應為高、中、低');
        if (field[1] === '類型' && !['定義', '因果', '比較', '順序', '實驗', '公式與單位', '圖表'].includes(field[2])) add(n, '類型不在自然預設清單');
        if (field[1] === '出處' && /^(無|不明|未知|未提供)$/.test(field[2])) add(n, '出處未填實際依據');
        return;
      }
      const q = line.match(/^- Q(\d+)(（進階）)?：(.+)$/);
      if (q) {
        if (awaitingAnswer) add(n, '前一題缺少 A');
        goal.questions++; questionIds.push(Number(q[1])); awaitingAnswer = true;
        if (Number(q[1]) >= 2 && !q[2]) add(n, '進階題缺少（進階）標記');
        return;
      }
      if (/^  - A：\S/.test(line)) {
        if (!awaitingAnswer) add(n, 'A 沒有對應題目');
        awaitingAnswer = false; return;
      }
      if (/^    \S/.test(line) && !awaitingAnswer) return; // 答案換行。
      if (/^\s*$/.test(line)) return; // 只有空白的行。
      if (/^\s{2,}!\[\[[^\]\n]+\]\]\s*$/.test(line) && !awaitingAnswer) return; // 答案下方直接附圖（使用者 2026-10-13）。
      add(n, '不符合學習目標、欄位、Q 或 A 格式'); return;
    }
    if (['候選但未採用', '給家長的備註'].includes(section) && /^- .+/.test(line)) return;
    add(n, '不符合輸出格式或位於不允許的段落');
  });
  close(lines.length);
  // 必要段落只有「學習目標」；「候選但未採用」「給家長的備註」可有可無，但出現時要照順序、各一次。
  if (sections[0] !== '學習目標' || new Set(sections).size !== sections.length || sections.some(x => !requiredSections.includes(x)) || sections.map(x => requiredSections.indexOf(x)).some((v, i, a) => i && v < a[i - 1])) add(1, '段落：第一段要是「學習目標」，其餘可省略，但不能重複或顛倒');
  const sourced = goals.filter(g => g.fields.出處 && !/^(無|不明|未知|未提供)$/.test(g.fields.出處)).length;
  return { goals: goals.length, questions: count(text, /^\s*-\s*Q\d+/gm), sourced, sourceRatio: goals.length ? `${(sourced / goals.length * 100).toFixed(1)}%` : '—', errors };
}
export function transcriptStats(text, actualPages) {
  const marks = [...text.matchAll(/^(?:p\.(\d+) \^p\1|PDF 第 (\d+) 頁 \^pdf\2)\s*$/gm)];
  const success = count(text, /!\[\[[^\]\n]+\.png\]\]/g), failed = count(text, /<figure\b/g);
  return { characters: [...text.replace(/\s/g, '')].length, uncertain: count(text, /\[\?\]/g), pages: marks.length,
    pagesMatch: marks.length === actualPages && new Set(marks.map(m => m[1] || m[2])).size === actualPages,
    figures: success + failed, success, failed, teachers: count(text, /\[!教師註記\]/g) };
}
export function verificationStats(text) {
  const lines = text.split(/\r?\n/).filter(line => /^\s*-\s*頁\s*\d+/.test(line));
  return { total: lines.length, high: lines.filter(l => /把握：高/.test(l)).length, low: lines.filter(l => /把握：低/.test(l)).length };
}
export async function report(config, out) {
  const logFile = path.join(out, '紀錄.json');
  const records = await exists(logFile) ? await readJson(logFile) : [];
  const manifest = await exists(path.join(out, '頁面/文字層.json')) ? await readJson(path.join(out, '頁面/文字層.json')) : { pages: [] };
  const models = [...new Map([...config.transcribe, ...config.verify, ...config.cards].map(m => [`${m.provider}/${m.model}`, m])).values()];
  const rows = [], details = [], usageRows = [];
  for (const model of models) {
    const id = slug(model.model), related = records.filter(r => r.model === model.model && r.provider === model.provider);
    const transcript = path.join(out, id, '轉錄稿.md'), verification = path.join(out, id, '檢查.md');
    let transCell = '—', verifyCell = '—';
    if (await exists(transcript)) {
      const text = await fs.readFile(transcript, 'utf8'), s = transcriptStats(text, manifest.pages.length);
      transCell = `${s.characters} 字；[?] ${s.uncertain}；頁 ${s.pages}/${manifest.pages.length}；圖 ${s.success}/${s.figures}`;
      details.push(`### ${id}／轉錄稿\n\n- 字數（含 Markdown、排除空白）：${s.characters}\n- [?]：${s.uncertain}\n- 頁碼標記：${s.pages}；實際頁數：${manifest.pages.length}；數量及唯一性${s.pagesMatch ? '相符' : '不符'}\n- 圖：${s.figures}；裁切成功：${s.success}；失敗／未解析標記：${s.failed}\n- 教師註記：${s.teachers}\n${languageLine(text)}`);
    }
    if (await exists(verification)) {
      const s = verificationStats(await fs.readFile(verification, 'utf8'));
      verifyCell = `${s.total}（高 ${s.high}／低 ${s.low}）`;
      details.push(`### ${id}／檢查\n\n- 問題數：${s.total}；把握高：${s.high}；把握低：${s.low}；未標把握：${s.total - s.high - s.low}`);
    }
    const cardCells = [];
    for (const variant of ['只用轉錄稿', '轉錄稿加原頁']) {
      const file = path.join(out, '卡片', `${id}-${variant}.md`);
      if (!(await exists(file))) { cardCells.push('—'); continue; }
      const text = await fs.readFile(file, 'utf8'), s = inspectCards(text);
      cardCells.push(`${s.goals}/${s.questions}；${s.sourceRatio}；格式 ${s.errors.length}`);
      details.push(`### ${id}／${variant}\n\n- 學習目標：${s.goals}；題目：${s.questions}\n- 有出處的目標：${s.sourced}/${s.goals}（${s.sourceRatio}；同目標題目共用出處）\n${languageLine(text)}\n- 格式問題：${s.errors.length}${s.errors.length ? '\n' + s.errors.map(e => `  - 行 ${e.line}：${e.message}`).join('\n') : ''}`);
    }
    const input = related.reduce((sum, r) => sum + (r.usage?.prompt_tokens || 0), 0);
    const output = related.reduce((sum, r) => sum + (r.usage?.completion_tokens || 0), 0);
    const seconds = related.reduce((sum, r) => sum + r.seconds, 0);
    const price = config.pricesUsdPerMillion[model.model];
    const missingUsage = related.some(r => r.status === 200 && (r.usage?.prompt_tokens === undefined || r.usage?.completion_tokens === undefined));
    const cost = price && !missingUsage ? (input * price.input + output * price.output) / 1e6 : null;
    const status = related.length ? `${related.filter(r => r.outcome === 'ok').length}/${related.length} 成功` : '尚未請求';
    rows.push(`| ${model.model} | ${status} | ${transCell} | ${verifyCell} | ${cardCells.join(' | ')} | ${input}/${output}${missingUsage ? '（部分未知）' : ''} | ${seconds.toFixed(1)} | ${cost === null ? '未知' : cost.toFixed(6)} | ${cost === null ? '未知' : (cost * 60).toFixed(4)} |`);
    for (const step of ['transcribe', 'verify', 'cards']) {
      for (const variant of step === 'cards' ? ['只用轉錄稿', '轉錄稿加原頁'] : [undefined]) {
        const group = related.filter(r => r.step === step && (step !== 'cards' || r.variant === variant));
        if (!group.length) continue;
        const ti = group.reduce((s, r) => s + (r.usage?.prompt_tokens || 0), 0), to = group.reduce((s, r) => s + (r.usage?.completion_tokens || 0), 0);
        const unknown = group.some(r => r.status === 200 && (r.usage?.prompt_tokens === undefined || r.usage?.completion_tokens === undefined));
        const fee = price && !unknown ? (ti * price.input + to * price.output) / 1e6 : null;
        usageRows.push(`| ${step}${variant ? '/' + variant : ''} | ${model.model} | ${group.length} | ${group.filter(r => r.outcome === 'ok').length} | ${[...new Set(group.map(r => r.status ?? r.outcome))].join(', ')} | ${ti}/${to}${unknown ? '（部分未知）' : ''} | ${group.reduce((s, r) => s + r.seconds, 0).toFixed(1)} | ${fee === null ? '未知' : fee.toFixed(6)} | ${fee === null ? '未知' : (fee * 60).toFixed(4)} |`);
      }
    }
  }
  const header = '| 模型 | 請求成功/嘗試 | 轉錄 | 檢查問題 | 只用稿：目標/題/出處/格式問題 | 加原頁：目標/題/出處/格式問題 | token 輸入/輸出 | 秒 | 估算 USD | 60 次 USD |\n|---|---|---|---|---|---|---|---|---|---|';
  const table = header + '\n' + rows.join('\n');
  const result = `# T4 機械統計報告\n\n${table}\n\n- PDF 頁序：${manifest.pages.map(p => p.page).join('、') || '尚未渲染'}\n- 此報告只統計，不判斷正確性、學習效果或模型優劣。簡體字採固定常見字形清單；用語採指定八詞精確比對。\n- token／秒數包括既有紀錄與重試；秒數是請求耗時，不含限速或重試等待。\n- 費用使用 models.json 標價估算；免費方案的實際收費與估算不同。缺少 usage 的成功請求不當成零費用。\n- 60 次費用是本資料夾這輪累計估算乘 60，含兩份轉錄的檢查及兩種製卡，不代表單一正式流程的費用。\n- ${config.pricesNote || ''}\n\n## 請求與用量\n\n| 步驟 | 模型 | 嘗試 | 成功 | HTTP／狀態 | token 輸入/輸出 | 秒 | USD | 60 次 USD |\n|---|---|---|---|---|---|---|---|---|\n${usageRows.join('\n')}\n\n## 逐份統計\n\n${details.join('\n\n')}\n`;
  await fs.writeFile(path.join(out, '報告.md'), result);
  console.log(table);
  return table;
}
function languageLine(text) {
  const s = languageStats(text);
  return `- 常見簡體字形：${s.simplified}\n- 指定用語：${Object.entries(s.terms).map(([t, n]) => `${t} ${n}`).join('；')}`;
}
