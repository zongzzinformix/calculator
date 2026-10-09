// 抓取臺灣銀行牌告匯率 CSV，輸出 rates.json
// 由 GitHub Actions 定時執行（見 .github/workflows/update-rates.yml）
import { writeFile } from 'node:fs/promises';

const CSV_URL = 'https://rate.bot.com.tw/xrt/flcsv/0/day';
const HTML_URL = 'https://rate.bot.com.tw/xrt?Lang=zh-tw';

// 台銀 CSV 欄位：
// 0 幣別 | 1 Buying | 2 現金買入 | 3 即期買入 | ...遠期... | 11 Selling | 12 現金賣出 | 13 即期賣出
function parseCsv(text) {
  const lines = text.replace(/\r/g, '').trim().split('\n');
  const rows = {};
  for (const line of lines.slice(1)) {
    const c = line.split(',');
    const code = (c[0] || '').trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(code)) continue; // 只收 3 碼幣別
    const num = (v) => {
      const n = parseFloat(v);
      return Number.isFinite(n) && n > 0 ? n : null; // 台銀用 0.00000 代表無報價
    };
    rows[code] = {
      spot: { buy: num(c[3]), sell: num(c[13]) },
      cash: { buy: num(c[2]), sell: num(c[12]) }
    };
  }
  return rows;
}

// 嘗試從網頁抓「牌價最新掛牌時間」（抓不到就算了）
async function getPostedAt() {
  try {
    const res = await fetch(HTML_URL);
    const html = await res.text();
    const m = html.match(/牌價最新掛牌時間[：:]\s*([0-9]{4}\/[0-9]{2}\/[0-9]{2}\s+[0-9]{1,2}:[0-9]{2})/);
    return m ? m[1].trim() : '';
  } catch (e) {
    return '';
  }
}

const res = await fetch(CSV_URL);
if (!res.ok) throw new Error('CSV 抓取失敗，HTTP ' + res.status);
const details = parseCsv(await res.text());
if (Object.keys(details).length < 5) throw new Error('解析到的幣別太少，可能格式改變');

const data = {
  source: 'Taiwan Bank (臺灣銀行牌告匯率)',
  sourceUrl: 'https://rate.bot.com.tw/xrt?Lang=zh-tw',
  fetchedAt: new Date().toISOString(),
  postedAt: await getPostedAt(),
  base: 'TWD',
  details
};

await writeFile('rates.json', JSON.stringify(data, null, 2) + '\n');
console.log('rates.json 已更新。掛牌時間=' + (data.postedAt || '(未知)') + '，幣別數=' + Object.keys(details).length);
