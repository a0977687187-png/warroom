/**
 * 家祥投資戰情室 v6.1 — Google Apps Script 後端（讀取 + 寫入合一版）
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
    } else if (sheetName === 'Consensus_Log' && action === 'append') {
      appendRow(sheet, data);
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
// 先試上市(tse_)，再試上櫃(otc_)。z=最新成交價；若盤中無成交(z為"-")則退回昨收(y)或最佳買賣價。
function getStockQuote(code) {
  code = (code || '').toString().trim().toUpperCase();
  if (!code) return { name: '', price: 0, source: '' };

  var prefixes = ['tse_', 'otc_'];
  for (var i = 0; i < prefixes.length; i++) {
    var exCh = prefixes[i] + code + '.tw';
    var url = 'https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=' +
              encodeURIComponent(exCh) + '&json=1&delay=0&_=' + Date.now();
    try {
      var resp = UrlFetchApp.fetch(url, {
        muteHttpExceptions: true,
        headers: { 'Accept': 'application/json' }
      });
      if (resp.getResponseCode() !== 200) continue;
      var data = JSON.parse(resp.getContentText());
      if (!data.msgArray || data.msgArray.length === 0) continue;

      var m = data.msgArray[0];
      var name = m.n || m.nf || '';
      if (!name) continue;

      // 決定價格：最新成交價 z → 昨收 y → 最佳賣價 a → 最佳買價 b
      var price = pickNumber(m.z);
      if (price === null) price = pickNumber(m.y);
      if (price === null) price = pickNumber(firstOf(m.a));
      if (price === null) price = pickNumber(firstOf(m.b));

      return {
        name: name,
        price: price === null ? 0 : price,
        source: (prefixes[i] === 'tse_' ? '上市' : '上櫃')
      };
    } catch (err) {
      // 換下一個前綴再試
    }
  }
  return { name: '', price: 0, source: '' };
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
  const rows = dataArray.map(item => keys.map(k => (item[k] !== undefined ? item[k] : '')));
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
        const row = header.map(h => (data[h] !== undefined ? data[h] : ''));
        sheet.getRange(i + 2, 1, 1, row.length).setValues([row]);
        return;
      }
    }
  }
  sheet.appendRow(header.map(h => (data[h] !== undefined ? data[h] : '')));
}

// Consensus_Log / Daily_Log: simple append-only log
function appendRow(sheet, data) {
  const keys = Object.keys(data);
  const header = ensureHeader(sheet, keys);
  sheet.appendRow(header.map(h => (data[h] !== undefined ? data[h] : '')));
}
