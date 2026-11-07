require("dotenv").config();
const express = require("express");
const path = require("path");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const PORT = Number(process.env.PORT || 3000);
const KEY = (process.env.TAGO_SERVICE_KEY || "").trim();
const CACHE_TTL = Math.max(0, Number(process.env.CACHE_TTL_SECONDS || 30)) * 1000;
const API_TIMEOUT = Math.max(1000, Number(process.env.API_TIMEOUT_MS || 12000));
const BASE = "https://apis.data.go.kr/1613000";
const cache = new Map();

function cached(key, fn) {
  const now = Date.now();
  const old = cache.get(key);
  if (old && old.expires > now) return Promise.resolve(old.value);
  return fn().then(value => {
    if (CACHE_TTL) cache.set(key, { value, expires: Date.now() + CACHE_TTL });
    return value;
  });
}
function unwrap(data) {
  if (!data) return [];
  const body = data.response?.body || data.body || data;
  const items = body.items?.item ?? body.items ?? body.item ?? [];
  if (Array.isArray(items)) return items;
  return items && typeof items === "object" ? [items] : [];
}
function totalCount(data) {
  const body = data?.response?.body || data?.body || {};
  return Number(body.totalCount || 0);
}
async function tago(service, operation, params = {}) {
  if (!KEY) {
    const err = new Error("서버에 공공데이터포털 인증키가 설정되지 않았습니다. 배포 환경변수 TAGO_SERVICE_KEY를 확인하세요.");
    err.status = 503;
    throw err;
  }
  const url = new URL(`${BASE}/${service}/${operation}`);
  for (const [k, v] of Object.entries({ ...params, serviceKey: KEY, _type: "json", numOfRows: 100, pageNo: 1 })) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { accept: "application/json" } });
    const raw = await response.text();
    let data;
    try { data = JSON.parse(raw); } catch {
      throw new Error("공공데이터 응답을 JSON으로 읽지 못했습니다. 인증키 또는 API 응답 형식을 확인하세요.");
    }
    const header = data?.response?.header;
    if (!response.ok || (header?.resultCode && !["00", "0"].includes(String(header.resultCode)))) {
      const message = header?.resultMsg || `공공데이터 API 오류 (${response.status})`;
      const err = new Error(message);
      err.status = 502;
      throw err;
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}
function first(obj, names, fallback = "") {
  for (const n of names) if (obj?.[n] !== undefined && obj?.[n] !== null && obj[n] !== "") return obj[n];
  return fallback;
}
function cleanRoute(x, cityCode) {
  return {
    type: "route",
    cityCode,
    routeId: first(x, ["routeid", "routeId", "ROUTE_ID"]),
    routeNo: String(first(x, ["routeno", "routeNo", "ROUTE_NO"], "")),
    startNode: first(x, ["startnodenm", "startNodeNm", "START_NODE_NM"]),
    endNode: first(x, [" endnodenm", "endnodenm", "endNodeNm", "END_NODE_NM"]),
    routeType: first(x, ["routetp", "routeType", "ROUTE_TP"]),
    raw: x
  };
}
function cleanStop(x, cityCode) {
  return {
    type: "station",
    cityCode,
    nodeId: first(x, ["nodeid", "nodeId", "NODE_ID"]),
    nodeName: first(x, ["nodenm", "nodeNm", "NODE_NM"]),
    nodeNo: first(x, ["nodeno", "nodeNo", "NODE_NO"]),
    gpsLati: first(x, ["gpslati", "gpsLati", "GPS_LATI"]),
    gpsLong: first(x, ["gpslong", "gpsLong", "GPS_LONG"]),
    raw: x
  };
}
async function getCities() {
  return cached("cities", async () => {
    const data = await tago("BusRouteInfoInqireService", "getCtyCodeList");
    return unwrap(data).map(x => ({
      cityCode: String(first(x, ["citycode", "cityCode", "CITY_CODE"], "")),
      cityName: String(first(x, ["cityname", "cityName", "CITY_NAME"], ""))
    })).filter(x => x.cityCode);
  });
}
async function searchAcrossCities(kind, query, requestedCityCode) {
  const cities = requestedCityCode ? [{ cityCode: requestedCityCode }] : await getCities();
  const limited = cities.slice(0, 160);
  const results = [];
  let cursor = 0;
  const workers = Array.from({ length: Math.min(5, limited.length) }, async () => {
    while (cursor < limited.length && results.length < 100) {
      const city = limited[cursor++];
      try {
        const data = kind === "route"
          ? await tago("BusRouteInfoInqireService", "getRouteNoList", { cityCode: city.cityCode, routeNo: query })
          : await tago("BusSttnInfoInqireService", "getSttnNoList", { cityCode: city.cityCode, nodeNm: query });
        const items = unwrap(data);
        for (const item of items) {
          results.push(kind === "route" ? cleanRoute(item, city.cityCode) : cleanStop(item, city.cityCode));
          if (results.length >= 100) break;
        }
      } catch (e) {
        // One region may not provide data; keep searching other regions.
      }
    }
  });
  await Promise.all(workers);
  return results;
}

app.get("/api/health", (_req, res) => res.json({
  ok: true,
  mode: process.env.DATA_MODE || "api",
  keyConfigured: Boolean(KEY),
  message: KEY ? "서버 인증키 설정됨" : "TAGO_SERVICE_KEY 환경변수 필요"
}));

app.get("/api/cities", async (_req, res, next) => {
  try { res.json({ items: await getCities() }); } catch (e) { next(e); }
});
app.get("/api/search", async (req, res, next) => {
  try {
    const type = req.query.type === "station" ? "station" : "route";
    const q = String(req.query.q || "").trim();
    const cityCode = String(req.query.cityCode || "").trim();
    if (!q) return res.status(400).json({ error: "검색어를 입력해 주세요." });
    const key = `search:${type}:${cityCode}:${q}`;
    const items = await cached(key, () => searchAcrossCities(type, q, cityCode));
    res.json({ items, count: items.length, type });
  } catch (e) { next(e); }
});
app.get("/api/route/:cityCode/:routeId/stops", async (req, res, next) => {
  try {
    const data = await tago("BusRouteInfoInqireService", "getRouteAcctoThrghSttnList", {
      cityCode: req.params.cityCode, routeId: req.params.routeId
    });
    res.json({ items: unwrap(data) });
  } catch (e) { next(e); }
});
app.get("/api/station/:cityCode/:nodeId/arrivals", async (req, res, next) => {
  try {
    const data = await tago("ArvlInfoInqireService", "getSttnAcctoArvlPrearngeInfoList", {
      cityCode: req.params.cityCode, nodeId: req.params.nodeId
    });
    res.json({ items: unwrap(data) });
  } catch (e) { next(e); }
});
app.get("/api/route/:cityCode/:routeId/locations", async (req, res, next) => {
  try {
    const data = await tago("BusLcInfoInqireService", "getRouteAcctoBusLcList", {
      cityCode: req.params.cityCode, routeId: req.params.routeId
    });
    res.json({ items: unwrap(data) });
  } catch (e) { next(e); }
});
app.get("/api/nearby", async (req, res, next) => {
  try {
    const gpsLati = Number(req.query.lat), gpsLong = Number(req.query.lng);
    if (!Number.isFinite(gpsLati) || !Number.isFinite(gpsLong)) return res.status(400).json({ error: "위치 좌표가 필요합니다." });
    const data = await tago("BusSttnInfoInqireService", "getCrdntPrxmtSttnList", {
      gpsLati, gpsLong, radius: Math.min(2000, Math.max(100, Number(req.query.radius || 500)))
    });
    res.json({ items: unwrap(data).map(x => cleanStop(x, "")) });
  } catch (e) { next(e); }
});

app.get("*", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
app.use((err, _req, res, _next) => {
  console.error(err.message);
  res.status(err.status || 500).json({ error: err.name === "AbortError" ? "공공데이터 응답 시간이 초과됐습니다." : err.message || "서버 오류" });
});

app.listen(PORT, () => console.log(`BusTokTok running on port ${PORT}`));
