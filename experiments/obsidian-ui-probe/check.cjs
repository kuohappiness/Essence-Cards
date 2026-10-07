const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert/strict');
const source=fs.readFileSync(path.join(__dirname,'main.js'),'utf8');
class Element {
  constructor(tag='div'){this.tag=tag;this.style={};this.children=[];this.value='';this.attrs={};this.textContent='';this.ownerDocument={createElement:tag=>new Element(tag)};}
  appendChild(el){this.children.push(el);}
  replaceChildren(){this.children=[];}
  attachShadow(){this.shadowRoot=new Element('shadow');return this.shadowRoot;}
  set innerHTML(value){this.nodes={};for(const match of value.matchAll(/id="([^"]+)"/g))this.nodes['#'+match[1]]=new Element(match[1]);}
  querySelector(selector){return this.nodes[selector];}
  setAttribute(key,value){this.attrs[key]=value;}
}
async function check(mobile){
  class TFile{constructor(path){this.path=path;this.extension=path.split('.').pop();}}
  class TFolder{constructor(path){this.path=path;}}
  const files=new Map();let factory,leaf,command;
  const vault={getAbstractFileByPath:path=>files.get(path)?.file,createFolder:async path=>files.set(path,{file:new TFolder(path)}),create:async(path,content)=>{const file=new TFile(path);files.set(path,{file,content});return file;},createBinary:async(path,buffer)=>{const file=new TFile(path);files.set(path,{file,buffer});return file;},read:async file=>files.get(file.path).content,process:async(file,fn)=>{const e=files.get(file.path);e.content=fn(e.content);return e.content;},getFiles:()=>[...files.values()].map(x=>x.file).filter(x=>x instanceof TFile),getResourcePath:file=>'resource://'+file.path};
  const workspace={getLeavesOfType:()=>leaf?[leaf]:[],getLeaf:()=>leaf={view:{getViewType:()=>''},setViewState:async()=>{leaf.view=factory(leaf);await leaf.view.onOpen();},detach:()=>leaf.view.onClose()},revealLeaf:async()=>{}};
  const app={vault,workspace};
  class ItemView{constructor(){this.app=app;this.contentEl=new Element();}}
  class Plugin{constructor(){this.app=app;}registerView(id,fn){factory=fn;}addCommand(c){command=c;}addRibbonIcon(){}}
  const context={module:{exports:{}},TextEncoder,require:name=>{assert.equal(name,'obsidian');return{Plugin,ItemView,TFile,TFolder,Platform:{isIosApp:mobile},Notice:class{}};}};
  vm.runInNewContext(source,context);const plugin=new context.module.exports();await plugin.onload();await command.callback();
  let view=leaf.view;let root=view.root;
  assert(root.querySelector('#platform').textContent.startsWith(mobile?'iOS':'桌面'));
  await view.run(()=>view.loadNote());assert(root.querySelector('#status').textContent.includes('找不到 test.md'));
  await view.run(()=>view.initialize());assert.equal(files.size,3);assert(files.get('Essence-UI-Probe/sample.svg').buffer.byteLength>0);
  assert(root.querySelector('#flip').textContent.includes('植物'));root.querySelector('#flip').onclick();assert(root.querySelector('#flip').textContent.includes('葉綠體'));
  assert.equal(root.querySelector('#media-view').children[0].src,'resource://Essence-UI-Probe/sample.svg');
  const next=view.loaded.replace('葉綠體。','葉綠體【測試】。');root.querySelector('#note').value=next;await view.run(()=>view.saveNote());assert.equal(files.get('Essence-UI-Probe/test.md').content,next);assert(root.querySelector('#map-answer').textContent.includes('測試'));
  files.get('Essence-UI-Probe/test.md').content+='\n外部更新';root.querySelector('#note').value='過期草稿';await view.run(()=>view.saveNote());assert(root.querySelector('#status').textContent.includes('已被其他操作更新'));assert(files.get('Essence-UI-Probe/test.md').content.includes('外部更新'));
  await view.run(()=>view.initialize());assert.equal(files.size,3);assert(root.querySelector('#note').value.includes('外部更新'));
  root.querySelector('#note').value='# 測試\n\n## 問題\n<img onerror=alert(1)>\n\n## 答案\n正確';await view.run(()=>view.saveNote());assert(root.querySelector('#flip').textContent.includes('<img'));
  for(const [path,tag] of [['probe.wav','audio'],['probe.mp4','video']]){files.set(path,{file:new TFile(path)});root.querySelector('#media').value=path;view.showMedia();assert.equal(root.querySelector('#media-view').children[0].tag,tag);assert.equal(root.querySelector('#media-view').children[0].controls,true);}
  await view.onClose();await view.onOpen();root=view.root;await view.run(()=>view.loadNote());assert(root.querySelector('#note').value.includes('<img'));
  await command.callback();assert.equal(leaf.view,view);plugin.onunload();assert.equal(view.root,null);
  console.log(JSON.stringify({platform:mobile?'iOS API flag':'desktop API flag',ok:true,checks:['entry-point','missing-file-error','create-idempotency','shared-note-card-map','resource-path','save-readback','stale-write-rejection','safe-text','audio-video-controls','close-reopen','unload'],boundary:'mock DOM and Vault only; no browser or Obsidian runtime'}));
}
(async()=>{await check(false);await check(true);})().catch(e=>{console.error(e);process.exit(1)});
