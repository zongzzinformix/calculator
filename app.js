'use strict';
/* ============================================================
   我的計算機 — app.js
   ------------------------------------------------------------
   目錄：
   0. 共用小工具（$、$、localStorage、數字格式化）
   1. 主題切換
   2. 頁籤切換
   3. 計算機引擎（支援括號、先乘除後加減）
   4. 計算機畫面 + 歷史紀錄
   5. 單位換算
   6. 匯率換算
   7. 分帳 / 小費 / 折扣
   8. Service Worker 註冊（離線）
   ============================================================ */

/* ============================================================
   0. 共用小工具
   ============================================================ */
const $  = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

// 讀寫 localStorage（瀏覽器內建的小型儲存空間，關掉 App 資料還在）
const STORE = {
  get(key, fallback) {
    try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); }
    catch (e) { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
  }
};

// 把計算結果格式化成好看的字串（避免 0.1+0.2=0.30000000000000004 這種鬼東西）
function fmt(n) {
  if (typeof n !== 'number' || Number.isNaN(n)) return '錯誤';
  if (!isFinite(n)) return n > 0 ? '∞' : '-∞';
  return String(parseFloat(n.toPrecision(12)));
}

// 幫整數加上千分位，例如 1234567 -> 1,234,567
function group(str) {
  if (typeof str !== 'string') return String(str);
  if (str.includes('e') || str.includes('E')) return str;
  const neg = str.startsWith('-');
  let body = neg ? str.slice(1) : str;
  const dot = body.indexOf('.');
  let intPart = dot === -1 ? body : body.slice(0, dot);
  const decPart = dot === -1 ? '' : body.slice(dot);
  if (!/^\d+$/.test(intPart)) return str;
  intPart = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (neg ? '-' : '') + intPart + decPart;
}

// 顯示一個短暫的提示訊息
let toastTimer = null;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 1600);
}

/* ---------- 震動回饋（Haptic） ---------- */
const Haptic = {
  enabled: true,
  switchEl: null,

  load() { this.enabled = STORE.get('calc_haptic', true); },

  // iOS Safari 沒有 navigator.vibrate，
  // 改用隱藏的 <input type="checkbox" switch>：切換它會觸發 Taptic Engine 震動。
  ensureSwitch() {
    if (this.switchEl) return this.switchEl;
    const el = document.createElement('input');
    el.type = 'checkbox';
    el.setAttribute('switch', '');
    el.setAttribute('aria-hidden', 'true');
    el.tabIndex = -1;
    el.style.cssText = 'position:fixed;top:50%;left:50%;width:2px;height:2px;margin:-1px 0 0 -1px;opacity:0.01;pointer-events:none;border:0;padding:0;';
    document.body.appendChild(el);
    this.switchEl = el;
    return el;
  },

  fire() {
    if (!this.enabled) return;
    if (typeof navigator.vibrate === 'function') {   // Android / Chrome
      try { navigator.vibrate(12); } catch (e) {}
      return;
    }
    try { this.ensureSwitch().click(); } catch (e) {} // iOS Safari
  }
};

/* ============================================================
   1. 主題切換
   ============================================================ */
const THEMES = [
  { id: 'midnight', label: '午夜黑', color: '#0d0d12' },
  { id: 'light',    label: '純白',   color: '#f2f2f7' },
  { id: 'sakura',   label: '櫻花粉', color: '#ff6fa5' },
  { id: 'ocean',    label: '海洋藍', color: '#22c1c3' },
  { id: 'forest',   label: '森林綠', color: '#4caf50' },
  { id: 'sunset',   label: '夕陽橘', color: '#ff7b54' }
];

function applyTheme(id) {
  document.documentElement.setAttribute('data-theme', id);
  const meta = document.querySelector('meta[name="theme-color"]');
  const t = THEMES.find((x) => x.id === id);
  if (meta && t) meta.setAttribute('content', t.color);
  STORE.set('calc_theme', id);
  $$('#themeSwatches .swatch').forEach((b) =>
    b.classList.toggle('active', b.dataset.theme === id)
  );
}

function buildThemeMenu() {
  const box = $('#themeSwatches');
  box.innerHTML = '';
  THEMES.forEach((t) => {
    const b = document.createElement('button');
    b.className = 'swatch';
    b.dataset.theme = t.id;
    b.style.background = t.color;
    b.style.color = (t.id === 'light') ? '#111' : '#fff';
    b.textContent = t.label;
    b.addEventListener('click', () => {
      applyTheme(t.id);
      $('#themeMenu').classList.add('hidden');
      toast('已套用：' + t.label);
    });
    box.appendChild(b);
  });
}

/* ============================================================
   2. 頁籤切換
   ============================================================ */
function initTabs() {
  $$('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      const name = tab.dataset.tab;
      $$('.tab').forEach((t) => t.classList.toggle('active', t === tab));
      $$('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + name));
    });
  });
}

/* ============================================================
   3. 計算機引擎
   用「逆波蘭表示法 (RPN)」確保先乘除後加減、括號也正確
   ============================================================ */
const PREC = { '+': 1, '−': 1, '×': 2, '÷': 2, 'u-': 3 }; // u- 代表負號

// 把字串切成一個個 token
function tokenize(str) {
  const tokens = [];
  let i = 0;
  const isDigit = (c) => c >= '0' && c <= '9';
  while (i < str.length) {
    const c = str[i];
    if (c === ' ') { i++; continue; }
    if (isDigit(c) || c === '.') {
      let num = '';
      while (i < str.length && (isDigit(str[i]) || str[i] === '.')) num += str[i++];
      tokens.push({ type: 'num', value: parseFloat(num) });
    } else if (c === '+' || c === '−' || c === '-' || c === '×' || c === '÷') {
      tokens.push({ type: 'op', value: (c === '-') ? '−' : c });
      i++;
    } else if (c === '(') { tokens.push({ type: 'lparen' }); i++; }
    else if (c === ')')   { tokens.push({ type: 'rparen' }); i++; }
    else if (c === '%')   { tokens.push({ type: 'percent' }); i++; }
    else { i++; } // 忽略看不懂的字元
  }
  return tokens;
}

// 中序 -> 後序（shunting-yard 演算法）
function toRPN(tokens) {
  const output = [];
  const stack = [];
  let prev = null;

  for (const t of tokens) {
    if (t.type === 'num') {
      output.push(t);
    } else if (t.type === 'percent') {
      output.push(t); // 後置運算，直接進輸出
    } else if (t.type === 'op') {
      const unary = (t.value === '−' && (prev === null || prev === 'op' || prev === 'lparen'));
      if (unary) {
        stack.push({ type: 'op', value: 'u-' });
      } else {
        while (stack.length) {
          const top = stack[stack.length - 1];
          if (top.type === 'op' && PREC[top.value] >= PREC[t.value]) output.push(stack.pop());
          else break;
        }
        stack.push(t);
      }
    } else if (t.type === 'lparen') {
      stack.push(t);
    } else if (t.type === 'rparen') {
      while (stack.length && stack[stack.length - 1].type !== 'lparen') output.push(stack.pop());
      if (stack.length) stack.pop(); // 移除 (
    }
    prev = t.type;
  }
  while (stack.length) output.push(stack.pop());
  return output;
}

// 計算後序式
function evalRPN(rpn) {
  const st = [];
  for (const t of rpn) {
    if (t.type === 'num') {
      st.push(t.value);
    } else if (t.type === 'percent') {
      st.push(st.pop() / 100);
    } else if (t.type === 'op') {
      if (t.value === 'u-') { st.push(-st.pop()); continue; }
      const b = st.pop(), a = st.pop();
      if (a === undefined || b === undefined) return NaN;
      if (t.value === '+') st.push(a + b);
      else if (t.value === '−') st.push(a - b);
      else if (t.value === '×') st.push(a * b);
      else if (t.value === '÷') st.push(a / b);
    }
  }
  return st.length ? st[st.length - 1] : NaN;
}

// 對外統一入口：算一個算式字串
function evaluate(expr) {
  if (!expr || !expr.trim()) return NaN;
  // 自動補齊沒關的括號
  const opens = (expr.match(/\(/g) || []).length;
  const closes = (expr.match(/\)/g) || []).length;
  const fixed = expr + ')'.repeat(Math.max(0, opens - closes));
  return evalRPN(toRPN(tokenize(fixed)));
}

/* ============================================================
   4. 計算機畫面 + 歷史紀錄
   ============================================================ */
const Calc = {
  expr: '',            // 使用者輸入的算式
  lastWasResult: false, // 上一步是否按了 =
  history: [],

  load() { this.history = STORE.get('calc_history', []); },

  // 更新畫面
  render() {
    const exprEl = $('#expression');
    const resEl = $('#result');
    exprEl.textContent = this.expr || '\u00a0';

    let shown;
    if (this.lastWasResult) {
      shown = this.lastResultText;
    } else {
      const v = evaluate(this.expr);
      shown = (this.expr === '' || Number.isNaN(v)) ? '0' : group(fmt(v));
    }
    resEl.textContent = shown;
    resEl.classList.toggle('small', shown.length > 9);
  },

  // 按下按鍵的主要邏輯
  press(k) {
    if (k === 'AC') {
      this.expr = '';
      this.lastWasResult = false;
      this.render();
      return;
    }
    if (k === '⌫') {
      if (this.lastWasResult) { this.expr = ''; this.lastWasResult = false; }
      else this.expr = this.expr.slice(0, -1);
      this.render();
      return;
    }
    if (k === '=') {
      this.equals();
      return;
    }
    if (k === '+/−') {
      this.toggleSign();
      return;
    }

    const isDigit = /[0-9.]/.test(k);
    const isOp = ['+', '−', '×', '÷'].includes(k);

    // 剛按完 = ：按數字就重新開始；按運算子就沿用結果繼續算
    if (this.lastWasResult) {
      if (isDigit) this.expr = '';
      else this.expr = this.lastResultRaw; // 用結果當新算式的開頭
      this.lastWasResult = false;
    }

    const last = this.expr.slice(-1);

    if (isDigit) {
      if (k === '.') {
        // 目前這個數字裡已經有小數點就不要再加
        const seg = this.expr.split(/[+−×÷()]/).pop();
        if (seg.includes('.')) return;
        if (seg === '') this.expr += '0';
      }
      this.expr += k;
    } else if (isOp) {
      if (this.expr === '') {
        if (k === '−') this.expr = '−'; // 開頭允許負號
        else return;
      } else if (['+', '−', '×', '÷'].includes(last)) {
        this.expr = this.expr.slice(0, -1) + k; // 連續運算子則替換
      } else {
        this.expr += k;
      }
    } else if (k === '(' || k === ')' || k === '%') {
      this.expr += k;
    }

    this.render();
  },

  equals() {
    if (this.expr === '') return;
    const v = evaluate(this.expr);
    if (Number.isNaN(v)) { toast('算式有誤'); return; }

    const raw = fmt(v);
    const text = group(raw);

    // 存入歷史
    this.history.unshift({ expr: this.expr, result: text });
    if (this.history.length > 100) this.history.pop();
    STORE.set('calc_history', this.history);
    renderHistory();

    this.lastResultRaw = raw;
    this.lastResultText = text;
    this.lastWasResult = true;
    this.render();
  },

  // 切換最後一個數字的正負號
  toggleSign() {
    if (this.lastWasResult) {
      this.expr = this.lastResultRaw;
      this.lastWasResult = false;
    }
    // 找出結尾數字的起點
    const m = this.expr.match(/(\d+\.?\d*)$/);
    if (!m) { this.expr += '−'; this.render(); return; }
    const start = this.expr.length - m[0].length;
    const before = this.expr.slice(0, start);
    if (before.endsWith('−') && (before.length === 1 || /[+−×÷(]$/.test(before.slice(0, -1)) || /[+×÷(]$/.test(before.slice(0, -1)))) {
      this.expr = before.slice(0, -1) + m[0]; // 移除負號
    } else {
      this.expr = before + '−' + m[0]; // 加上負號
    }
    this.render();
  }
};

function renderHistory() {
  const box = $('#historyList');
  box.innerHTML = '';
  if (!Calc.history.length) {
    box.innerHTML = '<div class="history-item"><div class="h-expr" style="text-align:center;color:#b0a48c">— 還沒有紀錄 —</div></div>';
    return;
  }
  Calc.history.forEach((h) => {
    const item = document.createElement('div');
    item.className = 'history-item';
    const e = document.createElement('div');
    e.className = 'h-expr';
    e.textContent = h.expr + ' =';
    const r = document.createElement('div');
    r.className = 'h-res';
    r.textContent = h.result;
    item.appendChild(e);
    item.appendChild(r);
    // 點歷史紀錄 -> 把結果帶回計算機繼續用
    item.addEventListener('click', () => {
      Calc.expr = h.result.replace(/,/g, '');
      Calc.lastWasResult = false;
      Calc.render();
      $('#historyPanel').classList.add('hidden');
    });
    box.appendChild(item);
  });
}

function initCalc() {
  Calc.load();
  renderHistory();

  $('#keypad').addEventListener('click', (e) => {
    const btn = e.target.closest('.key');
    if (btn) { Haptic.fire(); Calc.press(btn.dataset.k); }
  });

  $('#historyToggle').addEventListener('click', () => {
    $('#historyPanel').classList.toggle('hidden');
  });

  $('#clearHistory').addEventListener('click', () => {
    Calc.history = [];
    STORE.set('calc_history', []);
    renderHistory();
    toast('已清除紀錄');
  });

  Calc.render();
}

/* ============================================================
   5. 單位換算
   每個類別用一個「基準單位」，其他單位換成「1 單位 = ? 基準」
   ============================================================ */
const UNITS = {
  length: {
    name: '長度',
    base: 'm',
    list: { '公尺 m': 1, '公里 km': 1000, '公分 cm': 0.01, '毫米 mm': 0.001,
            '英吋 in': 0.0254, '英尺 ft': 0.3048, '碼 yd': 0.9144, '英里 mi': 1609.344, '海里 nmi': 1852 }
  },
  weight: {
    name: '重量',
    base: 'kg',
    list: { '公斤 kg': 1, '公克 g': 0.001, '毫克 mg': 1e-6, '公噸 t': 1000,
            '台斤': 0.6, '台兩': 0.0375, '磅 lb': 0.45359237, '盎司 oz': 0.028349523125 }
  },
  area: {
    name: '面積',
    base: 'm²',
    list: { '平方公尺 m²': 1, '平方公里 km²': 1e6, '平方公分 cm²': 1e-4,
            '坪': 3.305785, '公頃 ha': 10000, '英畝 acre': 4046.8564224, '平方英尺 ft²': 0.09290304 }
  },
  volume: {
    name: '體積',
    base: 'L',
    list: { '公升 L': 1, '毫升 mL': 0.001, '立方公尺 m³': 1000,
            '美制加侖 gal': 3.785411784, '英制加侖 gal': 4.54609, '杯 cup': 0.2365882365 }
  },
  speed: {
    name: '速度',
    base: 'm/s',
    list: { '公尺/秒 m/s': 1, '公里/時 km/h': 0.2777777778, '英里/時 mph': 0.44704, '節 knot': 0.5144444444 }
  },
  time: {
    name: '時間',
    base: 's',
    list: { '秒 s': 1, '分 min': 60, '時 hr': 3600, '天 day': 86400, '週 week': 604800 }
  },
  data: {
    name: '資料量',
    base: 'MB',
    list: { '位元組 B': 1e-6, 'KB': 0.001, 'MB': 1, 'GB': 1000, 'TB': 1e6,
            'KiB': 0.001024, 'MiB': 1.048576, 'GiB': 1073.741824 }
  },
  temperature: {
    name: '溫度',
    special: true,
    list: { '攝氏 °C': 'C', '華氏 °F': 'F', '克氏 K': 'K' }
  }
};

function toCelsius(v, unit) {
  if (unit === 'C') return v;
  if (unit === 'F') return (v - 32) * 5 / 9;
  return v - 273.15; // K
}
function fromCelsius(c, unit) {
  if (unit === 'C') return c;
  if (unit === 'F') return c * 9 / 5 + 32;
  return c + 273.15; // K
}

const Unit = {
  cat: 'length',

  fillUnits() {
    const cat = UNITS[this.cat];
    const names = Object.keys(cat.list);
    const from = $('#unitFromUnit');
    const to = $('#unitToUnit');
    from.innerHTML = '';
    to.innerHTML = '';
    names.forEach((n) => {
      from.appendChild(new Option(n, n));
      to.appendChild(new Option(n, n));
    });
    from.value = names[0];
    to.value = names[1] || names[0];
    this.convert();
  },

  convert() {
    const cat = UNITS[this.cat];
    const v = parseFloat($('#unitFromValue').value);
    const fu = $('#unitFromUnit').value;
    const tu = $('#unitToUnit').value;
    if (Number.isNaN(v)) { $('#unitToValue').value = ''; return; }

    let out;
    if (cat.special) { // 溫度
      out = fromCelsius(toCelsius(v, cat.list[fu]), cat.list[tu]);
    } else {
      out = v * cat.list[fu] / cat.list[tu];
    }
    $('#unitToValue').value = fmt(out);
  },

  swap() {
    const f = $('#unitFromUnit').value;
    $('#unitFromUnit').value = $('#unitToUnit').value;
    $('#unitToUnit').value = f;
    const fv = $('#unitFromValue').value;
    $('#unitFromValue').value = $('#unitToValue').value || fv;
    this.convert();
  }
};

function initUnit() {
  const sel = $('#unitCategory');
  Object.entries(UNITS).forEach(([key, v]) => sel.appendChild(new Option(v.name, key)));
  sel.value = 'length';

  sel.addEventListener('change', () => { Unit.cat = sel.value; Unit.fillUnits(); });
  $('#unitFromValue').addEventListener('input', () => Unit.convert());
  $('#unitFromUnit').addEventListener('change', () => Unit.convert());
  $('#unitToUnit').addEventListener('change', () => Unit.convert());
  $('#unitSwap').addEventListener('click', () => Unit.swap());

  Unit.fillUnits();
}

/* ============================================================
   6. 匯率換算（臺灣銀行牌告匯率）
   全部採用「即期賣出價」：1 單位外幣 = ? 新台幣
   資料：jsDelivr CDN 上社群彙整的 JSON（每 5 分鐘更新）
   ============================================================ */
const CURRENCIES = {
  TWD: '新台幣 TWD', USD: '美元 USD', JPY: '日圓 JPY', EUR: '歐元 EUR',
  CNY: '人民幣 CNY', KRW: '韓元 KRW', HKD: '港幣 HKD', GBP: '英鎊 GBP',
  AUD: '澳幣 AUD', SGD: '新加坡幣 SGD', THB: '泰銖 THB', MYR: '馬來西亞幣 MYR',
  VND: '越南盾 VND', PHP: '菲律賓披索 PHP', CAD: '加幣 CAD', CHF: '瑞士法郎 CHF',
  NZD: '紐西蘭幣 NZD', IDR: '印尼盾 IDR'
};

const Currency = {
  // rate[幣別] = 1 單位外幣 = ? 新台幣（台銀即期賣出價）；TWD 固定為 1
  rate: null,
  botUpdateTime: '',

  load() {
    const saved = STORE.get('calc_bot', null);
    if (saved && saved.rate) {
      this.rate = saved.rate;
      this.botUpdateTime = saved.__updateTime || '';
    }
  },

  fillUnits() {
    const from = $('#curFromUnit');
    const to = $('#curToUnit');
    from.innerHTML = '';
    to.innerHTML = '';
    Object.entries(CURRENCIES).forEach(([k, label]) => {
      from.appendChild(new Option(label, k));
      to.appendChild(new Option(label, k));
    });
    from.value = 'TWD';
    to.value = 'USD';
    this.convert();
  },

  // 換算：外幣A -> TWD -> 外幣B，一律用即期賣出價
  convert() {
    const v = parseFloat($('#curFromValue').value);
    if (Number.isNaN(v)) { $('#curToValue').value = ''; return; }
    const f = $('#curFromUnit').value;
    const t = $('#curToUnit').value;

    let out = NaN;
    if (this.rate) {
      const rf = this.rate[f], rt = this.rate[t];
      if (rf && rt) out = v * rf / rt;
    }
    $('#curToValue').value = Number.isNaN(out) ? '' : fmt(out);
  },

  swap() {
    const f = $('#curFromUnit').value;
    $('#curFromUnit').value = $('#curToUnit').value;
    $('#curToUnit').value = f;
    const fv = $('#curFromValue').value;
    $('#curFromValue').value = $('#curToValue').value || fv;
    this.convert();
  },

  async refresh(silent) {
    const status = $('#rateStatus');
    if (!silent) status.textContent = '更新中…';
    try {
      // 台銀牌告 JSON（走 jsDelivr CDN，支援瀏覽器跨網域讀取）
      const res = await fetch('https://cdn.jsdelivr.net/gh/haotool/app@data/public/rates/latest.json', { cache: 'no-store' });
      const j = await res.json();
      if (!j || !j.details) throw new Error('bad data');

      const rate = { TWD: 1 };
      Object.keys(CURRENCIES).forEach((code) => {
        if (code === 'TWD') return;
        const d = j.details[code];
        const sell = d && d.spot && d.spot.sell; // 只取「即期賣出價」
        if (sell) rate[code] = sell;
      });
      this.rate = rate;
      this.botUpdateTime = j.updateTime || '';
      STORE.set('calc_bot', { rate, __updateTime: this.botUpdateTime });
      this.updateStatus();
      this.convert();
      if (!silent) toast('台銀匯率已更新');
    } catch (e) {
      status.textContent = this.rate ? '更新失敗，沿用上次資料' : '更新失敗（尚無資料）';
      if (!silent) toast('無法連網，沿用上次資料');
    }
  },

  updateStatus() {
    const status = $('#rateStatus');
    status.textContent = this.botUpdateTime
      ? '台銀即期賣出 · ' + this.botUpdateTime
      : '尚未取得資料，請按更新';
    $('#rateCredit').innerHTML = '資料來源：臺灣銀行牌告匯率（即期賣出），經 <a href="https://app.haotool.org/ratewise/" target="_blank" rel="noopener">RateWise</a> 彙整（每 5 分鐘更新）。';
  }
};

function initCurrency() {
  Currency.load();

  Currency.fillUnits();
  Currency.updateStatus();

  $('#curFromValue').addEventListener('input', () => Currency.convert());
  $('#curFromUnit').addEventListener('change', () => Currency.convert());
  $('#curToUnit').addEventListener('change', () => Currency.convert());
  $('#curSwap').addEventListener('click', () => Currency.swap());
  $('#refreshRates').addEventListener('click', () => Currency.refresh(false));

  // 開 App 時自動在背景更新一次（已快取過就安靜更新，不跳提示）
  Currency.refresh(!!Currency.rate);
}

/* ============================================================
   7. 分帳 / 小費 / 折扣
   ============================================================ */
function initSplit() {
  const ids = ['billAmount', 'billDiscount', 'billTip', 'billPeople'];

  function recalc() {
    const amount = parseFloat($('#billAmount').value) || 0;
    const discount = parseFloat($('#billDiscount').value) || 0;
    const tip = parseFloat($('#billTip').value) || 0;
    const people = Math.max(1, parseInt($('#billPeople').value, 10) || 1);

    const afterDiscount = amount * (1 - discount / 100);
    const tipAmount = afterDiscount * (tip / 100);
    const total = afterDiscount + tipAmount;
    const perPerson = total / people;

    const money = (n) => '$' + group(fmt(Math.round(n * 100) / 100));
    $('#resAfterDiscount').textContent = money(afterDiscount);
    $('#resTip').textContent = money(tipAmount);
    $('#resTotal').textContent = money(total);
    $('#resPerPerson').textContent = money(perPerson);
  }

  ids.forEach((id) => $('#' + id).addEventListener('input', recalc));
  recalc();
}

/* ============================================================
   8. 啟動
   ============================================================ */
function init() {
  buildThemeMenu();
  applyTheme(STORE.get('calc_theme', 'midnight'));

  // 震動回饋設定
  Haptic.load();
  const hapticToggle = $('#hapticToggle');
  if (hapticToggle) {
    hapticToggle.checked = Haptic.enabled;
    hapticToggle.addEventListener('change', () => {
      Haptic.enabled = hapticToggle.checked;
      STORE.set('calc_haptic', Haptic.enabled);
      toast(Haptic.enabled ? '震動回饋：開' : '震動回饋：關');
    });
  }

  $('#themeBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    $('#themeMenu').classList.toggle('hidden');
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#themeMenu') && !e.target.closest('#themeBtn')) {
      $('#themeMenu').classList.add('hidden');
    }
  });

  initTabs();
  initCalc();
  initUnit();
  initCurrency();
  initSplit();

  // 註冊 Service Worker（離線用）。用 file:// 直接開檔時不支援，故加上判斷
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
    // 當有「新版本」的 Service Worker 接手時，自動重新載入一次，確保看到最新畫面
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshing) return;
      refreshing = true;
      location.reload();
    });
  }
}

document.addEventListener('DOMContentLoaded', init);
