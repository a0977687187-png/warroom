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
 *    4. 點「③ 安裝每日自動掃描」→ 之後每天約 16:00 自動掃描 + 停損檢查 + Email 通知（排在收盤後較晚時段，避開法人買賣超等資料的公布延遲）。
 *    5. 點「④ 立即執行一次掃描」→ 馬上試跑，確認 Signal_Log 有寫入資料。
 *
 *  ▶ 新增 API：
 *    ?action=signals         → 最新訊號榜 + 題材強弱（策略選股分頁資料來源）
 *    ?action=stoploss        → 持股停損儀表板（-8% 與 20 日均線，先到先觸發）
 *    ?action=strategy_scan   → 手動觸發一次掃描
 *    ?action=strategy_status → 引擎健康檢查（股池數 / 歷史筆數 / 最近掃描日）
 *    ?action=pool            → 讀取題材股池清單
 *    ?action=pool_add&theme=題材&code=代號 → 加入股池（上市股自動回補3個月歷史）
 *    ?action=pool_remove&code=代號        → 移出股池
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
  if (action === 'pool') {
    return jsonOutput({ status: 'ok', data: getPoolPayload() });
  }
  if (action === 'pool_add') {
    return jsonOutput({ status: 'ok', data: poolAddStock(e.parameter.theme, e.parameter.code) });
  }
  if (action === 'pool_remove') {
    return jsonOutput({ status: 'ok', data: poolRemoveStock(e.parameter.code) });
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
    } else if (sheetName === 'NetWorth_History' && action === 'replace_all') {
      // 整表覆蓋：用來清理歷史重複列（upsert 只會蓋掉第一筆相符的，無法移除其餘重複）
      replaceAllRows(sheet, data);
    } else if (sheetName === 'NetWorth_History' && action === 'upsert_by_date') {
      // 淨值逐日快照：一天一筆，用日期當唯一鍵覆蓋。
      // 原本沒有這個分支，會掉進最下面的 else{appendRow}，變成每天新增一列重複資料，
      // 而且 readAllSheets 也沒讀回來，等於這條備份路徑一直是壞的。
      upsertByKey(sheet, data, 'date');
      pruneNetWorthHistory(sheet, 400);
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
// 批量查價。2026-07-21 改為「分批 + 缺漏重試」：
// 實測發現一次查詢過多代號時，MIS 在 Apps Script 的呼叫環境下有時只會回傳一小部分結果
// （曾實測 50 檔股池只回傳約 8 檔，其餘代號在回應裡完全消失，不是錯誤而是靜默漏掉），
// 但相同的請求從其他網路環境測試卻能 100% 成功——判斷是 MIS 對 Apps Script 這類雲端/
// 資料中心來源的請求，在批次較大時偶發限流或分流。解法：拆成安全大小的小批次
// （每批 15 檔）用 fetchAll 併發查詢，查完後如果還有代號完全沒拿到資料，再對缺漏的
// 代號重試一輪——這樣不管實際原因是批次太大還是單純運氣不好，都有第二次機會補上。
var STOCK_QUOTE_CHUNK_SIZE = 15;

// 2026-07-23：報價短效快取（90秒）。停損儀表板每次載入策略分頁都會對 MIS 做一次完整
// 查價往返——包括收盤後價格根本不會變的時段、以及使用者連按兩次「重新整理」這種間隔
// 幾秒的重複查詢。同一組代號 90 秒內重複查詢直接回快取：載入變快（省 1~2 秒）、MIS
// 流量減少（每少打一次就少一次暴露在「機率性漏碼」風險裡，見上方 §18 註解）。
// 90 秒對停損判斷來說夠即時（伺服器排程本來就是每 10 分鐘更新一次）。
// 兩個刻意的設計決定：①只快取「全部代號都查到」的完整結果——部分失敗的結果不快取，
// 下一次呼叫還有機會重試補齊，不會把「查不到」的狀態凍結 90 秒；②所有快取操作都包在
// try/catch 裡，CacheService 不可用（如測試環境）或額度異常時自動退化成無快取，行為
// 跟加快取前完全一樣。
var STOCK_QUOTE_CACHE_SECONDS = 90;

function quoteCacheKey(codes) {
  // CacheService 金鑰長度上限 250 字元，代號清單直接串會超過，改用簡短雜湊＋筆數當金鑰
  var s = codes.slice().sort().join(',');
  var h = 5381;
  for (var i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return 'quotes_' + h.toString(36) + '_' + codes.length;
}

function getStockQuotes(codesCsv) {
  var codes = (codesCsv || '').toString().split(',')
    .map(function (c) { return c.trim().toUpperCase(); })
    .filter(function (c) { return c !== ''; });
  if (codes.length === 0) return {};

  var cacheKey = quoteCacheKey(codes);
  try {
    var cached = CacheService.getScriptCache().get(cacheKey);
    if (cached) return JSON.parse(cached);
  } catch (e) { /* 快取不可用就直接查，行為同加快取前 */ }

  var result = {};
  var remaining = codes.slice();
  var status = { hadError: false };

  // 2026-07-22：使用者仍反映部分股票偶爾查不到報價（原本2輪重試沒能完全消除）。
  // MIS 對雲端來源請求的靜默漏碼是機率性的，不是特定代號固定壞掉，所以再加一輪重試，
  // 並在重試前稍作停頓（避開同一個限流時間窗），提高補到的機率——無法保證100%，
  // 但每多一輪重試都是用「多花一點時間」換「更高成功率」，對使用者體驗只有好處沒有壞處。
  for (var round = 0; round < 3 && remaining.length > 0; round++) {
    if (round > 0) Utilities.sleep(300);
    var chunks = [];
    for (var i = 0; i < remaining.length; i += STOCK_QUOTE_CHUNK_SIZE) {
      chunks.push(remaining.slice(i, i + STOCK_QUOTE_CHUNK_SIZE));
    }
    var gotThisRound = fetchStockQuoteChunks(chunks, status);
    Object.keys(gotThisRound).forEach(function (c) { result[c] = gotThisRound[c]; });
    remaining = remaining.filter(function (c) { return !result[c]; });
  }

  // 快取條件的取捨：查價常帶「補零候選代號」（如 02330——本來就不存在、永遠查不到），
  // 所以不能用「全部代號都查到」當條件，否則快取在最頻繁的停損儀表板路徑上永遠不生效。
  // 改用「至少查到一檔＋過程中沒有任何一批發生網路層失敗(exception/非200)」：查不到的
  // 候選代號是永久性的（快取它的「查無」完全正確），真正要避免快取的是網路異常那種
  // 暫時性失敗。殘餘風險：若某真實代號連續3輪都被 MIS 靜默漏掉（HTTP 200 但就是沒回），
  // 該檔的「查無」會被快取 90 秒——停損儀表板對此本來就有安全閥（退回上次同步價並標註
  // quoteStale，絕不誤判），90 秒後重查即恢復，可接受。
  if (!status.hadError && Object.keys(result).length > 0) {
    try {
      CacheService.getScriptCache().put(cacheKey, JSON.stringify(result), STOCK_QUOTE_CACHE_SECONDS);
    } catch (e) { /* 放不進快取就算了，下次重查 */ }
  }
  return result;
}

// 對一組「代號批次」（每批已經是安全大小）發出查詢，可能是多批就用 fetchAll 併發、
// 單批就直接 fetch，合併所有批次解析出來的報價。
// status（選填）：發生網路層/解析層的暫時性失敗時會設 status.hadError=true，
// 供呼叫端判斷這次結果是否可以放進快取（見 getStockQuotes 的快取條件註解）。
function fetchStockQuoteChunks(chunks, status) {
  var merged = {};
  var requests = chunks.map(function (chunk) {
    var exChList = [];
    chunk.forEach(function (c) {
      exChList.push('tse_' + c + '.tw');
      exChList.push('otc_' + c + '.tw');
    });
    return {
      url: 'https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=' +
        encodeURIComponent(exChList.join('|')) + '&json=1&delay=0&_=' + Date.now(),
      muteHttpExceptions: true,
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
        'Referer': 'https://mis.twse.com.tw/stock/index.jsp'
      }
    };
  });

  var responses;
  try {
    responses = (requests.length === 1)
      ? [UrlFetchApp.fetch(requests[0].url, requests[0])]
      : UrlFetchApp.fetchAll(requests);
  } catch (err) {
    if (status) status.hadError = true; // 網路層失敗屬暫時性，通知呼叫端這次結果不可快取
    return merged; // 整批請求失敗（如網路問題），這輪就拿不到，交給下一輪重試
  }

  responses.forEach(function (resp) {
    try {
      if (resp.getResponseCode() !== 200) { if (status) status.hadError = true; return; }
      var data = JSON.parse(resp.getContentText());
      if (!data.msgArray) return;
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
        merged[c] = {
          name: name,
          price: price,
          source: (m.ex === 'otc' ? '上櫃' : '上市')
        };
      });
    } catch (e) {
      if (status) status.hadError = true; // 解析失敗（如MIS回傳非JSON錯誤頁）也視為暫時性，不可快取
    }
  });
  return merged;
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

// ================= 伺服器端自動更新股票報價 =================
// 背景：前端「盤中每5分鐘自動更新」只有在使用者真的開著 App 時才會執行，
// 一旦關掉 App，價格就停在關閉當下那一刻，容易看到過時的數字。
// 這裡改用跟晚間財經筆記一樣的「時間觸發器」做法，讓 Google 伺服器自己
// 每 10 分鐘查一次真實股價寫回 Stock_Holdings，不管手機/瀏覽器有沒有開著都會更新。

// 產生查價用的代號候選清單：原代號 + 補零版本
// （Google Sheet 會把 006208 這種代號自動去零存成 6208，這裡把可能的原始代號都補回來一起查）
function quoteCodeCandidatesServer(rawCode) {
  var base = String(rawCode).trim().toUpperCase();
  var list = [base];
  if (/^\d{2,5}$/.test(base)) {
    for (var len = base.length + 1; len <= 6; len++) list.push(padZero(base, len));
  }
  return list;
}

function padZero(s, len) {
  while (s.length < len) s = '0' + s;
  return s;
}

// 台股平日盤中時段（08:55~13:45，週六日不算），避免非交易時間浪費額度查價
function isTwMarketHoursServer() {
  var day = parseInt(Utilities.formatDate(new Date(), 'Asia/Taipei', 'u'), 10); // 1=一 ... 7=日
  if (day === 6 || day === 7) return false;
  var hm = parseInt(Utilities.formatDate(new Date(), 'Asia/Taipei', 'HHmm'), 10);
  return hm >= 855 && hm <= 1345;
}

// 每 10 分鐘由時間觸發器呼叫：讀取全部持股 → 批量查最新價 →
// 用「補零候選代號＋股名核對」防呆（避免 006208 被誤查成 6208=日揚）→ 價格有變才寫回。
function refreshStockQuotesServer() {
  if (!isTwMarketHoursServer()) return;

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return; // 上一輪還在跑就跳過

  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Stock_Holdings');
    if (!sheet) return;
    var holdings = readSheetAsObjectArray(sheet);
    if (holdings.length === 0) return;

    var allCands = [];
    var seen = {};
    holdings.forEach(function (h) {
      quoteCodeCandidatesServer(h.code).forEach(function (c) {
        if (!seen[c]) { seen[c] = true; allCands.push(c); }
      });
    });

    var quotes = getStockQuotes(allCands.join(','));
    var changed = false;

    holdings.forEach(function (h) {
      var held = String(h.name || '').trim();
      var cands = quoteCodeCandidatesServer(h.code);
      var matched = null, matchedCode = null;
      for (var i = 0; i < cands.length; i++) {
        var q = quotes[cands[i]];
        if (!q || !(q.price > 0)) continue;
        var quoted = String(q.name || '').trim();
        // 股名對不上就跳過，避免代號打錯或去零撞號污染價格
        if (held && quoted && held !== quoted && held.indexOf(quoted) === -1 && quoted.indexOf(held) === -1) continue;
        matched = q; matchedCode = cands[i];
        break;
      }
      if (!matched) return;
      if (matchedCode !== String(h.code).trim().toUpperCase() && /^0\d/.test(matchedCode)) {
        h.code = matchedCode; // 自我修復：補回正確的前導零代號
        changed = true;
      }
      if (Math.abs(matched.price - Number(h.price)) > 1e-9) {
        h.price = matched.price;
        changed = true;
      }
    });

    if (changed) {
      // ⚠️ 絕對不要在這裡寫死欄位清單！
      // 舊版寫死 code/name/shares/price/cost/category/reason/updatedAt，
      // 導致之後新增的欄位（例如 account 帳戶歸屬）每 10 分鐘就被這個排程整欄清空。
      // 改成直接沿用讀進來的整列物件，只覆寫 updatedAt，任何新欄位都會自動保留。
      replaceAllRows(sheet, holdings.map(function (h) {
        h.updatedAt = new Date().toISOString();
        return h;
      }));
    }
  } finally {
    lock.releaseLock();
  }
}

// 選單「① 安裝自動更新排程」：每 10 分鐘觸發一次 refreshStockQuotesServer
// （函式內部會自己判斷是否為盤中時段，非盤中時段觸發了也會直接跳過，不浪費額度）
function setupQuoteRefreshTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'refreshStockQuotesServer') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('refreshStockQuotesServer').timeBased().everyMinutes(10).create();
  SpreadsheetApp.getUi().alert('✅ 已安裝自動報價更新排程！\n\n開盤日（週一到五）08:55~13:45 之間，Google 伺服器每 10 分鐘會自動查一次真實股價寫回 Stock_Holdings 分頁，不需要打開 App，手機關著也會更新。');
}

// ---------- Read helpers ----------

function readAllSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const result = {};

  const assetSheet = ss.getSheetByName('Asset_Summary');
  result.Asset_Summary = assetSheet ? readSingleRowAsObject(assetSheet) : null;

  ['Stock_Holdings', 'Trade_Log', 'Consensus_Log', 'Daily_Log', 'NetWorth_History'].forEach(name => {
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
  const header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  // 自動擴充表頭：資料裡有、但表頭還沒有的欄位（例如新增的 account），
  // 補到最右邊。舊版直接沿用既有表頭，導致新欄位被默默丟掉、寫進去卻讀不到。
  const missing = keys.filter(function (k) { return header.indexOf(k) === -1; });
  if (missing.length > 0) {
    sheet.getRange(1, lastCol + 1, 1, missing.length).setValues([missing]);
    return header.concat(missing);
  }
  return header;
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

// 淨值歷史保留上限：超過 keepDays 筆就刪掉最舊的（依日期排序後從最前面砍）
function pruneNetWorthHistory(sheet, keepDays) {
  const lastRow = sheet.getLastRow();
  if (lastRow <= keepDays + 1) return; // +1 是表頭
  const lastCol = sheet.getLastColumn();
  const header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const dateIdx = header.indexOf('date');
  if (dateIdx === -1) return;
  const rows = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  rows.sort(function (a, b) {
    return String(toComparableKey(a[dateIdx])).localeCompare(String(toComparableKey(b[dateIdx])));
  });
  const kept = rows.slice(rows.length - keepDays);
  sheet.getRange(2, 1, lastRow - 1, lastCol).clearContent();
  if (kept.length) sheet.getRange(2, 1, kept.length, lastCol).setValues(kept);
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
    .addItem('③ 安裝每日自動掃描（約16:00）', 'setupStrategyTriggers')
    .addItem('④ 立即執行一次掃描', 'runManualScan')
    .addItem('⑤ 新增AI概念股擴充清單（共50檔，營收佔比≥20%從寬認定）', 'addAiExpansionPool')
    .addItem('查看引擎狀態', 'showStrategyStatusDialog')
    .addToUi();

  SpreadsheetApp.getUi()
    .createMenu('💹 報價自動更新')
    .addItem('① 安裝自動更新排程（開盤日每10分鐘）', 'setupQuoteRefreshTrigger')
    .addItem('② 立即更新一次（手動測試）', 'refreshStockQuotesServer')
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

// 預設 50 檔：報告七大題材 + AI 核心供應鏈（記憶體/散熱/CPO/載板/CCL/被動/PCB/國防
// + ASIC設計服務/AI電源/交換器/CPU插槽/伺服器導軌/重電）。股名由系統查價自動補。
const DEFAULT_STRATEGY_POOL = [
  ['記憶體', '2408'], ['記憶體', '2344'], ['記憶體', '2337'], ['記憶體', '8299'], ['記憶體', '3260'], ['記憶體', '3006'],
  ['AI散熱', '3017'], ['AI散熱', '3324'], ['AI散熱', '8996'], ['AI散熱', '2233'], ['AI散熱', '3653'],
  ['CPO光通訊', '3081'], ['CPO光通訊', '2383'], ['CPO光通訊', '4979'], ['CPO光通訊', '3450'], ['CPO光通訊', '6442'], ['CPO光通訊', '3587'],
  ['ABF載板', '3037'], ['ABF載板', '8046'], ['ABF載板', '3189'], ['ABF載板', '4958'],
  ['CCL銅箔', '6274'], ['CCL銅箔', '8358'], ['CCL銅箔', '6213'],
  ['被動元件', '2327'], ['被動元件', '2492'], ['被動元件', '3026'],
  ['PCB設備', '2368'], ['PCB設備', '3413'], ['PCB設備', '2313'],
  ['國防無人機', '2634'], ['國防無人機', '8033'], ['國防無人機', '2645'],
  ['AI核心', '2330'], ['AI核心', '2454'], ['AI核心', '2317'], ['AI核心', '2382'], ['AI核心', '3231'], ['AI核心', '6669'],
  ['AI核心', '2308'], ['AI核心', '3661'], ['AI核心', '3443'], ['AI核心', '2345'], ['AI核心', '3533'], ['AI核心', '4938'], ['AI核心', '2059'],
  ['能源', '1513'], ['能源', '1519'], ['能源', '6282'], ['能源', '1503']
];

// 2026-07-22：使用者要求把「尚未在股池裡的AI概念股」補進來，門檻是「AI相關營收佔比
// 約20%以上，從寬認定」——台股沒有公開API會直接回報「AI營收佔比」這種細分數字（月營收
// API只有總營收年增率，沒有產品線拆分），所以這份清單是依公開市場普遍認知的AI供應鏈
// 角色歸類（先進封測、伺服器品牌/機構、測試設備、矽智財IP、網通、連接器），不是從即時
// 資料算出來的精確比例，使用者可自行到基本面新聞核對後再決定是否停用。
// 同日追加39檔（使用者要求擴充到股池總數100檔），一樣是從寬認定的角色歸類，
// 部分較冷門的個股代號沒有辦法100%保證跟公開市場的印象完全吻合——但因為新增流程
// 一律會用 getStockQuotes 即時查真實股票名稱寫入，如果代號記錯，畫面上會直接顯示
// 「查到的實際公司名稱」而不是猜測的名稱，使用者一眼就能發現不符、直接在股池管理
// 畫面刪除即可，不會有靜默錯配的風險。
const AI_EXPANSION_POOL = [
  ['AI伺服器品牌', '2376'],
  ['先進封測', '3711'], ['先進封測', '2449'], ['先進封測', '6510'],
  ['IC測試設備', '2360'],
  ['矽智財IP', '3529'],
  ['網通晶片', '2379'],
  ['伺服器機構', '8210'], ['伺服器機構', '3013'],
  ['AI連接器', '6197'], ['AI連接器', '4977'],
  ['先進封測擴充', '6239'], ['先進封測擴充', '3374'], ['先進封測擴充', '6191'],
  ['IC設計矽智財擴充', '3035'], ['IC設計矽智財擴充', '6533'], ['IC設計矽智財擴充', '2401'],
  ['晶圓代工半導體材料', '5347'], ['晶圓代工半導體材料', '2338'], ['晶圓代工半導體材料', '3532'],
  ['伺服器ODM品牌', '2357'], ['伺服器ODM品牌', '2356'],
  ['網通設備擴充', '6285'], ['網通設備擴充', '3596'], ['網通設備擴充', '4906'], ['網通設備擴充', '6142'],
  ['PCB供應鏈擴充', '2316'], ['PCB供應鏈擴充', '3044'],
  ['伺服器電源連接器擴充', '6412'], ['伺服器電源連接器擴充', '6805'], ['伺服器電源連接器擴充', '2385'], ['伺服器電源連接器擴充', '8103'],
  ['半導體設備擴充', '3680'], ['半導體設備擴充', '3131'], ['半導體設備擴充', '3583'], ['半導體設備擴充', '6438'], ['半導體設備擴充', '6187'],
  ['光通訊RF擴充', '3105'], ['光通訊RF擴充', '2455'], ['光通訊RF擴充', '3234'],
  ['IC通路系統整合', '3702'], ['IC通路系統整合', '2347'],
  ['AI周邊感測邊緣運算', '3227'], ['AI周邊感測邊緣運算', '6188'], ['AI周邊感測邊緣運算', '6182'],
  ['AI周邊感測邊緣運算', '5388'], ['AI周邊感測邊緣運算', '2467'], ['AI周邊感測邊緣運算', '8261'],
  ['AI周邊感測邊緣運算', '6202'], ['AI周邊感測邊緣運算', '3211']
];

// 把 AI_EXPANSION_POOL 裡「股池還沒有的代號」補進 Strategy_Pool，已存在的代號跳過
// （用代號比對防重複，可放心重複執行），跟 backfillMissingPoolNames 同樣不觸碰既有列。
function addAiExpansionPool() {
  const sheet = getOrCreateSheetWithHeader('Strategy_Pool', ['theme', 'code', 'name', 'enabled']);
  const lastRow = sheet.getLastRow();
  const existingCodes = {};
  if (lastRow >= 2) {
    sheet.getRange(2, 2, lastRow - 1, 1).getValues().forEach(function (r) {
      existingCodes[String(r[0]).trim().toUpperCase()] = true;
    });
  }
  const toAdd = AI_EXPANSION_POOL.filter(function (p) { return !existingCodes[p[1]]; });
  if (toAdd.length === 0) {
    SpreadsheetApp.getUi().alert('AI概念股擴充清單（共' + AI_EXPANSION_POOL.length + '檔）都已經在股池裡了，沒有新增任何股票。');
    return;
  }
  const quotes = getStockQuotes(toAdd.map(function (p) { return p[1]; }).join(','));
  const rows = toAdd.map(function (p) {
    const q = quotes[p[1]] || null;
    return [p[0], protectLeadingZeros(p[1]), (q && q.name) || '', true];
  });
  sheet.getRange(lastRow + 1, 1, rows.length, 4).setValues(rows);
  const missingCount = rows.filter(function (r) { return !r[2]; }).length;
  const skipped = AI_EXPANSION_POOL.length - toAdd.length;
  SpreadsheetApp.getUi().alert(
    '已新增 ' + rows.length + ' 檔AI概念股到股池' +
    (skipped > 0 ? '（另有 ' + skipped + ' 檔原本就已在股池裡，已跳過）' : '') +
    (missingCount > 0 ? '\n（其中 ' + missingCount + ' 檔查價暫時失敗，股名留空，下次執行「④ 立即執行一次掃描」或再點一次這個選單會自動補上）' : '') +
    '\n\n這份清單是依公開市場認知的AI供應鏈角色歸類，門檻為AI相關營收佔比約20%以上從寬認定，' +
    '不是精確財報數字。股票名稱是即時查回來的真實資料，如果看到某一列的公司名稱跟您預期的不一樣，' +
    '代表代號對應到別家公司，請直接到股池管理畫面刪除那一列即可，不影響其他股票。建議有空時自行核對基本面後決定是否保留。'
  );
}

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
  dailySummaryEmail: true,
  financeNoteApiUrl: ''
};

function ensureStrategyPool() {
  const sheet = getOrCreateSheetWithHeader('Strategy_Pool', ['theme', 'code', 'name', 'enabled']);
  ensureStrategyConfig();
  if (sheet.getLastRow() >= 2) {
    // 已有資料，仍嘗試補上任何缺股名的列（例如舊版部署留下的空白名稱），不觸碰已經有名稱的列
    backfillMissingPoolNames(sheet);
    SpreadsheetApp.getUi().alert('Strategy_Pool 已有資料（' + (sheet.getLastRow() - 1) + ' 筆），不重複建立。如需重置，請自行清空分頁內容後再執行一次。');
    return;
  }
  // 一次批量查價把 50 檔的股票名稱都補齊，使用者建立股池當下就看得到名稱，
  // 不必等第一次掃描或回補跑完（getStockQuotes 已是單次批量請求，不會多打 API）
  const codes = DEFAULT_STRATEGY_POOL.map(function (p) { return p[1]; });
  const quotes = getStockQuotes(codes.join(','));
  const rows = DEFAULT_STRATEGY_POOL.map(function (p) {
    const q = quotes[p[1]] || null;
    return [p[0], protectLeadingZeros(p[1]), (q && q.name) || '', true];
  });
  sheet.getRange(2, 1, rows.length, 4).setValues(rows);
  const missingCount = rows.filter(function (r) { return !r[2]; }).length;
  SpreadsheetApp.getUi().alert('已建立 Strategy_Pool，共 ' + rows.length + ' 檔預設題材股池' +
    (missingCount > 0 ? '（其中 ' + missingCount + ' 檔查價暫時失敗，股名留空，執行一次「④ 立即執行一次掃描」後會自動補上）' : '，股票名稱已一併查妥') +
    '。可直接在此分頁增刪（enabled 欄填 FALSE 可暫時停用某檔）。');
}

// 補上 Strategy_Pool 裡任何 name 欄位是空的列（新裝股池的一次性防呆，或舊版部署留下的空白）
function backfillMissingPoolNames(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;
  const data = sheet.getRange(2, 1, lastRow - 1, 4).getValues();
  const missingIdx = [];
  const missingCodes = [];
  data.forEach(function (r, i) {
    if (!r[2]) { missingIdx.push(i); missingCodes.push(String(r[1]).trim()); }
  });
  if (missingCodes.length === 0) return;
  const quotes = getStockQuotes(missingCodes.join(','));
  missingIdx.forEach(function (i) {
    const code = String(data[i][1]).trim();
    const q = quotes[code];
    if (q && q.name) sheet.getRange(i + 2, 3).setValue(q.name);
  });
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
// 2026-07-23：openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL 實測常常要等到很晚
// （晚上10點多）才公布當天資料，連續兩天實測都是如此。改用證交所自己網站顯示「每日收盤
// 行情」用的後端(www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX)當第一優先——這個是TWSE
// 官網自己拿來即時顯示給一般訪客看的資料源，實測同一個晚上就已經有完整全市場資料，比
// STOCK_DAY_ALL快非常多；且用兩檔真實股票(2330/8358)跟其他官方資料源交叉比對過收盤價、
// 漲跌方向都吻合，確認資料正確可信。要明確帶「今天日期」查詢，查無資料(還沒開盤/非交易日/
// TWSE臨時異常)時會回傳非'OK'的stat，此時直接回傳空結果，讓呼叫端自動退回下面的
// STOCK_DAY_ALL當備援——不影響任何既有行為，純粹是「先試更快的，失敗才退回原本的」。
function fetchTseFromMiIndex(dateStr) {
  const result = { tradeDate: '', tse: {} };
  try {
    const url = 'https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX?date=' + dateStr +
      '&type=ALLBUT0999&response=json&_=' + Date.now();
    const resp = UrlFetchApp.fetch(url, {
      muteHttpExceptions: true,
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
        'Referer': 'https://www.twse.com.tw/zh/trading/historical/mi-index.html'
      }
    });
    if (resp.getResponseCode() !== 200) return result;
    const data = JSON.parse(resp.getContentText());
    if (data.stat !== 'OK' || !Array.isArray(data.tables)) return result;
    const table = data.tables.filter(function (t) { return t && t.title && t.title.indexOf('每日收盤行情') !== -1; })[0];
    if (!table || !Array.isArray(table.data)) return result;
    table.data.forEach(function (r) {
      const code = (r[0] || '').toString().trim();
      const close = parseNumLoose(r[8]);
      if (!code || close === null) return;
      const magnitude = parseNumLoose(r[10]);
      // 漲跌方向藏在HTML樣式字串裡：TWSE慣例紅漲綠跌，跟西方市場相反
      const isDown = /color:\s*green/i.test(String(r[9] || ''));
      const change = magnitude === null ? null : (isDown ? -magnitude : magnitude);
      result.tse[code] = {
        code: code, name: r[1] || '',
        open: parseNumLoose(r[5]), high: parseNumLoose(r[6]), low: parseNumLoose(r[7]), close: close,
        volume: parseNumLoose(r[2]), tradeValue: parseNumLoose(r[4]),
        change: change, market: 'twse'
      };
    });
    if (Object.keys(result.tse).length > 0) {
      result.tradeDate = dateStr.slice(0, 4) + '-' + dateStr.slice(4, 6) + '-' + dateStr.slice(6, 8);
    }
  } catch (err) { /* 失敗就回傳空結果，呼叫端會自動退回STOCK_DAY_ALL */ }
  return result;
}

function fetchDailyAll() {
  const result = { tradeDate: '', tse: {}, otc: {} };

  const todayIso8 = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyyMMdd');
  const fast = fetchTseFromMiIndex(todayIso8);
  if (fast.tradeDate && Object.keys(fast.tse).length > 0) {
    result.tradeDate = fast.tradeDate;
    result.tse = fast.tse;
  } else {
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
            close: close, volume: parseNumLoose(r.TradeVolume), tradeValue: parseNumLoose(r.TradeValue),
            change: parseNumLoose(r.Change), market: 'twse'
          };
        });
      }
    } catch (err) { /* result.tse 保持空，該次掃描 A/C/D 校對到的上市資料會不足，下次再試 */ }
  }

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
          close: close, volume: parseNumLoose(r.TradingShares), tradeValue: parseNumLoose(r.TransactionAmount),
          change: parseNumLoose(r.Change), market: 'tpex'
        };
      });
    }
  } catch (err) { /* result.otc 保持空 */ }

  if (!result.tradeDate) result.tradeDate = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd');
  return result;
}

// 2026-07-22：STOCK_DAY_ALL（上市全市場）常常要等到很晚才公布當天資料（實測過晚上10點多
// 都還沒更新），但即時報價 MIS 在收盤後很快就有當天完整的開高低收量。這裡改用 MIS 幫「股池
// ＋持股」這一小批代號（不是全市場）搶先取得今天的資料，讓不需要全市場排名的C/D/E流派與
// 停損儀表板可以當天就更新；需要「全市場成交值排名」的A流派、和本來就要掃全市場的R流派
// (全市場強勢股雷達)無法用這個資料源，那兩個部分會在這次掃描中跳過，等 STOCK_DAY_ALL
// 正式資料到了之後的下一次掃描自動補上（見 dailyStrategyScan 的 isUpgradeOpportunity 分支）。
// 量能單位換算：MIS 的 v 欄位是「張」（1張=1000股），實測跟櫃買中心官方當日資料交叉比對，
// 誤差在3~5%以內（差異是零股交易沒被算進整股成交量），足夠支撐量比類技術判斷，但不是
// 100%精確口徑，STOCK_DAY_ALL 正式資料到了之後仍會覆蓋成官方數字。
function fetchDailyFromMisForPool(codes) {
  const result = { tradeDate: '', tse: {}, otc: {} };
  const uniq = uniqueArray(codes.map(function (c) { return String(c).trim().toUpperCase(); }));
  if (uniq.length === 0) return result;

  const chunks = [];
  for (let i = 0; i < uniq.length; i += STOCK_QUOTE_CHUNK_SIZE) chunks.push(uniq.slice(i, i + STOCK_QUOTE_CHUNK_SIZE));

  const requests = chunks.map(function (chunk) {
    const exChList = [];
    chunk.forEach(function (c) { exChList.push('tse_' + c + '.tw'); exChList.push('otc_' + c + '.tw'); });
    return {
      url: 'https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=' +
        encodeURIComponent(exChList.join('|')) + '&json=1&delay=0&_=' + Date.now(),
      muteHttpExceptions: true,
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
        'Referer': 'https://mis.twse.com.tw/stock/index.jsp'
      }
    };
  });

  let responses;
  try {
    responses = (requests.length === 1) ? [UrlFetchApp.fetch(requests[0].url, requests[0])] : UrlFetchApp.fetchAll(requests);
  } catch (err) { return result; }

  responses.forEach(function (resp) {
    try {
      if (resp.getResponseCode() !== 200) return;
      const data = JSON.parse(resp.getContentText());
      if (!data.msgArray) return;
      data.msgArray.forEach(function (m) {
        const code = (m.c || '').toString().trim().toUpperCase();
        const close = pickNumber(m.z);
        if (!code || close === null || close <= 0) return;
        if (!result.tradeDate && m.d) result.tradeDate = isoDateFromMis(m.d);
        const volumeLots = pickNumber(m.v);
        const rec = {
          code: code, name: m.n || m.nf || '',
          open: pickNumber(m.o), high: pickNumber(m.h), low: pickNumber(m.l), close: close,
          volume: volumeLots !== null ? Math.round(volumeLots * 1000) : null,
          market: (m.ex === 'otc' ? 'otc-mis' : 'tse-mis')
        };
        if (m.ex === 'otc') result.otc[code] = rec; else result.tse[code] = rec;
      });
    } catch (e) { /* 該批解析失敗就跳過，不影響其他批次 */ }
  });
  return result;
}

// MIS 的日期欄位是西元8碼(20260722)，跟 STOCK_DAY_ALL/TPEX 用的民國7碼不同，不能共用 rocDateToIso
function isoDateFromMis(d) {
  const s = String(d).trim();
  if (!/^\d{8}$/.test(s)) return '';
  return s.slice(0, 4) + '-' + s.slice(4, 6) + '-' + s.slice(6, 8);
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

// opts.upgradeFromMis：true 時，若同一天同一檔代號的舊資料是先前用 MIS 備援寫入的
// （market 欄位以 '-mis' 結尾），改用這次拿到的官方資料覆寫該列，把量能等數字校正為正式口徑。
function appendDailyHistory(sheet, dateStr, codes, daily, opts) {
  const upgradeFromMis = !!(opts && opts.upgradeFromMis);
  const existing = {};
  const lastRow = sheet.getLastRow();
  if (lastRow >= 2) {
    const data = sheet.getRange(2, 1, lastRow - 1, 9).getValues();
    data.forEach(function (r, i) {
      if (toComparableKey(r[0]) === dateStr) existing[String(r[1])] = { rowIndex: i + 2, market: r[8] };
    });
  }
  const newRows = [];
  const upgrades = [];
  codes.forEach(function (code) {
    const rec = daily.tse[code] || daily.otc[code];
    if (!rec) return;
    const rowValues = [dateStr, protectLeadingZeros(code), rec.name || '', rec.open || '', rec.high || '', rec.low || '', rec.close || '', rec.volume || '', rec.market];
    const ex = existing[code];
    if (!ex) { newRows.push(rowValues); return; }
    if (upgradeFromMis && /-mis$/.test(String(ex.market || ''))) upgrades.push({ rowIndex: ex.rowIndex, values: rowValues });
    // 否則該天已經有正式資料了，不重複寫入
  });
  if (newRows.length > 0) sheet.getRange(sheet.getLastRow() + 1, 1, newRows.length, 9).setValues(newRows);
  upgrades.forEach(function (u) { sheet.getRange(u.rowIndex, 1, 1, 9).setValues([u.values]); });
  return newRows.length + upgrades.length;
}

// 檢查某一天的 Price_History 資料是不是（至少部分）由 MIS 備援寫入的（market 欄位以 '-mis' 結尾）
function isDateMisSourced(sheet, dateStr) {
  if (!dateStr) return false;
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return false;
  const data = sheet.getRange(2, 1, lastRow - 1, 9).getValues();
  for (let i = 0; i < data.length; i++) {
    if (toComparableKey(data[i][0]) === dateStr && /-mis$/.test(String(data[i][8] || ''))) return true;
  }
  return false;
}

// ---------- 通用批次刪列（效能關鍵）----------
// 2026-07-30：使用者真機掃描出現「執行時間已達上限」。追查發現多個函式都在用
// 「for 迴圈裡逐列 sheet.deleteRow()」——Apps Script 每次 deleteRow 都是一次獨立的
// 試算表往返（約 0.1~0.3 秒），幾百列累積起來就足以吃掉單次執行的 6 分鐘上限。
// 最致命的是 clearSignalsForDate：每次重掃同一天都要先清掉當天全部訊號，而使用者
// 實測單日訊號數是 240 筆，等於每掃一次就先花上百次往返在刪除上。
//
// 這個共用函式改成「算出要保留的列 → 一次 setValues 寫回 → 一次 deleteRows 砍掉尾巴」，
// 不論刪 10 列還是 10,000 列都只有 2 次試算表操作。
// shouldKeep(row, index) 回傳 true 表示保留該列。回傳實際刪除的列數。
function rewriteSheetKeepingRows(sheet, numCols, shouldKeep) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;
  const data = sheet.getRange(2, 1, lastRow - 1, numCols).getValues();
  const keep = [];
  data.forEach(function (row, i) { if (shouldKeep(row, i)) keep.push(row); });
  const removed = data.length - keep.length;
  if (removed === 0) return 0;
  if (keep.length > 0) sheet.getRange(2, 1, keep.length, numCols).setValues(keep);
  sheet.deleteRows(keep.length + 2, removed);
  return removed;
}

function pruneOldHistory(sheet, keepDays) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;
  const dateCol = sheet.getRange(2, 1, lastRow - 1, 1).getValues().map(function (r) { return toComparableKey(r[0]); });
  const uniqueDates = uniqueArray(dateCol).sort();
  if (uniqueDates.length <= keepDays) return;
  const cutoff = uniqueDates[uniqueDates.length - keepDays - 1];
  // Price_History 是全系統最大的分頁（100檔股票×210天可達2萬列以上），
  // 逐列刪除在這裡的後果最嚴重，必須走批次
  rewriteSheetKeepingRows(sheet, 9, function (row) {
    return toComparableKey(row[0]) > cutoff;
  });
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

// ---------- 每日回補配額防護閥 ----------
// UrlFetchApp 每日上限 20,000 次，這個系統實際每日自動掃描只用約 7 次、
// 前端報價輪詢約 58 次，遠低於上限。唯一會「乘倍數」的是歷史回補（1檔=3次，
// 因 TWSE 按月查）。這道防護閥不是因為容易撞到 20,000（正常使用差兩個數量級），
// 而是因為 Code.gs 是同一個 Apps Script 專案，萬一真的用完當日額度，
// 連 getAll/quote 這些核心讀寫功能都會一起壞掉——用便宜的上限防一個機率低、
// 但後果嚴重（整個戰情室癱瘓）的情境。
const DAILY_BACKFILL_FETCH_CAP = 300; // 遠高於單次批次回補(~55檔×3≈165次)，也遠低於20,000

function consumeBackfillBudget(cost) {
  const props = PropertiesService.getScriptProperties();
  const today = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd');
  const key = 'backfillFetchCount_' + today;
  const used = parseInt(props.getProperty(key) || '0', 10);
  if (used + cost > DAILY_BACKFILL_FETCH_CAP) return false;
  props.setProperty(key, String(used + cost));
  return true;
}

// 單檔回補近3個月歷史（僅上市有效；回傳 {fetched, appended, budgetExceeded}）
// 單檔回補近3個月歷史。2026-07-21 改用 UrlFetchApp.fetchAll() 把 3 個月的請求
// 併成一次批次呼叫（伺服器端併發處理），把每檔股票的「3次序列請求+3次sleep」
// 壓成「1次批次請求+1次sleep」，大幅縮短總耗時——股池擴到50檔後，原本逐月序列
// 抓取（~168次請求+~50秒sleep，總耗時可能逼近甚至超過 Apps Script 6分鐘執行上限，
// 使用者實測「② 回補歷史股價」跑很久甚至逾時）就是為了解決這個問題而改的。
function backfillHistoryForCode(code) {
  const sheet = getOrCreateSheetWithHeader('Price_History', ['date', 'code', 'name', 'open', 'high', 'low', 'close', 'volume', 'market']);
  const months = getRecentYyyyMm(3);

  if (!consumeBackfillBudget(months.length)) {
    return { fetched: 0, appended: 0, budgetExceeded: true };
  }

  const requests = months.map(function (ym) {
    return {
      url: 'https://www.twse.com.tw/rwd/zh/afterTrading/STOCK_DAY?date=' + ym + '01&stockNo=' + code + '&response=json',
      muteHttpExceptions: true, headers: { 'Accept': 'application/json' }
    };
  });

  let fetched = 0, appended = 0;
  try {
    const responses = UrlFetchApp.fetchAll(requests);
    responses.forEach(function (resp) {
      try {
        if (resp.getResponseCode() !== 200) return;
        const json = JSON.parse(resp.getContentText());
        if (json.stat === 'OK' && Array.isArray(json.data)) {
          const rows = json.data.map(function (r) {
            return [rocDateToIso(r[0]), protectLeadingZeros(code), '', parseNumLoose(r[3]), parseNumLoose(r[4]), parseNumLoose(r[5]), parseNumLoose(r[6]), parseNumLoose(r[1]), 'twse'];
          }).filter(function (r) { return r[0] && r[6] !== null; });
          fetched += rows.length;
          if (rows.length > 0) appended += appendHistoryRowsDedup(sheet, rows);
        }
      } catch (e) { /* 該月解析失敗就跳過，不影響其他月份 */ }
    });
  } catch (e) { /* 整批請求失敗（如網路問題）就跳過這檔，不影響其他股票 */ }

  Utilities.sleep(300); // 每「檔股票」節流一次（不是每個月），避免對 TWSE 造成瞬間尖峰負載
  return { fetched: fetched, appended: appended, budgetExceeded: false };
}

function backfillHistory() {
  const pool = getStrategyPoolRows();
  if (pool.length === 0) { SpreadsheetApp.getUi().alert('請先執行「① 建立預設題材股池」。'); return; }
  const codes = uniqueArray(pool.map(function (p) { return p.code; }).concat(getHoldingCodesForScan()));
  let totalAppended = 0; let notFoundCount = 0; let budgetStoppedCount = 0;

  for (let i = 0; i < codes.length; i++) {
    const r = backfillHistoryForCode(codes[i]);
    totalAppended += r.appended;
    if (r.budgetExceeded && r.fetched === 0) { budgetStoppedCount = codes.length - i; break; } // 額度用完，剩下的股票留給下次執行或每日自動累積
    if (r.fetched === 0) notFoundCount++;
  }

  let msg = '歷史回補完成。共新增 ' + totalAppended + ' 筆（上市個股適用）。\n' +
    notFoundCount + ' 檔（多為上櫃股）目前查無歷史資料——上櫃股歷史端點目前已失效，將改為每日自動累積，' +
    '約需 40~60 個交易日才會補滿均線類訊號所需的資料量，這段期間前端會標示「資料累積中」。';
  if (budgetStoppedCount > 0) {
    msg += '\n\n⚠️ 今日歷史回補已達每日保護上限（避免異常大量請求把 Apps Script 每日 API 額度用光，影響其他功能），' +
      '還有 ' + budgetStoppedCount + ' 檔沒回補到，明天可以再執行一次這個選單，或等每日自動掃描逐步累積。';
  }
  SpreadsheetApp.getUi().alert(msg);
}

// ---------- 股池管理 API（供前端「題材股池管理」區塊使用）----------

function getPoolPayload() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Strategy_Pool');
  const rows = sheet ? readSheetAsObjectArray(sheet) : [];
  // 股池種子資料沒填股名，用 Price_History 裡最後出現的名稱補顯示
  const nameMap = {};
  const hist = ss.getSheetByName('Price_History');
  if (hist && hist.getLastRow() >= 2) {
    const data = hist.getRange(2, 2, hist.getLastRow() - 1, 2).getValues(); // code, name
    data.forEach(function (r) {
      const c = String(r[0]).trim();
      if (c && r[1]) nameMap[c] = String(r[1]);
    });
  }
  return {
    items: rows.filter(function (r) { return r.code; }).map(function (r) {
      const code = String(r.code).trim();
      return {
        theme: r.theme || '',
        code: code,
        name: String(r.name || nameMap[code] || ''),
        enabled: !(r.enabled === false || r.enabled === 'FALSE')
      };
    })
  };
}

function poolAddStock(theme, code) {
  theme = String(theme || '').trim() || '未分類';
  code = String(code || '').trim().toUpperCase();
  if (!/^[0-9A-Z]{4,6}$/.test(code)) return { added: false, message: '代號格式不正確：' + code };

  const sheet = getOrCreateSheetWithHeader('Strategy_Pool', ['theme', 'code', 'name', 'enabled']);
  const existing = readSheetAsObjectArray(sheet);
  if (existing.some(function (r) { return String(r.code).trim().toUpperCase() === code; })) {
    return { added: false, message: code + ' 已經在股池裡了' };
  }

  // 查價確認這檔股票存在，順便拿股名與市場別
  const q = getStockQuotes(code)[code] || null;
  if (!q || !q.name) return { added: false, message: '查不到 ' + code + ' 這檔股票，請確認代號是否正確' };

  sheet.appendRow([theme, protectLeadingZeros(code), q.name, true]);

  // 上市股立刻回補近3個月歷史，均線類訊號隔天就能用；上櫃股只能每日累積
  let backfilled = 0;
  let budgetNote = '';
  if (q.source === '上市') {
    const r = backfillHistoryForCode(code);
    backfilled = r.appended;
    if (r.budgetExceeded) budgetNote = '（今日歷史回補額度已用完，剩餘月份會由每日自動掃描逐步補齊）';
  }
  return {
    added: true, code: code, name: q.name, market: q.source, backfilled: backfilled,
    message: q.source === '上市'
      ? '已加入「' + theme + '」並回補 ' + backfilled + ' 筆歷史股價，下次掃描起生效' + budgetNote
      : '已加入「' + theme + '」。上櫃股的歷史資料需每日累積約40~60個交易日，期間均線類訊號會自動跳過'
  };
}

function poolRemoveStock(code) {
  code = String(code || '').trim().toUpperCase();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Strategy_Pool');
  if (!sheet || sheet.getLastRow() < 2) return { removed: false, message: '股池是空的' };
  const vals = sheet.getRange(2, 2, sheet.getLastRow() - 1, 1).getValues();
  for (let i = vals.length - 1; i >= 0; i--) {
    if (String(vals[i][0]).trim().toUpperCase() === code) {
      sheet.deleteRow(i + 2);
      return { removed: true, code: code };
    }
  }
  return { removed: false, message: '股池裡找不到 ' + code };
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

// 🔭 全市場強勢股雷達：股池以外的「候選股發現器」。
// 只用當日單根K就能算的條件（全市場沒有歷史資料，量比/均線類條件都做不到）：
// 成交值前150名（胃納量門檻）∩ 漲幅≥5% ∩ 紅K實體佔比≥80%（頂天立地的單日精神）。
// 排除 ETF/ETN（00開頭）與股池內股票（股池內的有完整掃描）。輸出上限10檔。
function runMarketRadar(daily, poolCodeSet, scanDate) {
  const rows = [];
  const all = [];
  Object.keys(daily.tse).forEach(function (c) { all.push(daily.tse[c]); });
  Object.keys(daily.otc).forEach(function (c) { all.push(daily.otc[c]); });
  const ranked = all.filter(function (r) { return r.tradeValue && r.close; })
    .sort(function (a, b) { return b.tradeValue - a.tradeValue; });

  const hits = [];
  for (let i = 0; i < ranked.length && i < 150; i++) {
    const r = ranked[i];
    if (poolCodeSet[r.code]) continue;
    if (/^00/.test(r.code)) continue;
    if (r.change === null || r.change === undefined) continue;
    const prevClose = r.close - r.change;
    if (!(prevClose > 0)) continue;
    const changePct = r.change / prevClose;
    if (changePct < 0.05) continue;
    if (r.open === null || r.high === null || r.low === null || r.high <= r.low) continue;
    const body = (r.close - r.open) / (r.high - r.low);
    if (body < 0.8) continue;
    hits.push({ rec: r, changePct: changePct, rank: i + 1 });
  }
  hits.sort(function (a, b) { return b.changePct - a.changePct; });

  hits.slice(0, 10).forEach(function (h) {
    const plan = {
      school: 'R', signal: '全市場強勢',
      entry: '單日初篩（只看當日量價，沒有均線/量比佐證），想追蹤請先加入股池累積完整資料',
      position: '觀察名單，非進場訊號',
      stop: '—', exit: '—',
      note: '成交值第' + h.rank + '名，漲幅' + round2(h.changePct * 100) + '%，' + (h.rec.market === 'tpex' ? '上櫃' : '上市')
    };
    rows.push([scanDate, protectLeadingZeros(h.rec.code), h.rec.name, '', 'R', '全市場強勢',
      h.rec.close, round4(h.changePct), '', '', JSON.stringify(plan), new Date().toISOString()]);
  });
  return { rows: rows };
}

// 📈 訊號成績單（M5）：C流派訊號發生滿10個交易日後，自動計算5日/10日報酬並存檔。
// 目的是對抗倖存者偏誤——讓數據告訴你哪個訊號在目前行情有效、哪個只是漂亮的名字。
function evaluateSignalOutcomes(signalSheet, histByCode) {
  const scoreSheet = getOrCreateSheetWithHeader('Signal_Score', ['date', 'code', 'name', 'signal', 'entryClose', 'ret5', 'ret10', 'evaluatedAt']);
  const existing = {};
  if (scoreSheet.getLastRow() >= 2) {
    const data = scoreSheet.getRange(2, 1, scoreSheet.getLastRow() - 1, 4).getValues();
    data.forEach(function (r) {
      existing[toComparableKey(r[0]) + '|' + String(r[1]).trim() + '|' + String(r[3])] = true;
    });
  }
  const rows = readSheetAsObjectArray(signalSheet);
  const toAppend = [];
  rows.forEach(function (r) {
    if (r.school !== 'C') return; // 只評估「進場型」訊號（A/D/E/R 是觀察榜，不是進場點）
    const code = String(r.code).trim();
    const sigDate = toComparableKey(r.date);
    const key = sigDate + '|' + code + '|' + String(r.signal);
    if (existing[key]) return;
    const hist = histByCode[code];
    if (!hist || hist.length === 0) return;
    let idx = -1;
    for (let i = 0; i < hist.length; i++) { if (hist[i].date === sigDate) { idx = i; break; } }
    if (idx === -1 || !hist[idx].close) return;
    if (hist.length - 1 < idx + 10) return; // 未滿10個交易日，之後的掃描再評
    const entry = hist[idx].close;
    const c5 = hist[idx + 5].close;
    const c10 = hist[idx + 10].close;
    if (!c5 || !c10) return;
    toAppend.push([sigDate, protectLeadingZeros(code), r.name || '', r.signal, entry,
      round4((c5 - entry) / entry), round4((c10 - entry) / entry), new Date().toISOString()]);
    existing[key] = true;
  });
  if (toAppend.length > 0) scoreSheet.getRange(scoreSheet.getLastRow() + 1, 1, toAppend.length, 8).setValues(toAppend);
  return toAppend.length;
}

// 2026-07-23：使用者反映Google試算表未來資料量會越來越龐大，要求策略選股的個股數據
// 除了系統還需要用的之外，其餘定期自動清除。Signal_Log(每日訊號紀錄)原本完全沒有清理
// 機制會無限累積，是最需要處理的表。
//
// 保留期用14個交易日，而不是使用者建議的7天：C流派訊號要滿10個交易日後才會被
// evaluateSignalOutcomes()評分寫進Signal_Score，14天多留4天緩衝，確保評分一定來得及
// 做完才會被刪除，不會有訊號還沒被評分就被清掉、永久遺失這筆勝率樣本的風險。
// 長期的訊號勝率統計(M5成績單，見getScorecardSummary)本來就不是靠保留Signal_Log原始
// 資料撐著的——已評分過的結果會另外寫進Signal_Score(只存日期/代號/訊號/報酬率的
// 精簡表格)永久保留不受這裡影響，所以清掉Signal_Log的舊列完全不影響M5的長期勝率統計。
//
// Price_History(股價歷史)已經有existing的210天保留機制(pruneOldHistory)，這是系統
// 計算均線(最長需要60天)必須用到的資料，屬於使用者說的「你需要繼續使用的」，故意
// 不跟著縮短成一週。
var SIGNAL_LOG_RETENTION_DAYS = 14;

// 未評分C流派訊號的最終保護期限。正常情況下C訊號滿10個交易日就會被評分、之後由
// 保留期規則清掉；但如果某檔股票被移出股池（loadHistoryByCode 只載入股池+持股，
// 移出後就再也算不出報酬）它會永遠評不了分、也就永遠不會被刪，變成慢性的資料洩漏。
// 超過這個天數一律清除：到這時候早就不可能再補評分了，留著只是佔空間。
var SIGNAL_LOG_HARD_LIMIT_DAYS = 60;

function pruneOldSignalLog(signalSheet, scoreSheet) {
  const lastRow = signalSheet.getLastRow();
  if (lastRow < 2) return 0;
  const data = signalSheet.getRange(2, 1, lastRow - 1, 12).getValues();
  const dateCol = data.map(function (r) { return toComparableKey(r[0]); });
  const uniqueDates = uniqueArray(dateCol).sort();
  if (uniqueDates.length <= SIGNAL_LOG_RETENTION_DAYS) return 0;
  const cutoff = uniqueDates[uniqueDates.length - SIGNAL_LOG_RETENTION_DAYS - 1]; // 這天(含)以前才考慮刪除
  const hardCutoff = uniqueDates.length > SIGNAL_LOG_HARD_LIMIT_DAYS
    ? uniqueDates[uniqueDates.length - SIGNAL_LOG_HARD_LIMIT_DAYS - 1] : null;

  // C流派訊號如果還沒被評分過(Signal_Score裡查不到對應紀錄)，即使超過保留期也先留著，
  // 等真的評分完再讓下一次清理刪掉——避免資料還沒來得及評分就被清掉，永久遺失這筆勝率樣本
  const evaluatedKeys = {};
  if (scoreSheet && scoreSheet.getLastRow() >= 2) {
    scoreSheet.getRange(2, 1, scoreSheet.getLastRow() - 1, 4).getValues().forEach(function (r) {
      evaluatedKeys[toComparableKey(r[0]) + '|' + String(r[1]).trim() + '|' + String(r[3])] = true;
    });
  }

  // 2026-07-30：原本用「逐列 deleteRow」，實測使用者的 Signal_Log 已累積約 785 列，
  // 第一次清理要刪 300 列以上——Apps Script 每次 deleteRow 都是一次獨立的試算表操作，
  // 幾百次累積起來可能拖垮單次執行的 6 分鐘上限，讓整個掃描看起來「跑到一半沒反應」。
  // 改成「算出要保留的列 → 一次 setValues 寫回 → 一次 deleteRows 砍掉多餘的尾巴」，
  // 總共只有 2 次試算表操作，不管刪幾百列都是同樣速度。
  return rewriteSheetKeepingRows(signalSheet, 12, function (row, i) {
    const rowDate = dateCol[i];
    if (rowDate > cutoff) return true; // 還在保留期內
    if (String(row[4]) === 'C') {
      const key = rowDate + '|' + String(row[1]).trim() + '|' + String(row[5]);
      const beyondHardLimit = hardCutoff !== null && rowDate <= hardCutoff;
      if (!evaluatedKeys[key] && !beyondHardLimit) return true; // 還沒評分完，先留著
    }
    return false; // A/D/E/R 超過保留期、C已評分、C超過最終期限 → 刪除
  });
}

function getScorecardSummary() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Signal_Score');
  const rows = sheet ? readSheetAsObjectArray(sheet) : [];
  const bySignal = {};
  rows.forEach(function (r) {
    const ret10 = parseNumLoose(r.ret10);
    if (ret10 === null) return;
    const s = String(r.signal);
    bySignal[s] = bySignal[s] || { signal: s, n: 0, wins: 0, sum: 0 };
    bySignal[s].n++;
    if (ret10 > 0) bySignal[s].wins++;
    bySignal[s].sum += ret10;
  });
  const stats = Object.keys(bySignal).map(function (s) {
    const m = bySignal[s];
    return { signal: s, n: m.n, winRate: round4(m.wins / m.n), avgRet10: round4(m.sum / m.n) };
  }).sort(function (a, b) { return b.n - a.n; });
  const recent = rows.slice(-10).reverse().map(function (r) {
    return { date: toComparableKey(r.date), code: String(r.code), name: r.name, signal: r.signal, ret10: parseNumLoose(r.ret10) };
  });
  return { evaluated: rows.length, stats: stats, recent: recent };
}

// ---------- 主流程：每日掃描 ----------

// 每次掃描開頭都會呼叫，用來清掉當天舊訊號再重寫（讓重複掃描不會產生重複資料）。
// 這是全系統呼叫最頻繁、又最容易碰到大量刪除的地方：使用者實測單日訊號 240 筆，
// 舊版逐列刪除等於每掃一次就要 240 次試算表往返，是「執行時間已達上限」的主因。
function clearSignalsForDate(sheet, dateStr) {
  return rewriteSheetKeepingRows(sheet, 12, function (row) {
    return toComparableKey(row[0]) !== dateStr;
  });
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
    // 假日/國定假日 STOCK_DAY_ALL 仍會回傳最近一個交易日的資料，此判斷天生就會跳過非交易日。
    // 這裡刻意用「比lastDate新」而不是單純「不一樣」：STOCK_DAY_ALL偶爾會落後不只一天
    // （實測過連晚上10點多都還沒更新），如果MIS備援已經把lastDate推進到今天，STOCK_DAY_ALL
    // 這次回報的可能還是更早之前的日期——若只判斷「不一樣」會誤把這個舊日期當成新資料，
    // 反而把scanDate拉回去給舊日期，讓已經拿到的今天資料整次掃描都被晾在一邊沒用到。
    const isNewOfficialDate = daily.tradeDate && daily.tradeDate > lastDate && Object.keys(daily.tse).length > 0;
    // STOCK_DAY_ALL 有時很晚才更新：如果昨天已經是用MIS備援寫入的資料，而今天官方資料剛好
    // 追上同一天，這裡仍要把那天的資料升級成正式口徑（即使日期字串跟lastDate相同也要跑）
    const isUpgradeOpportunity = daily.tradeDate && daily.tradeDate === lastDate &&
      Object.keys(daily.tse).length > 0 && isDateMisSourced(historySheet, lastDate);

    let appended = 0;
    let usedMisFallback = false;
    let effectiveDaily = daily;
    if (isNewOfficialDate || isUpgradeOpportunity) {
      appended = appendDailyHistory(historySheet, daily.tradeDate, allCodes, daily, { upgradeFromMis: true });
      pruneOldHistory(historySheet, 210);
    } else {
      // 官方全市場資料還沒更新：如果已經過了收盤一段時間、且今天還沒有任何資料，
      // 改用即時報價(MIS)幫股池＋持股這一小批代號搶先取得今天的資料（詳見 fetchDailyFromMisForPool 註解）
      const todayIso = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd');
      const hourNow = parseInt(Utilities.formatDate(new Date(), 'Asia/Taipei', 'HH'), 10);
      if (todayIso > lastDate && hourNow >= 14) {
        const misDaily = fetchDailyFromMisForPool(allCodes);
        const misHasData = (Object.keys(misDaily.tse).length + Object.keys(misDaily.otc).length) > 0;
        if (misDaily.tradeDate === todayIso && misHasData) {
          appended = appendDailyHistory(historySheet, todayIso, allCodes, misDaily);
          pruneOldHistory(historySheet, 210);
          usedMisFallback = true;
          effectiveDaily = misDaily;
        }
      }
    }
    const scanDate = (isNewOfficialDate || isUpgradeOpportunity) ? daily.tradeDate
      : (usedMisFallback ? effectiveDaily.tradeDate : lastDate);
    if (!scanDate) return { error: '目前 Price_History 尚無任何資料，且今日抓取也失敗，請稍後再試或先執行「② 回補歷史股價」' };

    const cfg = getStrategyConfig();
    const signalSheet = getOrCreateSheetWithHeader('Signal_Log', ['date', 'code', 'name', 'theme', 'school', 'signal', 'close', 'changePct', 'volRatio', 'bonus', 'plan_json', 'scannedAt']);
    clearSignalsForDate(signalSheet, scanDate);

    const histByCode = loadHistoryByCode(historySheet, allCodes);

    let trustBuyMap = {};
    try { trustBuyMap = fetchTrustBuy(scanDate); } catch (e) { /* 投信買賣超是加分資訊，抓不到不影響主判斷 */ }

    const cResult = runSchoolCScan(poolRows, histByCode, cfg, trustBuyMap, scanDate);
    // A流派(胃納量)需要「全市場成交值排名」、R流派(全市場強勢股雷達)本來就是掃全市場找新標的，
    // 兩者都需要 STOCK_DAY_ALL 的全市場資料，MIS 備援只有股池這一小批代號，沒辦法算出正確的
    // 全市場排名，所以用 MIS 備援的這次掃描直接跳過這兩個流派，等下次抓到官方資料再補上
    const aResult = usedMisFallback ? { rows: [] } : runSchoolAScan(poolRows, daily, histByCode, scanDate);
    const dResult = runSchoolDScan(poolRows, scanDate);
    const eResult = runSchoolEScan(cfg, histByCode, scanDate);

    const poolCodeSetForRadar = {};
    allCodes.forEach(function (c) { poolCodeSetForRadar[c] = true; });
    const rResult = usedMisFallback ? { rows: [] } : runMarketRadar(daily, poolCodeSetForRadar, scanDate);

    const allSignalRows = cResult.rows.concat(aResult.rows, dResult.rows, eResult.rows, rResult.rows);
    if (allSignalRows.length > 0) {
      signalSheet.getRange(signalSheet.getLastRow() + 1, 1, allSignalRows.length, 12).setValues(allSignalRows);
    }

    // 訊號成績單：把已滿10個交易日的舊訊號結算報酬（histByCode 已載入，順路計算零成本）
    let outcomesEvaluated = 0;
    try { outcomesEvaluated = evaluateSignalOutcomes(signalSheet, histByCode); } catch (e) { /* 成績單失敗不影響掃描主流程 */ }

    // 清理14天前的舊訊號，避免Signal_Log無限累積——一定要放在evaluateSignalOutcomes之後，
    // 讓這次剛評分完的C流派訊號能被下面的「已評分」判斷正確認出、可以安心刪除
    let signalsPruned = 0;
    try {
      const scoreSheetForPrune = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Signal_Score');
      signalsPruned = pruneOldSignalLog(signalSheet, scoreSheetForPrune);
    } catch (e) { /* 清理失敗不影響掃描主流程 */ }

    const stoplossPayload = getStopLossPayload();
    const breaches = stoplossPayload.items.filter(function (i) { return i.breached && i.applies; });
    let emailSent = false;
    if (breaches.length > 0) {
      sendStopLossEmail(breaches);
      emailSent = true;
    }

    // 每日摘要 Email（三方會議決議）：無論有沒有訊號都寄，讓使用者不開 App 也知道今天的結論。
    // 注意這裡重新讀 getSignalsPayload 而非直接用掃描中間產物，確保信件內容與前端看到的完全一致（含排序）。
    let summaryEmailSent = false;
    let summaryEmailError = '';
    if (cfg.dailySummaryEmail !== false) {
      try {
        const summary = composeDailySummary(getSignalsPayload(), stoplossPayload);
        MailApp.sendEmail(Session.getEffectiveUser().getEmail(), summary.subject, summary.body);
        summaryEmailSent = true;
      } catch (e) {
        // 2026-07-30：原本這裡是完全靜默的 catch，使用者只看到 summaryEmailSent:false
        // 卻無從得知原因（實測就遇到這個情況）。改成把錯誤訊息帶回掃描結果，
        // 讓下次出問題時一眼就能看到是配額用完、還是資料組裝出錯。
        summaryEmailError = String((e && e.message) || e).slice(0, 200);
      }
    } else {
      summaryEmailError = '設定 dailySummaryEmail=false，已略過';
    }

    const result = {
      tradeDate: scanDate, poolCount: allCodes.length, historyAppended: appended,
      signalsFound: allSignalRows.length, radarHits: rResult.rows.length,
      outcomesEvaluated: outcomesEvaluated, stopBreaches: breaches.length,
      emailSent: emailSent, summaryEmailSent: summaryEmailSent,
      usedMisFallback: usedMisFallback, signalsPruned: signalsPruned
    };
    if (!summaryEmailSent && summaryEmailError) result.summaryEmailError = summaryEmailError;
    return result;
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

    // 安全閥：股價來源分三種情況——①這次即時查到(liveQuoteFound=true) ②查不到,退回上次同步的舊價格(quoteStale=true)
    // ③連舊價格都沒有(priceUnavailable=true)。0、負數、NaN 一律視同「查不到」，絕不能被拿去判斷停損。
    const storedPrice = parseNumLoose(h.price);
    let price = (storedPrice !== null && storedPrice > 0) ? storedPrice : null;
    let liveQuoteFound = false;
    const heldName = String(h.name || '').trim();
    for (const cand of quoteCodeCandidatesGs(code)) {
      const q = quotes[cand];
      if (!q || !(q.price > 0)) continue;
      // 股名核對：查回來的名稱與持股名稱完全對不上就跳過（去零撞號防呆）
      const quotedName = String(q.name || '').trim();
      if (heldName && quotedName && heldName !== quotedName &&
          heldName.indexOf(quotedName) === -1 && quotedName.indexOf(heldName) === -1) continue;
      price = q.price;
      liveQuoteFound = true;
      break;
    }
    const priceUnavailable = (price === null || !(price > 0));
    const quoteStale = !priceUnavailable && !liveQuoteFound;

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

    const distancePct = (!priceUnavailable && stopPrice) ? (price - stopPrice) / stopPrice : null;
    // 安全閥核心：priceUnavailable 時絕不宣告跌破，寧可顯示「無法判斷」也不要誤發警報
    const breached = (!priceUnavailable && stopPrice !== null && price < stopPrice);

    // B流派過熱警示：乖離MA20超過+20%（Ken Chen 空跟漲股的反轉風險位置）、爆量長黑
    const warnings = [];
    if (!priceUnavailable && ma20 && (price - ma20) / ma20 > 0.20) warnings.push('乖離MA20超過+20%，留意跟漲反轉風險');
    const lastBar = hist.length ? hist[hist.length - 1] : null;
    const prevBar = hist.length > 1 ? hist[hist.length - 2] : null;
    if (lastBar && prevBar && lastBar.volume && lastBar.open && lastBar.close && prevBar.close) {
      const vols = hist.map(function (x) { return x.volume; }).filter(function (v) { return v !== null; });
      const avg20 = computeAvgVolume(vols, 20, true);
      if (avg20 && lastBar.volume >= 2 * avg20 && lastBar.close < lastBar.open &&
          (lastBar.open - lastBar.close) / prevBar.close >= 0.05) warnings.push('爆量長黑警示');
    }
    // 除權息旺季提醒（台股集中在6~8月除權息）：跌破時提醒使用者先排除「除息假跌破」再行動，
    // 不做自動偵測（需要額外且未驗證過的API,不如請使用者自己去Yahoo股市核對來得可靠）
    const month = new Date().getMonth() + 1;
    if (breached && month >= 6 && month <= 8) {
      warnings.push('現為除權息旺季(6-8月)，跌破可能是除息造成的價格調整而非真實下跌，建議先到Yahoo股市或看盤軟體確認個股近期是否除權息，再決定是否執行停損');
    }

    return {
      code: code, name: h.name || '', category: category, cost: cost,
      // 帳戶歸屬：同一檔股票可能同時存在於兩個帳戶（各自成本不同、停損價也不同），
      // 帶上帳戶前端才分得出這兩列是哪一個券商的部位
      account: h.account || '',
      price: priceUnavailable ? null : round2(price),
      priceUnavailable: priceUnavailable, quoteStale: quoteStale,
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
    const acc = b.account === 'esun' ? '[玉山] ' : (b.account === 'yuanta' ? '[元大] ' : '');
    let line = '- ' + acc + b.name + '（' + b.code + '）現價 ' + b.price + '，停損價 ' + b.stopPrice + '（' + b.stopType + '），建議：' + action;
    if (b.warnings && b.warnings.length) line += '\n  ⚠️ ' + b.warnings.join('；');
    return line;
  });
  const body = '戰情室策略引擎偵測到以下持股跌破停損價（此通知只針對確實查到有效現價的持股，資料異常或查詢失敗的持股不會誤發警報）：\n\n' + lines.join('\n') +
    '\n\n此為系統依「成本-8% 或 跌破20日均線，先到先觸發」規則自動判定，訊號僅供參考，非投資建議，請自行確認後再操作。';
  try {
    MailApp.sendEmail(Session.getEffectiveUser().getEmail(),
      '⚠️ 戰情室停損警報 ' + Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd'), body);
  } catch (e) { /* 寄信失敗不應影響掃描主流程 */ }
}

// ---------- 每日摘要 Email（2026-07-15 三方會議決議）----------
// 目的：使用者不開 App、光看 Gmail 就知道「今天要做什麼、看什麼」。
// composeDailySummary 是純函式（吃 payload 回 {subject, body, conclusion}），方便單元測試；
// 寄送邏輯放在 dailyStrategyScan 尾端，cfg.dailySummaryEmail=false 可關閉。

function composeDailySummary(signals, stoploss) {
  const date = (signals && signals.date) || Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd');
  const items = (stoploss && stoploss.items) || [];
  const breaches = items.filter(function (i) { return i.breached && i.applies; });
  const unavailable = items.filter(function (i) { return i.priceUnavailable; });
  const cSignals = (signals && signals.schoolC) || [];
  const radar = (signals && signals.schoolR) || [];
  const dCount = ((signals && signals.schoolD) || []).length;
  const eLeadCount = ((signals && signals.schoolE) || []).filter(function (x) { return String(x.signal || '').indexOf('前導') !== -1; }).length;
  const topTheme = (signals && signals.themes && signals.themes.length) ? signals.themes[0] : null;

  // 結論的優先序反映紀律：先處理停損（保命）→ 再看進場候選（賺錢）→ 都沒有就是空手日
  let conclusion;
  if (breaches.length > 0) conclusion = '🔴 優先處理：' + breaches.length + ' 檔持股跌破停損';
  else if (cSignals.length > 0) conclusion = '🎯 今日 ' + cSignals.length + ' 個進場候選訊號';
  else conclusion = '今日無進場訊號、持股安全——空手等待就是紀律';

  const lines = [];
  lines.push('【今日結論】' + conclusion);
  lines.push('');
  if (breaches.length > 0) {
    lines.push('■ 停損警報（' + breaches.length + ' 檔，請優先確認）：');
    breaches.forEach(function (b) {
      lines.push('- ' + b.name + '（' + b.code + '）現價 ' + b.price + ' < 停損價 ' + b.stopPrice + '（' + b.stopType + '）' +
        (b.warnings && b.warnings.length ? '　⚠️' + b.warnings.join('；') : ''));
    });
  } else {
    lines.push('■ 持股停損：全數安全' + (unavailable.length > 0 ? '（另有 ' + unavailable.length + ' 檔查價失敗無法判斷，請稍後開戰情室確認）' : ''));
  }
  lines.push('');
  if (cSignals.length > 0) {
    lines.push('■ 今日訊號榜（' + cSignals.length + ' 檔，依⭐投信背書與量能排序）：');
    cSignals.forEach(function (s) {
      lines.push('- ' + (s.bonus ? '⭐' : '') + s.name + '（' + s.code + '）' + s.signal + '，收盤 ' + s.close + (s.theme ? '，題材：' + s.theme : ''));
    });
  } else {
    lines.push('■ 今日訊號榜：無訊號（沒有股票符合條件，這不是故障——空手也是紀律）');
  }
  if (radar.length > 0) {
    lines.push('');
    lines.push('■ 全市場雷達（股池外強勢股，僅單日初篩非進場訊號）：');
    radar.slice(0, 3).forEach(function (r) {
      lines.push('- ' + r.name + '（' + r.code + '）' + ((r.plan && r.plan.note) ? r.plan.note : ''));
    });
  }
  const watchParts = [];
  if (dCount > 0) watchParts.push('結構財候選 ' + dCount + ' 檔');
  if (eLeadCount > 0) watchParts.push('題材前導 ' + eLeadCount + ' 檔');
  if (topTheme) watchParts.push('最強題材：' + topTheme.theme + '（平均 ' + (topTheme.avgChange >= 0 ? '+' : '') + (topTheme.avgChange * 100).toFixed(1) + '%）');
  if (watchParts.length > 0) {
    lines.push('');
    lines.push('■ 觀察面：' + watchParts.join('；'));
  }
  lines.push('');
  lines.push('詳細操作規劃卡請開戰情室「🎯 策略選股」分頁。以上為系統自動判定的候選與紀律提醒，非投資建議。');

  return {
    subject: '📊 戰情室每日掃描 ' + date + '｜' + conclusion,
    body: lines.join('\n'),
    conclusion: conclusion
  };
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
  if (rows.length === 0) {
    return {
      date: lastTradeDate, scannedAt: '',
      schoolA: [], schoolC: [], schoolD: [], schoolE: [], schoolR: [],
      schoolAAsOf: '', schoolCAsOf: '', schoolDAsOf: '', schoolEAsOf: '', schoolRAsOf: '',
      themes: themes, scorecard: getScorecardSummary()
    };
  }

  const latestDate = rows.reduce(function (max, r) {
    const d = toComparableKey(r.date);
    return d > max ? d : max;
  }, '');

  function toItem(r) {
    let plan = {};
    try { plan = JSON.parse(r.plan_json || '{}'); } catch (e) {}
    return {
      code: String(r.code), name: r.name, theme: r.theme, signal: r.signal,
      close: r.close, changePct: r.changePct, volRatio: r.volRatio,
      bonus: (r.bonus === true || r.bonus === 'TRUE'), plan: plan
    };
  }

  // 2026-07-22：改成「每個流派各自的最新日期」而不是全部流派共用同一個日期。
  // 原因：股池改用MIS即時報價備援後（見 dailyStrategyScan），A流派與R流派需要全市場資料，
  // 遇到證交所官方資料延遲時那次會跳過，只有C/D/E當天更新——如果全部流派都卡在同一個
  // 「全體最新日期」去篩選，A/R那天會整個變成空白，使用者搞不清楚是「今天沒訊號」還是
  // 「今天還沒更新」。改成每個流派抓自己最後一次真的有寫入資料的日期，前端才能個別顯示
  // 「更新：07-21」讓使用者一眼看出這流派其實還停在昨天，不是今天篩選後剛好没有標的。
  function latestDateForSchool(school) {
    return rows.reduce(function (max, r) {
      if (r.school !== school) return max;
      const d = toComparableKey(r.date);
      return d > max ? d : max;
    }, '');
  }
  function itemsForSchool(school, asOfDate) {
    return rows.filter(function (r) { return r.school === school && toComparableKey(r.date) === asOfDate; }).map(toItem);
  }

  const schoolAAsOf = latestDateForSchool('A');
  const schoolCAsOf = latestDateForSchool('C');
  const schoolDAsOf = latestDateForSchool('D');
  const schoolEAsOf = latestDateForSchool('E');
  const schoolRAsOf = latestDateForSchool('R');

  const schoolA = itemsForSchool('A', schoolAAsOf);
  const schoolC = itemsForSchool('C', schoolCAsOf);
  // 訊號榜排序（2026-07-15 三方會議決議）：投信背書⭐優先、再依量能倍數降冪——
  // 使用者掃一眼就知道「今天先看哪一檔」，不用自己比較
  schoolC.sort(function (a, b) {
    if (!!a.bonus !== !!b.bonus) return a.bonus ? -1 : 1;
    return (parseFloat(b.volRatio) || 0) - (parseFloat(a.volRatio) || 0);
  });
  const schoolD = itemsForSchool('D', schoolDAsOf);
  const schoolE = itemsForSchool('E', schoolEAsOf);
  const schoolR = itemsForSchool('R', schoolRAsOf);

  const todays = rows.filter(function (r) { return toComparableKey(r.date) === latestDate; });
  const scannedAt = todays.length ? todays[0].scannedAt : '';
  return {
    date: latestDate, scannedAt: scannedAt,
    schoolA: schoolA, schoolC: schoolC, schoolD: schoolD, schoolE: schoolE, schoolR: schoolR,
    schoolAAsOf: schoolAAsOf, schoolCAsOf: schoolCAsOf, schoolDAsOf: schoolDAsOf, schoolEAsOf: schoolEAsOf, schoolRAsOf: schoolRAsOf,
    themes: themes, scorecard: getScorecardSummary()
  };
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
  // 排在 16:00（而非收盤後立刻的14:30），避開三大法人買賣超(T86)等較晚才公布的官方資料上傳延遲，
  // 讓⭐投信加分等判斷用到的是當天完整資料，而不是還沒更新的前一日資料
  ScriptApp.newTrigger('dailyStrategyScan').timeBased().everyDays(1).atHour(16).create();
  SpreadsheetApp.getUi().alert('已安裝每日自動掃描（約 16:00 執行，避開法人買賣超等資料較晚公布的延遲）。請到「專案設定」確認時區為 Asia/Taipei，觸發時間才會準確。');
}
