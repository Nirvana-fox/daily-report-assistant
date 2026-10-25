import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const src = execSync('git show HEAD:src/pages/Settings.tsx', { encoding: 'utf8', maxBuffer: 1024 * 1024 * 8 });
const lines = src.split(/\r?\n/);

const divOpen = lines.findIndex((l) => l.includes('<div key={tab} className="animate-fadein">'));
// 主组件 return 的收尾（精确缩进）：6 空格 </div> + 4 空格 </div> + 2 空格 );
let mainEnd = -1;
for (let i = 0; i < lines.length - 2; i++) {
  if (lines[i] === '      </div>' && lines[i + 1] === '    </div>' && lines[i + 2] === '  );') { mainEnd = i; break; }
}
if (mainEnd < 0) throw new Error('main component end not found');
const region = lines.slice(divOpen + 1, mainEnd);

const segs = [];
let cur = null;
const markerRe = /^\s*\{tab === '([a-z]+)' &&/;
for (const line of region) {
  const mm = line.match(markerRe);
  if (mm) { if (cur) segs.push(cur); cur = { tab: mm[1], bodyLines: [] }; continue; }
  if (cur) cur.bodyLines.push(line);
}
if (cur) segs.push(cur);

const commentRe = /^\s*\{\/\*[\s\S]*\*\/\}\s*$/;
function cleanSeg(s) {
  const arr = [...s.bodyLines];
  while (arr.length && arr[arr.length - 1].trim() === '') arr.pop();
  let i = arr.length - 1;
  while (i >= 0 && (commentRe.test(arr[i]) || arr[i].trim() === '')) i--;
  if (i >= 0 && arr[i].trim() === ')}') arr.splice(i, 1);
  while (arr.length && (commentRe.test(arr[arr.length - 1]) || arr[arr.length - 1].trim() === '')) arr.pop();
  while (arr.length && arr[0].trim() === '') arr.shift();
  return arr.join('\n');
}

// 从 body 中抽取页面级弹窗（{showXxxModal && ...}）回 index
const modalRe = /^        \{(showProfileModal|showCustomModal) &&[\s\S]*?^        \)\}\n/m;
const modals = [];
function extractModals(body) {
  let out = body;
  let mm;
  while ((mm = modalRe.exec(out))) {
    modals.push(mm[0]);
    out = out.replace(mm[0], '');
  }
  return out;
}

const byTab = new Map();
for (const s of segs) {
  if (s.tab === 'appearance') continue;
  let body = cleanSeg(s);
  body = extractModals(body);
  // 清理抽取后留下的多余空行
  body = body.replace(/\n{3,}/g, '\n\n').replace(/^\n+|\n+$/g, '');
  if (!body.trim()) continue;
  if (!byTab.has(s.tab)) byTab.set(s.tab, []);
  byTab.get(s.tab).push(body);
}

const DEPS = ['draft','setDraft','update','onSave','saving','toast','navigate','config','save','stats','setStats','refreshStats','fmtBytes','purgeDays','setPurgeDays','purging','setPurging','purgeFiles','setPurgeFiles','purgingCat','setPurgingCat','onPurgeCategory','onPurgeBefore','onPurgeAll','dStats','refreshDataStats','moving','setMoving','onMoveData','nasTesting','setNasTesting','onNasTest','nasSyncing','setNasSyncing','onNasSync','expPwd','setExpPwd','impPwd','setImpPwd','backupBusy','setBackupBusy','onExport','onImport','acct','setAcct','acctUser','setAcctUser','acctNewPwd','setAcctNewPwd','acctNewPwd2','setAcctNewPwd2','acctOldPwd','setAcctOldPwd','acctTogglePwd','setAcctTogglePwd','acctBusy','setAcctBusy','showProfileModal','setShowProfileModal','profileDraft','setProfileDraft','showCustomModal','setShowCustomModal','customDraft','setCustomDraft','selectedProviderId','setSelectedProviderId','selectedProvider','testing','setTesting','onTest','addProvider','updateProvider','removeProvider','templates','setTemplates','pushTesting','setPushTesting'];

const header = lines.slice(0, 82).join('\n');
const importMap = new Map();
const importRe = /import\s+(?:type\s+)?\{([^}]+)\}\s+from\s+'([^']+)';/g;
let m;
while ((m = importRe.exec(header))) {
  for (const raw of m[1].split(',')) {
    const name = raw.trim().split(/\s+as\s+/).pop().trim();
    if (name) importMap.set(name, m[2]);
  }
}

const TAB_FILES = { model: 'ModelTab', personal: 'PersonalTab', capture: 'CaptureTab', report: 'ReportTab', data: 'DataTab', general: 'GeneralTab' };
mkdirSync('src/pages/settings/tabs', { recursive: true });

for (const [tab, Comp] of Object.entries(TAB_FILES)) {
  const parts = byTab.get(tab) ?? [];
  let body = parts.join('\n\n');
  const used = DEPS.filter((d) => new RegExp(`\b${d}\b`).test(body));
  for (const name of used) body = body.replace(new RegExp(`\b${name}\b`, 'g'), `ctx.${name}`);
  const byMod = new Map();
  for (const [name, mod] of importMap) {
    if (new RegExp(`\b${name}\b`).test(body)) {
      if (!byMod.has(mod)) byMod.set(mod, []);
      byMod.get(mod).push(name);
    }
  }
  const hooks = ['useState','useEffect','useMemo','useRef','useCallback'].filter((h) => new RegExp(`\b${h}\b`).test(body));
  const helperNames = ['Stat','ProviderSelect'].filter((h) => new RegExp(`\b${h}\b`).test(body));
  let imports = '';
  if (hooks.length) imports += `import { ${hooks.join(', ')} } from 'react';\n`;
  for (const [mod, names] of byMod) imports += `import { ${[...new Set(names)].join(', ')} } from '${mod}';\n`;
  if (helperNames.length) imports += `import { ${helperNames.join(', ')} } from '../components';\n`;
  imports += "import type { SettingsCtx, SettingsCtxProps } from '../ctx';\n";
  writeFileSync(
    `src/pages/settings/tabs/${Comp}.tsx`,
    `//! 设置页 · ${Comp}（JSX 原样搬移自原 Settings.tsx，共享状态经 ctx 注入）\n${imports}\nexport default function ${Comp}({ ctx }: SettingsCtxProps) {\n  return (\n    <>\n${body}\n    </>\n  );\n}\n`
  );
  console.log(Comp, 'ok');
}

// ---------- 重建 index.tsx ----------
const partHead = lines.slice(0, 574).join('\n'); // 到 <Tabs .../>（574 行）
const ctxObject = `  const ctx: SettingsCtx = {
    draft, setDraft, update, onSave, saving,
    toast, navigate, config, save,
    stats, setStats, refreshStats, fmtBytes,
    purgeDays, setPurgeDays, purging, setPurging, purgeFiles, setPurgeFiles,
    purgingCat, setPurgingCat, onPurgeCategory, onPurgeBefore, onPurgeAll,
    dStats, refreshDataStats, moving, setMoving, onMoveData,
    nasTesting, setNasTesting, onNasTest, nasSyncing, setNasSyncing, onNasSync,
    expPwd, setExpPwd, impPwd, setImpPwd, backupBusy, setBackupBusy,
    onExport, onImport,
    acct, setAcct, acctUser, setAcctUser, acctNewPwd, setAcctNewPwd,
    acctNewPwd2, setAcctNewPwd2, acctOldPwd, setAcctOldPwd,
    acctTogglePwd, setAcctTogglePwd, acctBusy, setAcctBusy,
    showProfileModal, setShowProfileModal, profileDraft, setProfileDraft,
    showCustomModal, setShowCustomModal, customDraft, setCustomDraft,
    selectedProviderId, setSelectedProviderId, selectedProvider,
    testing, setTesting, onTest, addProvider, updateProvider, removeProvider,
    templates, setTemplates, pushTesting, setPushTesting,
  };
`;
const extraImports = `import type { SettingsCtx } from './settings/ctx';
import AppearanceTab from './settings/AppearanceTab';
import ModelTab from './settings/tabs/ModelTab';
import PersonalTab from './settings/tabs/PersonalTab';
import CaptureTab from './settings/tabs/CaptureTab';
import ReportTab from './settings/tabs/ReportTab';
import DataTab from './settings/tabs/DataTab';
import GeneralTab from './settings/tabs/GeneralTab';
`;

let idx = partHead;
idx = idx.replace(/(import dayjs from 'dayjs';)/, `$1\n${extraImports}`);
idx = idx.replace(
  /\n  return \(\n    <div className="p-6 space-y-5 pb-24">/,
  `\n${ctxObject}  return (\n    <div className="p-6 space-y-5 pb-24">`
);
idx += `
      <div key={tab} className="animate-fadein">
        {tab === 'appearance' && <AppearanceTab />}
        {tab === 'model' && <ModelTab ctx={ctx} />}
        {tab === 'personal' && <PersonalTab ctx={ctx} />}
        {tab === 'capture' && <CaptureTab ctx={ctx} />}
        {tab === 'report' && <ReportTab ctx={ctx} />}
        {tab === 'data' && <DataTab ctx={ctx} />}
        {tab === 'general' && <GeneralTab ctx={ctx} />}
      </div>

      {/* 页面级弹窗（原样保留，非 tab 内容） */}
${modals.join('\n')}
    </div>
  );
}
`;
writeFileSync('src/pages/settings/index.tsx', idx);
rmSync('src/pages/Settings.tsx');
console.log('index.tsx rebuilt, modals:', modals.length);
