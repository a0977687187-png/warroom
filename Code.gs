/**
 * 家祥投資戰情室 v8.0 — Google Apps Script 後端（讀取 + 寫入 + 策略選股引擎）
 * ------------------------------------------------------------
 * 只需要「一個」部署網址，前端讀取跟寫入都打同一個網址：
 *   - 讀取（GET  ?action=getAll）→ 回傳所有分頁的最新資料（Asset_Summary / Stock_Holdings / Trade_Log / Consensus_Log / Daily_Log）
 *   - 查價（GET  ?action=quote&code=2330）→ 回傳該股號的中文名稱與最新成交價（供「新增買進/賣出」自動帶入）
 *   - 寫入（POST，body 是 JSON）→ 依 sheet 名稱寫入對應分頁
 *
 * ⚠️ 這一版新增了「查價」功能，如果你是從舊版更新上來的，
 *    貼上新程式碼後，務必「部署 → 管理部署作業 → 編輯（鉛筆）→ 版本選『新版本』→ 部署」，
 *    否則 ?action=quote 不會生效，前端自動帶名稱/價格會失敗。
 *
 * ============ 部署步驟（照著做，10分鐘完成）============
 *  1. 開一個新的 Google 試算表（或用你原本那份），先不用手動建分頁，程式會自動建立。
 *  2. 上方選單「擴充功能」→「Apps Script」，開啟程式碼編輯器。
 *  3. 把這個檔案的全部內容複製貼上，取代原本內容，Ctrl+S 存檔。
 *     存檔時如果要你取名字，隨便取一個（例如「家祥戰情室後端」）。
 *  4. 右上角「部署」→「新增部署作業」：
 *       • 齒輪選「網頁應用程式」
 *       • 說明：家祥戰情室 API（可不填）
 *       • 執行身分：我
 *       • 誰可以存取：任何人
 *     按「部署」。
 *  5. 第一次會跳出「授權存取」，選你的帳號 → 如果看到「Google 尚未驗證這個應用程式」，
 *     點左下角「進階」→「前往（專案名稱）(不安全)」→「允許」。
 *     （這是因為程式是你自己寫的、沒有送 Google 審核，是正常現象，只有你自己看得到你的資料）
 *  6. 部署完成後會顯示一個網址，長得像：
 *       https://script.google.com/macros/s/AKfycb.................../exec
 *     整串複製起來。⚠️ 一定要是「/exec」結尾這個，不是 /dev、也不是 script 編輯器網址。
 *  7. 回到「家祥投資戰情室」網頁，右上角「系統與 API 設定」，貼到「Apps Script 網址」欄位，按「儲存變更並重新連線」。
 *  8. 如果這是全新的空白試算表，按設定視窗裡的「⬆️ 用目前畫面資料初始化雲端」，
 *     會自動把畫面上現有的資料寫進去，之後這份試算表就是你的真實資料庫了。
 *
 * ============ 之後修改程式碼要注意 ============
 *  改完這個檔案後，要「部署」→「管理部署作業」→ 點現有部署旁邊的鉛筆圖示 → 版本選「新版本」→ 部署，
 *  這樣改動才會生效（網址通常不會變，不用重新貼到前端）。
 *
 * ============ 分頁結構說明 ============
 *  Asset_Summary  : 只有 1 列資料（第2列），存現金/水庫/目標等設定值，每次都整列覆蓋
 *  Stock_Holdings : 每列一檔持股（code, name, shares, price, cost, category, reason...）
 *  Trade_Log      : 每列一筆買賣紀錄（依 id 判斷新增或更新）
 *  Consensus_Log  : 每列一筆 AI 共識摘要（純新增）
 *  Daily_Log      : （選用）舊版績效日曆紀錄，可在試算表內手動維護，前端只讀取顯示
 *
 * ============ v8.0 策略選股引擎（新增分頁與功能）============
 *  Strategy_Pool  : 題材股池（theme / code / name / enabled），可直接在試算表增減
 *  Price_History  : 每日收盤資料累積（date / code / name / open / high / low / close / volume / market）
 *  Signal_Log     : 每日掃描觸發的訊號紀錄（date / code / name / theme / signal / ...）
 *
 *  ▶ 安裝步驟（貼上新程式碼並部署新版本後）：
 *    1. 重新整理試算表網頁，上方會出現「🎯 策略選股」選單。
 *    2. 點「① 建立預設題材股池」→ 自動建立 Strategy_Pool 分頁與報告七大題材股池。
 *    3. 點「② 回補 60 日歷史股價」→ 抓近 3 個月收盤資料（約需 1~3 分鐘，跑完會彈通知）。
 *    4. 點「③ 安裝每日自動掃描」→ 之後每天約 14:30 收盤後自動掃描 + 停損檢查 + Email 通知。
 *    5. 點「④ 立即執行一次掃描」→ 馬上試跑，確認 Signal_Log 有寫入資料。
 *
 *  ▶ 新增 API：
 *    ?action=signals         → 最新訊號榜 + 題材強弱（策略選股分頁資料來源）
 *    ?action=stoploss        → 持股停損儀表板（-8% 與 20 日均線，先到先觸發）
 *    ?action=strategy_scan   → 手動觸發一次掃描
 *    ?action=strategy_status → 引擎健康檢查（股池數 / 歷史筆數 / 最近掃描日）
 */

const KNOWN_SHEETS = ['Asset_Summary', 'Stock_Holdings', 'Trade_Log', 'Consensus_Log', 'Daily_Log'];

function doGet(e) {
  const action = e && e.parameter && e.parameter.action;
  if (action === 'getAll') {
    return jsonOutput({ status: 'ok', data: readAllSheets() });
  }
  if (action === 'quote') {
    const code = e.parameter.code || '';
    return jsonOutput({ status: 'ok', data: getStockQuote(code) });
  }
  if (action === 'quotes') {
    // 批量查價：?action=quotes&codes=2330,006208,00990A → 一次回傳全部
    const codes = e.parameter.codes || '';
    return jsonOutput({ status: 'ok', data: getStockQuotes(codes) });
  }
  // ---------- v8.0 策略選股引擎 ----------
  if (action === 'signals') {
    return jsonOutput({ status: 'ok', data: getSignalsPayload() });
  }
  if (action === 'stoploss') {
    return jsonOutput({ status: 'ok', data: getStopLossPayload() });
  }
  if (action === 'strategy_scan') {
    return jsonOutput({ status: 'ok', data: dailyStrategyScan() });
  }
  if (action === 'strategy_status') {
    return jsonOutput({ status: 'ok', data: getStrategyStatus() });
  }
  return jsonOutput({ status: 'ok', message: '家祥戰情室 Apps Script 運作中。加上 ?action=getAll 可讀取全部資料。' });
}

function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);
    const sheetName = payload.sheet;
    const action = payload.action;
    const data = payload.data;

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      sheet = ss.insertSheet(sheetName);
    }

    if (sheetName === 'Asset_Summary' && action === 'upsert') {
      upsertSingleRow(sheet, data);
    } else if (sheetName === 'Stock_Holdings' && action === 'replace_all') {
      replaceAllRows(sheet, data);
    } else if (sheetName === 'Trade_Log' && action === 'upsert') {
      upsertById(sheet, data);
    } else if (sheetName === 'Daily_Log' && action === 'upsert') {
      upsertByKey(sheet, data, 'date'); // 績效日曆一天一筆，用日期當唯一鍵
    } else if (sheetName === 'Daily_Log' && action === 'delete') {
      deleteByKey(sheet, data.date, 'date');
    } else if (sheetName === 'Consensus_Log' && action === 'append') {
      appendRow(sheet, data);
    } else if (sheetName === 'Strategy_Config' && action === 'set') {
      setStrategyConfigValue(data.key, data.value);
    } else {
      appendRow(sheet, data);
    }

    return jsonOutput({ status: 'ok' });
  } catch (err) {
    return jsonOutput({ status: 'error', message: err.message });
  }
}

function jsonOutput(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ---------- 股票即時報價 ----------
// 依股號向台灣證交所 MIS 系統查詢中文名稱與最新成交價。
// 改為「批量查詢」：把所有股號（上市+上櫃兩種前綴）拼成一個請求一次查完，
// 避免逐檔查詢時部分代號被 MIS 後端分流擋掉的問題，速度也快很多。

// 單檔查價（給「新增買進/賣出」的代號查詢用），內部走批量邏輯
function getStockQuote(code) {
  code = (code || '').toString().trim().toUpperCase();
  if (!code) return { name: '', price: 0, source: '' };
  var map = getStockQuotes(code);
  return map[code] || { name: '', price: 0, source: '' };
}

// 批量查價：codes 為逗號分隔的股號字串，回傳 { 股號: {name, price, source} }
function getStockQuotes(codesCsv) {
  var codes = (codesCsv || '').toString().split(',')
    .map(function (c) { return c.trim().toUpperCase(); })
    .filter(function (c) { return c !== ''; });
  var result = {};
  if (codes.length === 0) return result;

  // 每個股號同時帶上市(tse_)與上櫃(otc_)兩種前綴，MIS 只會回傳存在的那個
  var exChList = [];
  codes.forEach(function (c) {
    exChList.push('tse_' + c + '.tw');
    exChList.push('otc_' + c + '.tw');
  });

  var url = 'https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=' +
            encodeURIComponent(exChList.join('|')) + '&json=1&delay=0&_=' + Date.now();

  // 最多嘗試 2 次（MIS 偶爾會拒絕單次請求）
  for (var attempt = 0; attempt < 2; attempt++) {
    try {
      var resp = UrlFetchApp.fetch(url, {
        muteHttpExceptions: true,
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
          'Referer': 'https://mis.twse.com.tw/stock/index.jsp'
        }
      });
      if (resp.getResponseCode() !== 200) continue;
      var data = JSON.parse(resp.getContentText());
      if (!data.msgArray || data.msgArray.length === 0) continue;

      data.msgArray.forEach(function (m) {
        var c = (m.c || '').toString().trim().toUpperCase();
        var name = m.n || m.nf || '';
        if (!c || !name) return;
        // 決定價格：最新成交價 z → 最近成交 pz → 昨收 y → 最佳賣價 a → 最佳買價 b
        var price = pickNumber(m.z);
        if (price === null) price = pickNumber(m.pz);
        if (price === null) price = pickNumber(m.y);
        if (price === null) price = pickNumber(firstOf(m.a));
        if (price === null) price = pickNumber(firstOf(m.b));
        if (price === null || price <= 0) return;
        result[c] = {
          name: name,
          price: price,
          source: (m.ex === 'otc' ? '上櫃' : '上市')
        };
      });
      if (Object.keys(result).length > 0) return result;
    } catch (err) {
      // 重試一次
    }
  }
  return result;
}

function pickNumber(v) {
  if (v === undefined || v === null) return null;
  var s = v.toString().trim();
  if (s === '' || s === '-') return null;
  var n = parseFloat(s);
  return isNaN(n) ? null : n;
}

// MIS 的最佳買/賣價欄位是用底線分隔的多檔（如 "1085.0000_1086.0000_..."），取第一檔
function firstOf(v) {
  if (!v) return null;
  return v.toString().split('_')[0];
}

// ---------- Read helpers ----------

function readAllSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const result = {};

  const assetSheet = ss.getSheetByName('Asset_Summary');
  result.Asset_Summary = assetSheet ? readSingleRowAsObject(assetSheet) : null;

  ['Stock_Holdings', 'Trade_Log', 'Consensus_Log', 'Daily_Log'].forEach(name => {
    const sh = ss.getSheetByName(name);
    result[name] = sh ? readSheetAsObjectArray(sh) : [];
  });

  return result;
}

function readSingleRowAsObject(sheet) {
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow < 2 || lastCol < 1) return null;
  const header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const row = sheet.getRange(2, 1, 1, lastCol).getValues()[0];
  const obj = {};
  header.forEach((h, i) => { obj[h] = row[i]; });
  return obj;
}

function readSheetAsObjectArray(sheet) {
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow < 2 || lastCol < 1) return [];
  const header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const rows = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  return rows
    .filter(r => r.some(cell => cell !== '' && cell !== null))
    .map(r => {
      const obj = {};
      header.forEach((h, i) => { obj[h] = r[i]; });
      return obj;
    });
}

// ---------- Write helpers ----------

// Google Sheet 會把 "006208" 這種開頭是 0 的代號自動轉成數字 6208（前導零消失）。
// 寫入前在字串前面加一個單引號，強制以「文字」存入（單引號本身不會顯示在儲存格）。
function protectLeadingZeros(v) {
  if (typeof v === 'string' && /^0\d/.test(v)) return "'" + v;
  return v;
}

function ensureHeader(sheet, keys) {
  const lastCol = sheet.getLastColumn();
  if (sheet.getLastRow() === 0 || lastCol === 0) {
    sheet.appendRow(keys);
    return keys;
  }
  return sheet.getRange(1, 1, 1, lastCol).getValues()[0];
}

// Asset_Summary: keep exactly one data row (row 2), always overwritten with latest snapshot
function upsertSingleRow(sheet, data) {
  const keys = Object.keys(data);
  const header = ensureHeader(sheet, keys);
  const row = header.map(h => (data[h] !== undefined ? data[h] : ''));
  if (sheet.getLastRow() < 2) {
    sheet.appendRow(row);
  } else {
    sheet.getRange(2, 1, 1, row.length).setValues([row]);
  }
}

// Stock_Holdings: wipe all data rows and rewrite with the current full holdings array
function replaceAllRows(sheet, dataArray) {
  if (!Array.isArray(dataArray) || dataArray.length === 0) {
    sheet.clear();
    return;
  }
  const keys = Object.keys(dataArray[0]);
  sheet.clear();
  sheet.appendRow(keys);
  const rows = dataArray.map(item => keys.map(k => protectLeadingZeros(item[k] !== undefined ? item[k] : '')));
  sheet.getRange(2, 1, rows.length, keys.length).setValues(rows);
}

// Trade_Log: find row by data.id in column "id"; update if found, else append
function upsertById(sheet, data) {
  const keys = Object.keys(data);
  const header = ensureHeader(sheet, keys);
  const idColIdx = header.indexOf('id');
  if (idColIdx === -1) {
    sheet.appendRow(header.map(h => (data[h] !== undefined ? data[h] : '')));
    return;
  }
  const lastRow = sheet.getLastRow();
  if (lastRow >= 2) {
    const ids = sheet.getRange(2, idColIdx + 1, lastRow - 1, 1).getValues();
    for (let i = 0; i < ids.length; i++) {
      if (ids[i][0] === data.id) {
        const row = header.map(h => protectLeadingZeros(data[h] !== undefined ? data[h] : ''));
        sheet.getRange(i + 2, 1, 1, row.length).setValues([row]);
        return;
      }
    }
  }
  sheet.appendRow(header.map(h => protectLeadingZeros(data[h] !== undefined ? data[h] : '')));
}

// 統一轉成可比對的字串：Google Sheet 常把 "2026-07-08" 這種文字自動轉存成
// 真正的日期物件，這裡先轉回 yyyy-MM-dd 文字，避免日期物件跟字串永遠比對不上
function toComparableKey(v) {
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return Utilities.formatDate(v, 'Asia/Taipei', 'yyyy-MM-dd');
  }
  const s = String(v == null ? '' : v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return s;
}

// 依任意欄位（如 date）當唯一鍵：找到就整列覆蓋，找不到就新增一列
function upsertByKey(sheet, data, keyField) {
  const keys = Object.keys(data);
  const header = ensureHeader(sheet, keys);
  const keyColIdx = header.indexOf(keyField);
  if (keyColIdx === -1) {
    sheet.appendRow(header.map(h => protectLeadingZeros(data[h] !== undefined ? data[h] : '')));
    return;
  }
  const targetKey = toComparableKey(data[keyField]);
  const lastRow = sheet.getLastRow();
  if (lastRow >= 2) {
    const keyVals = sheet.getRange(2, keyColIdx + 1, lastRow - 1, 1).getValues();
    for (let i = 0; i < keyVals.length; i++) {
      if (toComparableKey(keyVals[i][0]) === targetKey) {
        const row = header.map(h => protectLeadingZeros(data[h] !== undefined ? data[h] : ''));
        sheet.getRange(i + 2, 1, 1, row.length).setValues([row]);
        return;
      }
    }
  }
  sheet.appendRow(header.map(h => protectLeadingZeros(data[h] !== undefined ? data[h] : '')));
}

// 依任意欄位值刪除整列（例如刪除某一天的日記）
function deleteByKey(sheet, keyValue, keyField) {
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow < 2 || lastCol < 1) return;
  const header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const keyColIdx = header.indexOf(keyField);
  if (keyColIdx === -1) return;
  const targetKey = toComparableKey(keyValue);
  const keyVals = sheet.getRange(2, keyColIdx + 1, lastRow - 1, 1).getValues();
  for (let i = keyVals.length - 1; i >= 0; i--) {
    if (toComparableKey(keyVals[i][0]) === targetKey) {
      sheet.deleteRow(i + 2);
    }
  }
}

// Consensus_Log / Daily_Log: simple append-only log
function appendRow(sheet, data) {
  const keys = Object.keys(data);
  const header = ensureHeader(sheet, keys);
  sheet.appendRow(header.map(h => protectLeadingZeros(data[h] !== undefined ? data[h] : '')));
}

// ================================================================
// ============ v8.0 策略選股引擎（五流派自動選股與紀律）============
// ================================================================
//
// 參數與資料來源皆已用真實 API 呼叫驗證過欄位名稱（2026-07），詳見
// 《策略選股系統_詳細規劃書_v2.md》。上櫃個股歷史日 K 目前沒有可用的公開回補
// 端點（已實測 tradingStock / st43_result.php / dailyQuotes 皆失效或忽略日期參數，
// 只回傳最新一天），因此上櫃股改為「每日累積」，均線類訊號在資料滿 40~60 個
// 交易日前會自動跳過該檔（不是 bug，是資料現實）。

// ---------- 選單 ----------

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('🎯 策略選股')
    .addItem('① 建立預設題材股池', 'ensureStrategyPool')
    .addItem('② 回補歷史股價（近3個月，約需1~2分鐘）', 'backfillHistory')
    .addItem('③ 安裝每日自動掃描（約14:30）', 'setupStrategyTriggers')
    .addItem('④ 立即執行一次掃描', 'runManualScan')
    .addItem('查看引擎狀態', 'showStrategyStatusDialog')
    .addToUi();
}

function runManualScan() {
  const result = dailyStrategyScan();
  SpreadsheetApp.getUi().alert('掃描完成\n' + JSON.stringify(result, null, 2));
}

function showStrategyStatusDialog() {
  const s = getStrategyStatus();
  SpreadsheetApp.getUi().alert('策略引擎狀態\n' + JSON.stringify(s, null, 2));
}

// ---------- 預設股池與參數 ----------

const DEFAULT_STRATEGY_POOL = [
  ['記憶體', '2408'], ['記憶體', '2344'], ['記憶體', '2337'], ['記憶體', '8299'], ['記憶體', '3260'],
  ['AI散熱', '3017'], ['AI散熱', '3324'], ['AI散熱', '8996'], ['AI散熱', '2233'],
  ['CPO光通訊', '3081'], ['CPO光通訊', '2383'], ['CPO光通訊', '4979'], ['CPO光通訊', '3450'], ['CPO光通訊', '6442'],
  ['ABF載板', '3037'], ['ABF載板', '8046'], ['ABF載板', '3189'],
  ['CCL銅箔', '6274'], ['CCL銅箔', '8358'], ['CCL銅箔', '6213'],
  ['被動元件', '2327'], ['被動元件', '2492'],
  ['PCB設備', '2368'], ['PCB設備', '3413'],
  ['國防無人機', '2634'], ['國防無人機', '8033'], ['國防無人機', '2645'],
  ['AI核心', '2330'], ['AI核心', '2454'], ['AI核心', '2317'], ['AI核心', '2382'], ['AI核心', '3231'], ['AI核心', '6669'],
  ['能源', '1513'], ['能源', '1519'], ['能源', '6282']
];

const DEFAULT_STRATEGY_CONFIG = {
  stopLossPct: 0.08,
  breakoutVolRatio: 1.5,
  haoLanVolRatio: 2.0,
  haoLanRangeMax: 0.25,
  haoLanChangePct: 0.04,
  dingtianVolRatio: 1.5,
  dingtianChangePct: 0.05,
  breakoutClusterPct: 0.03,
  eHeatDeltaThreshold: 3,
  eHeatHighThreshold: 8,
  financeNoteApiUrl: ''
};

function ensureStrategyPool() {
  const sheet = getOrCreateSheetWithHeader('Strategy_Pool', ['theme', 'code', 'name', 'enabled']);
  ensureStrategyConfig();
  if (sheet.getLastRow() >= 2) {
    SpreadsheetApp.getUi().alert('Strategy_Pool 已有資料（' + (sheet.getLastRow() - 1) + ' 筆），不重複建立。如需重置，請自行清空分頁內容後再執行一次。');
    return;
  }
  const rows = DEFAULT_STRATEGY_POOL.map(function (p) { return [p[0], protectLeadingZeros(p[1]), '', true]; });
  sheet.getRange(2, 1, rows.length, 4).setValues(rows);
  SpreadsheetApp.getUi().alert('已建立 Strategy_Pool，共 ' + rows.length + ' 檔預設題材股池。可直接在此分頁增刪（enabled 欄填 FALSE 可暫時停用某檔）。');
}

function ensureStrategyConfig() {
  const sheet = getOrCreateSheetWithHeader('Strategy_Config', ['key', 'value']);
  if (sheet.getLastRow() >= 2) return sheet;
  const rows = Object.keys(DEFAULT_STRATEGY_CONFIG).map(function (k) { return [k, DEFAULT_STRATEGY_CONFIG[k]]; });
  sheet.getRange(2, 1, rows.length, 2).setValues(rows);
  return sheet;
}

function getStrategyConfig() {
  const sheet = ensureStrategyConfig();
  const map = {};
  Object.keys(DEFAULT_STRATEGY_CONFIG).forEach(function (k) { map[k] = DEFAULT_STRATEGY_CONFIG[k]; });
  const rows = readSheetAsObjectArray(sheet);
  rows.forEach(function (r) {
    if (r.key === undefined || r.key === '') return;
    let v = r.value;
    if (v === 'true') v = true;
    else if (v === 'false') v = false;
    else if (v !== '' && v !== true && v !== false && !isNaN(parseFloat(v))) v = parseFloat(v);
    map[r.key] = v;
  });
  return map;
}

function setStrategyConfigValue(key, value) {
  const sheet = ensureStrategyConfig();
  const lastRow = sheet.getLastRow();
  if (lastRow >= 2) {
    const keys = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (let i = 0; i < keys.length; i++) {
      if (keys[i][0] === key) { sheet.getRange(i + 2, 2).setValue(value); return; }
    }
  }
  sheet.appendRow([key, value]);
}

function getOrCreateSheetWithHeader(name, headers) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
  } else if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
  }
  return sheet;
}

function getStrategyPoolRows() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Strategy_Pool');
  if (!sheet) return [];
  return readSheetAsObjectArray(sheet)
    .filter(function (r) { return r.code && r.enabled !== false && r.enabled !== 'FALSE'; })
    .map(function (r) { return { theme: r.theme || '', code: String(r.code).trim(), name: r.name || '' }; });
}

function getHoldingCodesForScan() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Stock_Holdings');
  if (!sheet) return [];
  return readSheetAsObjectArray(sheet).map(function (r) { return String(r.code || '').trim(); }).filter(function (c) { return c; });
}

function uniqueArray(arr) {
  const seen = {}; const out = [];
  arr.forEach(function (x) { if (!seen[x]) { seen[x] = true; out.push(x); } });
  return out;
}

function round2(n) { return Math.round(n * 100) / 100; }
function round4(n) { return Math.round(n * 10000) / 10000; }

function parseNumLoose(v) {
  if (v === undefined || v === null) return null;
  const s = v.toString().replace(/,/g, '').replace(/^\+/, '').trim();
  if (s === '' || s === '-') return null;
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

// ROC 民國日期轉西元 yyyy-MM-dd，支援兩種格式：
//   "115/07/10"（STOCK_DAY 逐檔歷史）與 "1150709"（STOCK_DAY_ALL / TPEX 全市場快照，無分隔）
function rocDateToIso(rocStr) {
  const s = String(rocStr).trim();
  let year, month, day;
  if (s.indexOf('/') !== -1) {
    const parts = s.split('/');
    if (parts.length !== 3) return '';
    year = parseInt(parts[0], 10) + 1911;
    month = parts[1].padStart(2, '0');
    day = parts[2].padStart(2, '0');
  } else if (/^\d{7}$/.test(s)) {
    year = parseInt(s.slice(0, 3), 10) + 1911;
    month = s.slice(3, 5);
    day = s.slice(5, 7);
  } else {
    return '';
  }
  return year + '-' + month + '-' + day;
}

// 與前端 quoteCodeCandidates() 邏輯一致的後端版（前導零候選，處理 006208 被 Sheet 去零成 6208 的問題）
function quoteCodeCandidatesGs(rawCode) {
  const base = String(rawCode).trim().toUpperCase();
  const list = [base];
  if (/^\d{2,5}$/.test(base)) {
    for (let len = base.length + 1; len <= 6; len++) list.push(base.padStart(len, '0'));
  }
  return list;
}

// ---------- 每日全市場資料抓取（單一請求，避開限流與 6 分鐘上限）----------
// 欄位名稱已用真實 API 呼叫驗證（2026-07-12）：
//   TWSE STOCK_DAY_ALL: Date/Code/Name/TradeVolume/TradeValue/OpeningPrice/HighestPrice/LowestPrice/ClosingPrice
//   TPEX tpex_mainboard_daily_close_quotes: Date/SecuritiesCompanyCode/CompanyName/Close/Open/High/Low/TradingShares
function fetchDailyAll() {
  const result = { tradeDate: '', tse: {}, otc: {} };

  try {
    const resp = UrlFetchApp.fetch('https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL', {
      muteHttpExceptions: true, headers: { 'Accept': 'application/json' }
    });
    if (resp.getResponseCode() === 200) {
      const arr = JSON.parse(resp.getContentText());
      arr.forEach(function (r) {
        const code = (r.Code || '').toString().trim();
        const close = parseNumLoose(r.ClosingPrice);
        if (!code || close === null) return;
        if (!result.tradeDate && r.Date) result.tradeDate = rocDateToIso(r.Date);
        result.tse[code] = {
          code: code, name: r.Name || '',
          open: parseNumLoose(r.OpeningPrice), high: parseNumLoose(r.HighestPrice), low: parseNumLoose(r.LowestPrice),
          close: close, volume: parseNumLoose(r.TradeVolume), tradeValue: parseNumLoose(r.TradeValue), market: 'twse'
        };
      });
    }
  } catch (err) { /* result.tse 保持空，該次掃描 A/C/D 校對到的上市資料會不足，下次再試 */ }

  try {
    const resp2 = UrlFetchApp.fetch('https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes', {
      muteHttpExceptions: true, headers: { 'Accept': 'application/json' }
    });
    if (resp2.getResponseCode() === 200) {
      const arr2 = JSON.parse(resp2.getContentText());
      arr2.forEach(function (r) {
        const code = (r.SecuritiesCompanyCode || '').toString().trim();
        const close = parseNumLoose(r.Close);
        if (!code || close === null) return;
        if (!result.tradeDate && r.Date) result.tradeDate = rocDateToIso(r.Date);
        result.otc[code] = {
          code: code, name: r.CompanyName || '',
          open: parseNumLoose(r.Open), high: parseNumLoose(r.High), low: parseNumLoose(r.Low),
          close: close, volume: parseNumLoose(r.TradingShares), market: 'tpex'
        };
      });
    }
  } catch (err) { /* result.otc 保持空 */ }

  if (!result.tradeDate) result.tradeDate = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd');
  return result;
}

// 投信買賣超（僅上市，T86；欄位順序已實測驗證：index 10 = 投信買賣超股數）
function fetchTrustBuy(dateStr) {
  const map = {};
  const ymd = dateStr.replace(/-/g, '');
  const resp = UrlFetchApp.fetch('https://www.twse.com.tw/rwd/zh/fund/T86?date=' + ymd + '&selectType=ALL&response=json', {
    muteHttpExceptions: true, headers: { 'Accept': 'application/json' }
  });
  if (resp.getResponseCode() !== 200) return map;
  const json = JSON.parse(resp.getContentText());
  if (json.stat !== 'OK' || !json.data) return map; // 假日或當日尚無資料時 stat 不是 OK，正常現象
  json.data.forEach(function (row) {
    const code = String(row[0]).trim();
    const trustNet = parseNumLoose(row[10]);
    if (code && trustNet !== null) map[code] = trustNet;
  });
  return map;
}

// 月營收（上市，t187ap05_L；欄位已實測驗證）
function fetchMonthlyRevenue() {
  const map = {};
  const resp = UrlFetchApp.fetch('https://openapi.twse.com.tw/v1/opendata/t187ap05_L', {
    muteHttpExceptions: true, headers: { 'Accept': 'application/json' }
  });
  if (resp.getResponseCode() !== 200) return map;
  const arr = JSON.parse(resp.getContentText());
  arr.forEach(function (r) {
    const code = (r['公司代號'] || '').toString().trim();
    const revenue = parseNumLoose(r['營業收入-當月營收']);
    const lastRevenue = parseNumLoose(r['營業收入-上月營收']);
    const yoyRaw = r['營業收入-去年同月增減(%)'];
    if (!code || revenue === null) return;
    const yoy = (yoyRaw !== undefined && yoyRaw !== '') ? parseNumLoose(yoyRaw) / 100 : null;
    // 資料年月是民國格式（如 "11506" = 2026-06），轉成西元當快照鍵，
    // 避免月初 API 還掛著上個月資料時，被日曆月誤存成兩個不同月份
    const ym = String(r['資料年月'] || '').trim();
    const dataMonth = /^\d{5}$/.test(ym) ? (parseInt(ym.slice(0, 3), 10) + 1911) + '-' + ym.slice(3, 5) : '';
    map[code] = { name: r['公司名稱'] || '', revenue: revenue, lastRevenue: lastRevenue, yoy: yoy, dataMonth: dataMonth };
  });
  return map;
}

// 本益比（上市，BWIBBU_ALL；欄位已實測驗證，PEratio 可能為空字串=無法計算）
function fetchPeRatios() {
  const map = {};
  const resp = UrlFetchApp.fetch('https://openapi.twse.com.tw/v1/exchangeReport/BWIBBU_ALL', {
    muteHttpExceptions: true, headers: { 'Accept': 'application/json' }
  });
  if (resp.getResponseCode() !== 200) return map;
  const arr = JSON.parse(resp.getContentText());
  arr.forEach(function (r) {
    const code = (r.Code || '').toString().trim();
    const pe = parseNumLoose(r.PEratio);
    if (code && pe !== null) map[code] = pe;
  });
  return map;
}

// ---------- Price_History 存取 ----------

function getLastHistoryDate(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return '';
  const dates = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  let max = '';
  dates.forEach(function (d) { const s = toComparableKey(d[0]); if (s > max) max = s; });
  return max;
}

function appendDailyHistory(sheet, dateStr, codes, daily) {
  const existing = {};
  const lastRow = sheet.getLastRow();
  if (lastRow >= 2) {
    const data = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
    data.forEach(function (r) { if (toComparableKey(r[0]) === dateStr) existing[String(r[1])] = true; });
  }
  const rows = [];
  codes.forEach(function (code) {
    if (existing[code]) return;
    const rec = daily.tse[code] || daily.otc[code];
    if (!rec) return;
    rows.push([dateStr, protectLeadingZeros(code), rec.name || '', rec.open || '', rec.high || '', rec.low || '', rec.close || '', rec.volume || '', rec.market]);
  });
  if (rows.length > 0) sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, 9).setValues(rows);
  return rows.length;
}

function pruneOldHistory(sheet, keepDays) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;
  const dateCol = sheet.getRange(2, 1, lastRow - 1, 1).getValues().map(function (r) { return toComparableKey(r[0]); });
  const uniqueDates = uniqueArray(dateCol).sort();
  if (uniqueDates.length <= keepDays) return;
  const cutoff = uniqueDates[uniqueDates.length - keepDays - 1];
  for (let i = dateCol.length - 1; i >= 0; i--) {
    if (dateCol[i] <= cutoff) sheet.deleteRow(i + 2);
  }
}

function loadHistoryByCode(sheet, codes) {
  const lastRow = sheet.getLastRow();
  const map = {};
  codes.forEach(function (c) { map[c] = []; });
  if (lastRow < 2) return map;
  const data = sheet.getRange(2, 1, lastRow - 1, 9).getValues();
  data.forEach(function (r) {
    const code = String(r[1]).trim();
    if (!map[code]) return;
    map[code].push({
      date: toComparableKey(r[0]), name: r[2],
      open: parseNumLoose(r[3]), high: parseNumLoose(r[4]), low: parseNumLoose(r[5]),
      close: parseNumLoose(r[6]), volume: parseNumLoose(r[7]), market: r[8]
    });
  });
  Object.keys(map).forEach(function (c) {
    map[c].sort(function (a, b) { return a.date < b.date ? -1 : (a.date > b.date ? 1 : 0); });
  });
  return map;
}

function computeMA(closes, n) {
  if (closes.length < n) return null;
  const slice = closes.slice(closes.length - n);
  return slice.reduce(function (a, b) { return a + b; }, 0) / n;
}

function computeAvgVolume(vols, n, excludeLast) {
  const arr = excludeLast ? vols.slice(0, vols.length - 1) : vols;
  if (arr.length < n) return null;
  const slice = arr.slice(arr.length - n);
  return slice.reduce(function (a, b) { return a + b; }, 0) / n;
}

// ---------- 歷史股價回補（僅上市；上櫃歷史端點已實測失效，改每日累積）----------

function getRecentYyyyMm(n) {
  const out = []; const d = new Date();
  for (let i = 0; i < n; i++) { out.push(Utilities.formatDate(d, 'Asia/Taipei', 'yyyyMM')); d.setMonth(d.getMonth() - 1); }
  return out.reverse();
}

function appendHistoryRowsDedup(sheet, rows) {
  if (rows.length === 0) return 0;
  const lastRow = sheet.getLastRow();
  const existing = {};
  if (lastRow >= 2) {
    const data = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
    data.forEach(function (r) { existing[toComparableKey(r[0]) + '|' + String(r[1])] = true; });
  }
  const toAppend = rows.filter(function (r) { return r[0] && !existing[r[0] + '|' + String(r[1])]; });
  if (toAppend.length > 0) sheet.getRange(sheet.getLastRow() + 1, 1, toAppend.length, 9).setValues(toAppend);
  return toAppend.length;
}

function backfillHistory() {
  const pool = getStrategyPoolRows();
  if (pool.length === 0) { SpreadsheetApp.getUi().alert('請先執行「① 建立預設題材股池」。'); return; }
  const codes = uniqueArray(pool.map(function (p) { return p.code; }).concat(getHoldingCodesForScan()));
  const sheet = getOrCreateSheetWithHeader('Price_History', ['date', 'code', 'name', 'open', 'high', 'low', 'close', 'volume', 'market']);
  const months = getRecentYyyyMm(3);
  let totalAppended = 0; let notFoundCount = 0;

  codes.forEach(function (code) {
    let gotAny = false;
    months.forEach(function (ym) {
      try {
        const resp = UrlFetchApp.fetch('https://www.twse.com.tw/rwd/zh/afterTrading/STOCK_DAY?date=' + ym + '01&stockNo=' + code + '&response=json', {
          muteHttpExceptions: true, headers: { 'Accept': 'application/json' }
        });
        if (resp.getResponseCode() === 200) {
          const json = JSON.parse(resp.getContentText());
          if (json.stat === 'OK' && Array.isArray(json.data)) {
            const rows = json.data.map(function (r) {
              return [rocDateToIso(r[0]), protectLeadingZeros(code), '', parseNumLoose(r[3]), parseNumLoose(r[4]), parseNumLoose(r[5]), parseNumLoose(r[6]), parseNumLoose(r[1]), 'twse'];
            }).filter(function (r) { return r[0] && r[6] !== null; });
            if (rows.length > 0) { gotAny = true; totalAppended += appendHistoryRowsDedup(sheet, rows); }
          }
        }
      } catch (e) { /* 該月抓不到就跳過，不影響其他月份/其他股票 */ }
      Utilities.sleep(400);
    });
    if (!gotAny) notFoundCount++;
  });

  SpreadsheetApp.getUi().alert(
    '歷史回補完成。共新增 ' + totalAppended + ' 筆（上市個股適用）。\n' +
    notFoundCount + ' 檔（多為上櫃股）目前查無歷史資料——上櫃股歷史端點目前已失效，將改為每日自動累積，' +
    '約需 40~60 個交易日才會補滿均線類訊號所需的資料量，這段期間前端會標示「資料累積中」。'
  );
}

// ---------- 五流派掃描引擎 ----------

function runSchoolCScan(poolRows, histByCode, cfg, trustBuyMap, scanDate) {
  const rows = [];
  poolRows.forEach(function (p) {
    const hist = histByCode[p.code] || [];
    if (hist.length < 2) return;
    const today = hist[hist.length - 1];
    if (today.date !== scanDate) return; // 這檔今天還沒有資料（例如上櫃股剛好抓資料失敗），跳過
    const prevClose = hist[hist.length - 2].close;
    if (!prevClose || !today.close) return;
    const changePct = (today.close - prevClose) / prevClose;

    const closes = hist.map(function (h) { return h.close; }).filter(function (c) { return c !== null; });
    const vols = hist.map(function (h) { return h.volume; }).filter(function (v) { return v !== null; });
    if (closes.length < 21 || vols.length < 21) return; // 資料累積中，均線/量能條件還不能判斷

    const bodyRatio = (today.high !== today.low && today.high !== null && today.low !== null)
      ? Math.abs(today.close - today.open) / (today.high - today.low) : 0;
    const avgVol20 = computeAvgVolume(vols, 20, true);
    const volRatio = avgVol20 ? (today.volume / avgVol20) : null;

    let signal = null;

    // 旱地拔蔥：需要前 60 日振幅資料
    if (closes.length >= 41 && changePct >= cfg.haoLanChangePct && bodyRatio >= 0.6 && volRatio !== null && volRatio >= cfg.haoLanVolRatio) {
      const priorSlice = hist.slice(0, hist.length - 1).slice(-60);
      const priorHighs = priorSlice.map(function (h) { return h.high; }).filter(function (v) { return v !== null; });
      const priorLows = priorSlice.map(function (h) { return h.low; }).filter(function (v) { return v !== null; });
      if (priorHighs.length && priorLows.length) {
        const maxH = Math.max.apply(null, priorHighs);
        const minL = Math.min.apply(null, priorLows);
        const amplitude = minL ? (maxH - minL) / minL : 999;
        if (amplitude <= cfg.haoLanRangeMax) signal = '旱地拔蔥';
      }
    }
    // 頂天立地
    if (!signal && changePct >= cfg.dingtianChangePct && bodyRatio >= 0.8 && volRatio !== null && volRatio >= cfg.dingtianVolRatio) {
      signal = '頂天立地';
    }
    // 突破糾結：需要 60 日均線資料（用「昨日」的均線判斷糾結、今日收盤判斷是否突破）
    if (!signal && closes.length >= 61) {
      const closesBeforeToday = closes.slice(0, -1);
      const ma5 = computeMA(closesBeforeToday, 5);
      const ma10 = computeMA(closesBeforeToday, 10);
      const ma20 = computeMA(closesBeforeToday, 20);
      const ma60 = computeMA(closesBeforeToday, 60);
      if (ma5 && ma10 && ma20 && ma60) {
        const cluster = (Math.max(ma5, ma10, ma20, ma60) - Math.min(ma5, ma10, ma20, ma60)) / prevClose;
        const brokeAboveAll = today.close > ma5 && today.close > ma10 && today.close > ma20 && today.close > ma60;
        if (cluster <= cfg.breakoutClusterPct && brokeAboveAll && volRatio !== null && volRatio >= cfg.breakoutVolRatio) {
          signal = '突破糾結';
        }
      }
    }

    if (!signal) return;

    const ma20Now = computeMA(closes, 20);
    const bonus = !!(trustBuyMap[p.code] && trustBuyMap[p.code] > 0);
    const stopEffective = ma20Now ? Math.max(today.close * (1 - cfg.stopLossPct), ma20Now) : today.close * (1 - cfg.stopLossPct);

    const plan = {
      school: 'C', signal: signal,
      entry: '訊號日收盤 ' + today.close + ' 元；保守者等回測不破前一日低點 ' + (hist[hist.length - 2].low || '') + ' 再進',
      position: '≤總資產2%，先進一半',
      stop: round2(stopEffective) + ' 元（=進場-8% 或 跌破MA20 ' + (ma20Now ? round2(ma20Now) : 'N/A') + '，先到先觸發）',
      exit: '跌破MA20無條件出；題材成為主流媒體焦點/新聞普及時分批了結',
      note: bonus ? '投信當日買超⭐' : ''
    };

    rows.push([scanDate, protectLeadingZeros(p.code), p.name || today.name || '', p.theme, 'C', signal,
      today.close, round4(changePct), volRatio !== null ? round2(volRatio) : '', bonus ? 'TRUE' : '',
      JSON.stringify(plan), new Date().toISOString()]);
  });
  return { rows: rows };
}

function runSchoolAScan(poolRows, daily, histByCode, scanDate) {
  const rows = [];
  const aThemes = { 'AI核心': true, '能源': true };

  const candidates = Object.keys(daily.tse).map(function (c) { return daily.tse[c]; }).filter(function (r) { return r.tradeValue; });
  candidates.sort(function (a, b) { return (b.tradeValue || 0) - (a.tradeValue || 0); });
  const top30Codes = {};
  candidates.slice(0, 30).forEach(function (r) { top30Codes[r.code] = true; });

  poolRows.filter(function (p) { return aThemes[p.theme]; }).forEach(function (p) {
    if (!top30Codes[p.code]) return;
    const hist = histByCode[p.code] || [];
    const closes = hist.map(function (h) { return h.close; }).filter(function (c) { return c !== null; });
    if (closes.length < 40) return; // 資料累積中
    const ma40 = computeMA(closes, 40);
    const today = daily.tse[p.code];
    if (!ma40 || !today || today.close <= ma40) return;

    const plan = {
      school: 'A', signal: '胃納量核心',
      entry: '拉回加碼參考價 ' + round2(ma40 * 0.97) + '~' + round2(ma40) + '（MA40 附近分批）',
      position: '長線核心桶，依80/10/10紀律分批，不追高',
      stop: '不設價格停損，改用結構停損：AI資本支出敘事反轉，或月線跌破年線且三個月站不回',
      exit: '漲到核心桶位比重超標時部分減碼調節，不做空、不清倉',
      note: ''
    };
    rows.push([scanDate, protectLeadingZeros(p.code), p.name || today.name || '', p.theme, 'A', '胃納量核心',
      today.close, '', '', '', JSON.stringify(plan), new Date().toISOString()]);
  });
  return { rows: rows };
}

function appendRevenueSnapshot(sheet, monthStr, revenueMap) {
  const lastRow = sheet.getLastRow();
  const existing = {};
  if (lastRow >= 2) {
    const data = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
    data.forEach(function (r) { if (String(r[0]) === monthStr) existing[String(r[1])] = true; });
  }
  const rows = [];
  Object.keys(revenueMap).forEach(function (code) {
    if (existing[code]) return;
    const rec = revenueMap[code];
    rows.push([monthStr, protectLeadingZeros(code), rec.name, rec.revenue, rec.yoy]);
  });
  if (rows.length) sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, 5).setValues(rows);
}

function loadRevenueHistory(sheet) {
  const lastRow = sheet.getLastRow();
  const map = {};
  if (lastRow < 2) return map;
  const data = sheet.getRange(2, 1, lastRow - 1, 5).getValues();
  data.forEach(function (r) {
    const code = String(r[1]).trim();
    map[code] = map[code] || [];
    map[code].push({ month: String(r[0]), revenue: parseNumLoose(r[3]), yoy: parseNumLoose(r[4]) });
  });
  Object.keys(map).forEach(function (c) {
    map[c].sort(function (a, b) { return a.month < b.month ? -1 : (a.month > b.month ? 1 : 0); });
  });
  return map;
}

// 流派D：月營收 YoY≥30% 且（連3月YoY遞增 或 連3月營收創高）；PE 由 BWIBBU_ALL 補充
// 附註：月營收本身只有「當月」資料，連續趨勢需要逐月累積比對，故新增 Revenue_History 分頁
// （此為規劃書 v2 §4 之外的必要延伸，原理與 Price_History 相同：每月一筆快照、逐步累積）
function runSchoolDScan(poolRows, scanDate) {
  const rows = [];
  let revenueMap = {};
  try { revenueMap = fetchMonthlyRevenue(); } catch (e) { return { rows: rows }; }
  if (Object.keys(revenueMap).length === 0) return { rows: rows };

  // 快照只存股池內的股票（全市場 900+ 檔存進 Sheet 會無謂膨脹）
  const poolCodeSet = {};
  poolRows.forEach(function (p) { poolCodeSet[p.code] = true; });
  const poolRevenueMap = {};
  Object.keys(revenueMap).forEach(function (c) { if (poolCodeSet[c]) poolRevenueMap[c] = revenueMap[c]; });

  const revSheet = getOrCreateSheetWithHeader('Revenue_History', ['month', 'code', 'name', 'revenue', 'yoy']);
  let dataMonth = '';
  Object.keys(poolRevenueMap).some(function (c) { dataMonth = poolRevenueMap[c].dataMonth; return !!dataMonth; });
  if (!dataMonth) dataMonth = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM');
  appendRevenueSnapshot(revSheet, dataMonth, poolRevenueMap);

  let peMap = {};
  try { peMap = fetchPeRatios(); } catch (e) { /* PE 是加分資訊，抓不到不影響主判斷 */ }

  const revHistByCode = loadRevenueHistory(revSheet);

  poolRows.forEach(function (p) {
    const rec = revenueMap[p.code];
    if (!rec || rec.yoy === null || rec.yoy < 0.30) return;
    const seq = revHistByCode[p.code] || [];
    let qualifies = false;
    let trendNote = '';
    if (seq.length >= 3) {
      const last3 = seq.slice(-3);
      const increasing = last3[0].yoy !== null && last3[1].yoy !== null && last3[2].yoy !== null &&
        last3[0].yoy <= last3[1].yoy && last3[1].yoy <= last3[2].yoy;
      const revs = seq.map(function (s) { return s.revenue; }).filter(function (v) { return v !== null; });
      const newHigh = revs.length > 0 && rec.revenue >= Math.max.apply(null, revs);
      qualifies = increasing || newHigh;
      if (newHigh) trendNote = '，營收創高';
    } else {
      // 快照累積未滿3個月前的過渡規則：單月YoY達標且營收月增就先列出，
      // 避免新系統前兩個月D榜永遠空白；標註清楚讓使用者知道趨勢還沒驗證完整
      qualifies = rec.lastRevenue !== null && rec.revenue > rec.lastRevenue;
      trendNote = '，趨勢資料累積中(僅單月動能)';
    }
    if (!qualifies) return;

    const pe = peMap[p.code] || null;
    const plan = {
      school: 'D', signal: '結構財候選',
      entry: '待富貴用本業/新業務EPS反推目標價後再決定是否納入觀察（VicYeh門檻：上檔空間≥30%才值得）',
      position: '波段倉，僅在上檔空間達門檻時建立，≤總資產2~3%',
      stop: '收盤跌破近45日低點減碼一半；跌破前波段低點只留1/3',
      exit: '結構破壞（毛利率連兩季下滑/訂單遞延）全出；本益比觸及河流圖上緣分批了結',
      note: 'YoY ' + round2(rec.yoy * 100) + '%' + (pe ? '，PE ' + pe : '') + trendNote
    };
    rows.push([scanDate, protectLeadingZeros(p.code), p.name || rec.name || '', p.theme, 'D', '結構財候選',
      '', round4(rec.yoy), '', '', JSON.stringify(plan), new Date().toISOString()]);
  });
  return { rows: rows };
}

// 流派E：晚間財經筆記 tickers 七日熱度統計（依賴使用者已設定的晚間財經筆記 API 網址）
function runSchoolEScan(cfg, histByCode, scanDate) {
  const rows = [];
  if (!cfg.financeNoteApiUrl) return { rows: rows }; // 尚未設定，前端會提示去設定

  let videos = [];
  try {
    const resp = UrlFetchApp.fetch(cfg.financeNoteApiUrl + '?action=videos_recent&days=14', { muteHttpExceptions: true });
    const json = JSON.parse(resp.getContentText());
    if (json.status === 'success' && Array.isArray(json.data)) videos = json.data;
  } catch (e) { return { rows: rows }; }
  if (videos.length === 0) return { rows: rows };

  const now = new Date();
  const heatMap = {};
  videos.forEach(function (v) {
    const tickers = v.tickers || [];
    const vDate = new Date(v.date || v.published_at || now);
    const daysAgo = Math.floor((now - vDate) / 86400000);
    tickers.forEach(function (t) {
      const code = String(t.code || '').trim();
      if (!code) return;
      heatMap[code] = heatMap[code] || { name: t.name || '', recent7: 0, prior7: 0 };
      if (daysAgo <= 7) heatMap[code].recent7++;
      else if (daysAgo <= 14) heatMap[code].prior7++;
    });
  });

  Object.keys(heatMap).forEach(function (code) {
    const h = heatMap[code];
    const dheat = h.recent7 - h.prior7;
    const hist = histByCode[code];
    let bias20 = null, changePct20 = null;
    if (hist && hist.length >= 20) {
      const closes = hist.map(function (x) { return x.close; }).filter(function (c) { return c !== null; });
      const ma20 = computeMA(closes, 20);
      const latest = closes[closes.length - 1];
      if (ma20) bias20 = (latest - ma20) / ma20;
      const c20ago = closes[closes.length - 20];
      if (c20ago) changePct20 = (latest - c20ago) / c20ago;
    }

    let tag = null;
    if (dheat >= cfg.eHeatDeltaThreshold && changePct20 !== null && changePct20 < 0.10) tag = '前導候選🟢';
    else if (h.recent7 >= cfg.eHeatHighThreshold && bias20 !== null && bias20 > 0.20) tag = '紅海警示🔴';
    else if (h.recent7 > 0) tag = '發酵中🟡';
    if (!tag) return;

    const plan = {
      school: 'E', signal: tag,
      entry: tag.indexOf('前導') === 0 ? '熱度剛起、股價尚未反應，可列入觀察名單' :
        (tag.indexOf('紅海') === 0 ? '題材已過熱，不建議追價，留意獲利了結' : '持續觀察熱度變化'),
      position: '僅供觀察，非進場訊號',
      stop: '—', exit: '—',
      note: '近7日提及' + h.recent7 + '次（前7日' + h.prior7 + '次）'
    };
    rows.push([scanDate, protectLeadingZeros(code), h.name, '', 'E', tag,
      '', changePct20 !== null ? round4(changePct20) : '', '', '', JSON.stringify(plan), new Date().toISOString()]);
  });
  return { rows: rows };
}

// ---------- 主流程：每日掃描 ----------

function clearSignalsForDate(sheet, dateStr) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;
  const dates = sheet.getRange(2, 1, lastRow - 1, 1).getValues().map(function (r) { return toComparableKey(r[0]); });
  for (let i = dates.length - 1; i >= 0; i--) {
    if (dates[i] === dateStr) sheet.deleteRow(i + 2);
  }
}

function dailyStrategyScan() {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
  } catch (e) {
    return { error: '另一個掃描正在執行中，請稍後再試' };
  }
  try {
    const poolRows = getStrategyPoolRows();
    if (poolRows.length === 0) return { error: '尚未建立 Strategy_Pool，請先執行選單「① 建立預設題材股池」' };

    const poolCodes = poolRows.map(function (p) { return p.code; });
    const holdingCodes = getHoldingCodesForScan();
    const allCodes = uniqueArray(poolCodes.concat(holdingCodes));

    const daily = fetchDailyAll();
    const historySheet = getOrCreateSheetWithHeader('Price_History', ['date', 'code', 'name', 'open', 'high', 'low', 'close', 'volume', 'market']);
    const lastDate = getLastHistoryDate(historySheet);
    // 用真實市場資料的交易日期（而非行事曆日期）判斷是否為新的一個交易日，
    // 假日/國定假日 STOCK_DAY_ALL 仍會回傳最近一個交易日的資料，此判斷天生就會跳過非交易日
    const shouldAppend = daily.tradeDate && daily.tradeDate !== lastDate && Object.keys(daily.tse).length > 0;

    let appended = 0;
    if (shouldAppend) {
      appended = appendDailyHistory(historySheet, daily.tradeDate, allCodes, daily);
      pruneOldHistory(historySheet, 210);
    }
    const scanDate = shouldAppend ? daily.tradeDate : lastDate;
    if (!scanDate) return { error: '目前 Price_History 尚無任何資料，且今日抓取也失敗，請稍後再試或先執行「② 回補歷史股價」' };

    const cfg = getStrategyConfig();
    const signalSheet = getOrCreateSheetWithHeader('Signal_Log', ['date', 'code', 'name', 'theme', 'school', 'signal', 'close', 'changePct', 'volRatio', 'bonus', 'plan_json', 'scannedAt']);
    clearSignalsForDate(signalSheet, scanDate);

    const histByCode = loadHistoryByCode(historySheet, allCodes);

    let trustBuyMap = {};
    try { trustBuyMap = fetchTrustBuy(scanDate); } catch (e) { /* 投信買賣超是加分資訊，抓不到不影響主判斷 */ }

    const cResult = runSchoolCScan(poolRows, histByCode, cfg, trustBuyMap, scanDate);
    const aResult = runSchoolAScan(poolRows, daily, histByCode, scanDate);
    const dResult = runSchoolDScan(poolRows, scanDate);
    const eResult = runSchoolEScan(cfg, histByCode, scanDate);

    const allSignalRows = cResult.rows.concat(aResult.rows, dResult.rows, eResult.rows);
    if (allSignalRows.length > 0) {
      signalSheet.getRange(signalSheet.getLastRow() + 1, 1, allSignalRows.length, 12).setValues(allSignalRows);
    }

    const stoplossPayload = getStopLossPayload();
    const breaches = stoplossPayload.items.filter(function (i) { return i.breached && i.applies; });
    let emailSent = false;
    if (breaches.length > 0) {
      sendStopLossEmail(breaches);
      emailSent = true;
    }

    return {
      tradeDate: scanDate, poolCount: allCodes.length, historyAppended: appended,
      signalsFound: allSignalRows.length, stopBreaches: breaches.length, emailSent: emailSent
    };
  } finally {
    lock.releaseLock();
  }
}

// ---------- 停損儀表板 ----------

function getStopLossPayload() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const holdSheet = ss.getSheetByName('Stock_Holdings');
  const holdings = holdSheet ? readSheetAsObjectArray(holdSheet) : [];
  if (holdings.length === 0) return { items: [], checkedAt: new Date().toISOString() };

  const codes = holdings.map(function (h) { return String(h.code).trim(); }).filter(function (c) { return c; });
  // 補零候選一起加入批量查詢 + 之後用股名核對（同前端 refreshAllQuotes 的防呆：
  // 避免被 Sheet 去零的 6208 撈成「日揚」的價格，污染 006208 富邦台50 的停損判斷）
  const allCands = [];
  codes.forEach(function (c) {
    quoteCodeCandidatesGs(c).forEach(function (x) { if (allCands.indexOf(x) === -1) allCands.push(x); });
  });
  const quotes = getStockQuotes(allCands.join(','));

  const historySheet = ss.getSheetByName('Price_History');
  const histByCode = historySheet ? loadHistoryByCode(historySheet, codes) : {};
  const cfg = getStrategyConfig();

  const items = holdings.map(function (h) {
    const code = String(h.code).trim();
    const cost = parseNumLoose(h.cost) || 0;
    const category = h.category || 'mid';
    const applies = (category !== 'long');

    let price = parseNumLoose(h.price) || 0;
    const heldName = String(h.name || '').trim();
    for (const cand of quoteCodeCandidatesGs(code)) {
      const q = quotes[cand];
      if (!q || !(q.price > 0)) continue;
      // 股名核對：查回來的名稱與持股名稱完全對不上就跳過（去零撞號防呆）
      const quotedName = String(q.name || '').trim();
      if (heldName && quotedName && heldName !== quotedName &&
          heldName.indexOf(quotedName) === -1 && quotedName.indexOf(heldName) === -1) continue;
      price = q.price;
      break;
    }

    const hist = histByCode[code] || [];
    const closes = hist.map(function (x) { return x.close; }).filter(function (c) { return c !== null; });
    const ma20 = closes.length >= 20 ? computeMA(closes, 20) : null;

    const stopByPct = cost > 0 ? cost * (1 - cfg.stopLossPct) : null;
    let stopPrice = null, stopType = '資料不足';
    if (stopByPct !== null && ma20 !== null) {
      if (ma20 >= stopByPct) { stopPrice = ma20; stopType = 'MA20'; }
      else { stopPrice = stopByPct; stopType = '-8%成本'; }
    } else if (stopByPct !== null) {
      stopPrice = stopByPct; stopType = '-8%成本';
    } else if (ma20 !== null) {
      stopPrice = ma20; stopType = 'MA20（成本資料不足）';
    }

    const distancePct = (stopPrice && price) ? (price - stopPrice) / stopPrice : null;
    const breached = (stopPrice !== null && price > 0 && price < stopPrice);

    // B流派過熱警示：乖離MA20超過+20%（Ken Chen 空跟漲股的反轉風險位置）、爆量長黑
    const warnings = [];
    if (ma20 && price > 0 && (price - ma20) / ma20 > 0.20) warnings.push('乖離MA20超過+20%，留意跟漲反轉風險');
    const lastBar = hist.length ? hist[hist.length - 1] : null;
    const prevBar = hist.length > 1 ? hist[hist.length - 2] : null;
    if (lastBar && prevBar && lastBar.volume && lastBar.open && lastBar.close && prevBar.close) {
      const vols = hist.map(function (x) { return x.volume; }).filter(function (v) { return v !== null; });
      const avg20 = computeAvgVolume(vols, 20, true);
      if (avg20 && lastBar.volume >= 2 * avg20 && lastBar.close < lastBar.open &&
          (lastBar.open - lastBar.close) / prevBar.close >= 0.05) warnings.push('爆量長黑警示');
    }

    return {
      code: code, name: h.name || '', category: category, cost: cost, price: round2(price),
      ma20: ma20 ? round2(ma20) : null, stopPrice: stopPrice ? round2(stopPrice) : null, stopType: stopType,
      distancePct: distancePct !== null ? round4(distancePct) : null, breached: breached, applies: applies,
      warnings: warnings
    };
  });

  return { items: items, checkedAt: new Date().toISOString() };
}

function sendStopLossEmail(breaches) {
  const lines = breaches.map(function (b) {
    const action = (b.distancePct !== null && b.distancePct < -0.05) ? '全數出清' : '減碼1/2';
    return '- ' + b.name + '（' + b.code + '）現價 ' + b.price + '，停損價 ' + b.stopPrice + '（' + b.stopType + '），建議：' + action;
  });
  const body = '戰情室策略引擎偵測到以下持股跌破停損價：\n\n' + lines.join('\n') +
    '\n\n此為系統依「成本-8% 或 跌破20日均線，先到先觸發」規則自動判定，訊號僅供參考，非投資建議，請自行確認後再操作。';
  try {
    MailApp.sendEmail(Session.getEffectiveUser().getEmail(),
      '⚠️ 戰情室停損警報 ' + Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd'), body);
  } catch (e) { /* 寄信失敗不應影響掃描主流程 */ }
}

// ---------- 前端讀取用：訊號榜彙整 ----------

function getSignalsPayload() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // 題材強弱：統計「整個股池」的當日平均漲跌（族群輪動地圖）。
  // 就算今天一個訊號都沒有，這張表也要有資料——沒訊號的日子更需要知道資金在哪個族群。
  const poolRowsForTheme = getStrategyPoolRows();
  const histSheetForTheme = ss.getSheetByName('Price_History');
  let themes = [];
  let lastTradeDate = '';
  if (histSheetForTheme && poolRowsForTheme.length > 0) {
    lastTradeDate = getLastHistoryDate(histSheetForTheme);
    const histByCode = loadHistoryByCode(histSheetForTheme, poolRowsForTheme.map(function (p) { return p.code; }));
    const tMap = {};
    poolRowsForTheme.forEach(function (p) {
      const hist = histByCode[p.code] || [];
      if (hist.length < 2) return;
      const last = hist[hist.length - 1];
      const prev = hist[hist.length - 2];
      if (last.date !== lastTradeDate || !last.close || !prev.close) return;
      const chg = (last.close - prev.close) / prev.close;
      const t = p.theme || '未分類';
      tMap[t] = tMap[t] || { theme: t, sum: 0, count: 0, best: '', bestChg: -999 };
      tMap[t].sum += chg;
      tMap[t].count++;
      if (chg > tMap[t].bestChg) { tMap[t].bestChg = chg; tMap[t].best = p.name || last.name || p.code; }
    });
    themes = Object.keys(tMap).map(function (t) {
      const m = tMap[t];
      return { theme: m.theme, avgChange: round4(m.sum / m.count), count: m.count, best: m.best };
    }).sort(function (a, b) { return b.avgChange - a.avgChange; });
  }

  const signalSheet = ss.getSheetByName('Signal_Log');
  const rows = signalSheet ? readSheetAsObjectArray(signalSheet) : [];
  if (rows.length === 0) return { date: lastTradeDate, scannedAt: '', schoolA: [], schoolC: [], schoolD: [], schoolE: [], themes: themes };

  const latestDate = rows.reduce(function (max, r) {
    const d = toComparableKey(r.date);
    return d > max ? d : max;
  }, '');
  const todays = rows.filter(function (r) { return toComparableKey(r.date) === latestDate; });

  function toItem(r) {
    let plan = {};
    try { plan = JSON.parse(r.plan_json || '{}'); } catch (e) {}
    return {
      code: String(r.code), name: r.name, theme: r.theme, signal: r.signal,
      close: r.close, changePct: r.changePct, volRatio: r.volRatio,
      bonus: (r.bonus === true || r.bonus === 'TRUE'), plan: plan
    };
  }

  const schoolA = todays.filter(function (r) { return r.school === 'A'; }).map(toItem);
  const schoolC = todays.filter(function (r) { return r.school === 'C'; }).map(toItem);
  const schoolD = todays.filter(function (r) { return r.school === 'D'; }).map(toItem);
  const schoolE = todays.filter(function (r) { return r.school === 'E'; }).map(toItem);

  const scannedAt = todays.length ? todays[0].scannedAt : '';
  return { date: latestDate, scannedAt: scannedAt, schoolA: schoolA, schoolC: schoolC, schoolD: schoolD, schoolE: schoolE, themes: themes };
}

// ---------- 引擎狀態（遠端除錯用）----------

function getStrategyStatus() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const poolSheet = ss.getSheetByName('Strategy_Pool');
  const histSheet = ss.getSheetByName('Price_History');
  const signalSheet = ss.getSheetByName('Signal_Log');

  const poolCount = poolSheet ? Math.max(0, poolSheet.getLastRow() - 1) : 0;
  const historyRows = histSheet ? Math.max(0, histSheet.getLastRow() - 1) : 0;
  const lastTradeDate = histSheet ? getLastHistoryDate(histSheet) : '';

  let lastScanAt = '';
  if (signalSheet && signalSheet.getLastRow() >= 2) {
    const vals = signalSheet.getRange(2, 12, signalSheet.getLastRow() - 1, 1).getValues();
    vals.forEach(function (r) { if (String(r[0]) > lastScanAt) lastScanAt = String(r[0]); });
  }

  const triggers = ScriptApp.getProjectTriggers().filter(function (t) { return t.getHandlerFunction() === 'dailyStrategyScan'; });

  return {
    poolCount: poolCount, historyRows: historyRows, lastTradeDate: lastTradeDate,
    lastScanAt: lastScanAt, triggerInstalled: triggers.length > 0, configOk: !!ss.getSheetByName('Strategy_Config')
  };
}

// ---------- 觸發器安裝 ----------

function setupStrategyTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'dailyStrategyScan') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('dailyStrategyScan').timeBased().everyDays(1).atHour(14).nearMinute(30).create();
  SpreadsheetApp.getUi().alert('已安裝每日自動掃描（約 14:30 執行）。請到「專案設定」確認時區為 Asia/Taipei，觸發時間才會準確。');
}
