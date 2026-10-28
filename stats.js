/* ============================================================
 * 财富密码 · 访问统计埋点
 * 依赖：Supabase（免费）+ ipify（取真实 IP）
 * 用法：在页面 </body> 前引入
 *   <script src="stats.js"></script>
 * 首次使用：把下面两个值替换成你的 Supabase 项目值
 * ============================================================ */
(function () {
  "use strict";

  /* ====== ① 只需改这两行 ====== */
  var SUPABASE_URL = "https://YOUR-PROJECT.supabase.co";
  var SUPABASE_ANON_KEY = "YOUR-ANON-KEY";
  var TABLE = "visits";

  /* ====== 内部配置 ====== */
  var SITE = "zodiac-lottery";
  var PAGE = location.pathname;
  var VISITOR_KEY = "vp_vid";     // localStorage 访客标识
  var SESSION_KEY = "vp_sid";     // sessionStorage 会话标识
  var HEARTBEAT_MS = 15000;       // 心跳间隔
  var FLUSH_MS = 15000;           // 时长回写间隔

  if (SUPABASE_URL.indexOf("YOUR-PROJECT") >= 0) {
    console.warn("[stats] 尚未配置 Supabase，统计未启用");
    return;
  }

  /* ====== 工具 ====== */
  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    var b = new Uint8Array(16);
    (window.crypto || {}).getRandomValues
      ? crypto.getRandomValues(b)
      : b.forEach(function (_, i) { b[i] = Math.floor(Math.random() * 256); });
    return Array.prototype.map.call(b, function (x) { return ("0" + x.toString(16)).slice(-2); }).join("");
  }

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function ssGet(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } }
  function ssSet(k, v) { try { sessionStorage.setItem(k, v); } catch (e) {} }

  /* ====== 访客 / 会话标识 ====== */
  var visitorId = lsGet(VISITOR_KEY);
  var isNewVisitor = !visitorId;
  if (!visitorId) { visitorId = uuid(); lsSet(VISITOR_KEY, visitorId); }

  var sessionId = ssGet(SESSION_KEY);
  var isNewSession = !sessionId;
  if (!sessionId) { sessionId = uuid(); ssSet(SESSION_KEY, sessionId); }

  /* ====== 设备信息 ====== */
  function deviceInfo() {
    var ua = navigator.userAgent;
    var mobile = /Android|iPhone|iPad|iPod|Mobile|HarmonyOS/i.test(ua);
    var os = "其他";
    if (/iPhone|iPad|iPod/i.test(ua)) os = "iOS";
    else if (/Android/i.test(ua)) os = "Android";
    else if (/HarmonyOS/i.test(ua)) os = "HarmonyOS";
    else if (/Windows/i.test(ua)) os = "Windows";
    else if (/Mac OS X/i.test(ua)) os = "macOS";
    else if (/Linux/i.test(ua)) os = "Linux";

    var browser = "其他";
    if (/MicroMessenger/i.test(ua)) browser = "微信";
    else if (/Edg\//i.test(ua)) browser = "Edge";
    else if (/Chrome\//i.test(ua)) browser = "Chrome";
    else if (/Safari\//i.test(ua)) browser = "Safari";
    else if (/Firefox\//i.test(ua)) browser = "Firefox";

    return {
      device: mobile ? "手机" : "电脑",
      os: os,
      browser: browser,
      screen: screen.width + "x" + screen.height,
      ua: ua.slice(0, 240)
    };
  }

  /* ====== 取真实公网 IP ====== */
  function fetchIP() {
    var cached = lsGet("vp_ip");
    var ts = parseInt(lsGet("vp_ip_ts") || "0", 10);
    // 缓存 30 分钟，避免每次都请求
    if (cached && Date.now() - ts < 30 * 60 * 1000) return Promise.resolve(cached);

    var apis = [
      { url: "https://api.ipify.org?format=json", pick: function (d) { return d.ip; } },
      { url: "https://ipapi.co/json/", pick: function (d) { return d.ip; } },
      { url: "https://api.ip.sb/jsonip", pick: function (d) { return d.ip; } }
    ];

    return apis.reduce(function (p, api) {
      return p.then(function (got) {
        if (got) return got;
        return fetch(api.url, { cache: "no-store" })
          .then(function (r) { return r.json(); })
          .then(function (d) {
            var ip = api.pick(d);
            if (ip) { lsSet("vp_ip", ip); lsSet("vp_ip_ts", String(Date.now())); }
            return ip || null;
          })
          .catch(function () { return null; });
      });
    }, Promise.resolve(null)).then(function (ip) { return ip || "unknown"; });
  }

  /* ====== 上报 ====== */
  function post(path, body, method) {
    return fetch(SUPABASE_URL + "/rest/v1/" + path, {
      method: method || "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": SUPABASE_ANON_KEY,
        "Authorization": "Bearer " + SUPABASE_ANON_KEY,
        "Prefer": "return=minimal"
      },
      body: JSON.stringify(body),
      keepalive: true
    }).catch(function () { /* 静默失败，不影响用户 */ });
  }

  /* ====== 状态 ====== */
  var recordId = null;      // 本次访问记录 id
  var startAt = Date.now();
  var lastActive = Date.now();
  var maxScroll = 0;
  var clickedDraw = false;
  var sent = false;

  function seconds() { return Math.round((Date.now() - startAt) / 1000); }

  /* ====== 首次上报（进入） ====== */
  function trackEnter() {
    var d = deviceInfo();
    var ref = document.referrer || "";

    fetchIP().then(function (ip) {
      var payload = {
        site: SITE,
        page: PAGE,
        ip: ip,
        visitor_id: visitorId,
        session_id: sessionId,
        is_new_visitor: isNewVisitor,
        is_new_session: isNewSession,
        referrer: ref.slice(0, 300),
        device: d.device,
        os: d.os,
        browser: d.browser,
        screen: d.screen,
        ua: d.ua,
        duration: 0,
        max_scroll: 0,
        did_draw: false,
        entered_at: new Date().toISOString()
      };

      return fetch(SUPABASE_URL + "/rest/v1/" + TABLE + "?select=id", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": SUPABASE_ANON_KEY,
          "Authorization": "Bearer " + SUPABASE_ANON_KEY,
          "Prefer": "return=representation"
        },
        body: JSON.stringify(payload)
      })
        .then(function (r) { return r.json(); })
        .then(function (rows) {
          if (rows && rows[0] && rows[0].id) recordId = rows[0].id;
        })
        .catch(function () {});
    });
  }

  /* ====== 时长 / 行为回写 ====== */
  function flush(leave) {
    if (!recordId) return;
    var body = {
      duration: seconds(),
      max_scroll: maxScroll,
      did_draw: clickedDraw
    };
    if (leave) body.left_at = new Date().toISOString();
    post(TABLE + "?id=eq." + recordId, body, "PATCH");
  }

  /* ====== 行为监听 ====== */
  function bindBehavior() {
    // 停留时长活跃度
    ["touchstart", "click", "scroll", "keydown", "devicemotion"].forEach(function (ev) {
      window.addEventListener(ev, function () { lastActive = Date.now(); }, { passive: true });
    });

    // 滚动深度
    window.addEventListener("scroll", function () {
      var h = document.documentElement;
      var p = h.scrollTop / Math.max(1, h.scrollHeight - h.clientHeight);
      maxScroll = Math.max(maxScroll, Math.round(p * 100));
    }, { passive: true });

    // 是否抽过签（监听结果区出现）
    var mo = new MutationObserver(function () {
      var r = document.getElementById("reading");
      if (r && r.classList.contains("show")) clickedDraw = true;
    });
    var reading = document.getElementById("reading");
    if (reading) mo.observe(reading, { attributes: true, attributeFilter: ["class"] });
  }

  /* ====== 心跳 & 离开 ====== */
  function bindLifecycle() {
    setInterval(function () {
      if (document.visibilityState === "visible") flush(false);
    }, FLUSH_MS);

    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden") { flush(true); sent = true; }
      else { lastActive = Date.now(); if (sent) { sent = false; flush(false); } }
    });

    window.addEventListener("pagehide", function () { flush(true); });
    window.addEventListener("beforeunload", function () { flush(true); });
  }

  /* ====== 启动 ====== */
  function init() {
    trackEnter();
    bindBehavior();
    bindLifecycle();
  }

  if (document.readyState === "complete" || document.readyState === "interactive") {
    setTimeout(init, 0);
  } else {
    document.addEventListener("DOMContentLoaded", init);
  }

  /* 暴露给页面：抽签时调用 window.Stats.draw() */
  window.Stats = { draw: function () { clickedDraw = true; } };
})();
