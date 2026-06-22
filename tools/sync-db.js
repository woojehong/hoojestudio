#!/usr/bin/env node
/**
 * sync-db.js — Firebase items 데이터로 코드 동기화
 *
 * Firebase RTDB(items)를 단일 소스로 삼아 아래 두 파일의
 * AUTO-GENERATED 마커 블록을 다시 생성합니다.
 *
 *   1. netlify/functions/notify.js  →  ITEM_TO_CRAFTER (아이템명 → 제작자)
 *   2. ../HoojeStudio/HoojeStudio.lua  →  CATEGORIES, MATS_DB
 *
 * 사용법:
 *   node tools/sync-db.js                  # Firebase에서 직접 가져오기 (네트워크 필요)
 *   node tools/sync-db.js backup/firebase-import-260611.json   # 로컬 백업 JSON 사용
 *   node tools/sync-db.js --dry [json]     # 파일을 수정하지 않고 결과 요약만 출력
 *
 * 요구사항: Node.js 18 이상
 */

"use strict";

const fs = require("fs");
const path = require("path");

const RTDB_ITEMS_URL = "https://rougetsblendingroom-default-rtdb.firebaseio.com/items.json";

const NOTIFY_PATH = path.resolve(__dirname, "..", "netlify", "functions", "notify.js");
const LUA_PATH = path.resolve(__dirname, "..", "..", "..", "HoojeStudio", "HoojeStudio.lua");

// 애드온/알림 함수에서 사용하는 카테고리 표시 순서 및 이름
const CAT_ORDER = [
  ["cloth",        "천 방어구"],
  ["leather",      "가죽 방어구"],
  ["chain",        "사슬 방어구"],
  ["plate",        "판금 방어구"],
  ["weapon",       "무기류 (무기 / 방패 / 보조무기)"],
  ["common_armor", "공통 방어구 (망토 / 반지 / 목걸이)"],
  ["profession",   "전문 기술 장비"],
  ["engineering",  "기계공학 방어구"],
  ["pvp_weapon",   "PVP 무기류"],
  ["pvp_common",   "PVP 공통 방어구"],
  ["pvp_cloth",    "PVP 천 방어구"],
  ["pvp_leather",  "PVP 가죽 방어구"],
  ["pvp_chain",    "PVP 사슬 방어구"],
  ["pvp_plate",    "PVP 판금 방어구"],
];

// ── index.html 과 동일한 정렬 로직 ─────────────────────────────
const ARMOR_SLOT_ORDER = { "머리": 1, "어깨": 2, "가슴": 3, "손목": 4, "손": 5, "허리": 6, "다리": 7, "발": 8 };
const COMMON_SLOT_ORDER = { "망토": 1, "목걸이": 2, "반지": 3 };
const ARMOR_TYPE_ORDER = { "판금": 1, "사슬": 2, "가죽": 3, "천": 4 };

function parseBracket(name) {
  const m = String(name).match(/^\[(.+?)\]/);
  if (!m) return { slot: "", isDecoration: false };
  const bracket = m[1];
  const isDecoration = bracket.startsWith("장식");
  const parts = bracket.replace(/^장식\s*/, "").trim().split(/\s+/);
  return { slot: parts[parts.length - 1] || "", isDecoration };
}

function getSlotPriority(item) {
  const { isDecoration } = parseBracket(item.name);
  if (item.popular && isDecoration) return 1;
  if (item.popular) return 2;
  if (isDecoration) return 3;
  return 4;
}

function sortItems(items, catKey) {
  return items.slice().sort((a, b) => {
    if (catKey === "weapon" || catKey === "pvp_weapon" || catKey === "profession") {
      const pa = getSlotPriority(a), pb = getSlotPriority(b);
      if (pa !== pb) return pa - pb;
      return a.name.localeCompare(b.name, "ko");
    }
    if (catKey === "common_armor" || catKey === "pvp_common") {
      const { slot: sa } = parseBracket(a.name);
      const { slot: sb } = parseBracket(b.name);
      const oa = COMMON_SLOT_ORDER[sa] ?? 99;
      const ob = COMMON_SLOT_ORDER[sb] ?? 99;
      if (oa !== ob) return oa - ob;
      return getSlotPriority(a) - getSlotPriority(b);
    }
    if (catKey === "engineering") {
      const getAT = (n) => { const m = n.match(/^\[기계공학\s+(\S+)/); return m ? m[1] : ""; };
      const ta = ARMOR_TYPE_ORDER[getAT(a.name)] ?? 99;
      const tb = ARMOR_TYPE_ORDER[getAT(b.name)] ?? 99;
      if (ta !== tb) return ta - tb;
      const { slot: sa } = parseBracket(a.name);
      const { slot: sb } = parseBracket(b.name);
      return (ARMOR_SLOT_ORDER[sa] ?? 99) - (ARMOR_SLOT_ORDER[sb] ?? 99);
    }
    const { slot: sa } = parseBracket(a.name);
    const { slot: sb } = parseBracket(b.name);
    const oa = ARMOR_SLOT_ORDER[sa] ?? 99;
    const ob = ARMOR_SLOT_ORDER[sb] ?? 99;
    if (oa !== ob) return oa - ob;
    return getSlotPriority(a) - getSlotPriority(b);
  });
}

// ── 유틸 ────────────────────────────────────────────────────────
const luaEscape = (s) => String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
const jsEscape = (s) => String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
const stripBracket = (name) => String(name).replace(/^\[.*?\]\s*/, "");

function replaceBetweenMarkers(source, startMarker, endMarker, replacement, fileLabel) {
  const startIdx = source.indexOf(startMarker);
  const endIdx = source.indexOf(endMarker);
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
    throw new Error(`${fileLabel}: 마커(${startMarker} / ${endMarker})를 찾을 수 없습니다.`);
  }
  const before = source.slice(0, startIdx + startMarker.length);
  const after = source.slice(endIdx);
  return before + "\n" + replacement + "\n" + after;
}

// ── 데이터 로드 ─────────────────────────────────────────────────
async function loadItems(jsonPath) {
  let raw;
  if (jsonPath) {
    raw = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  } else {
    console.log(`Firebase에서 items 가져오는 중: ${RTDB_ITEMS_URL}`);
    const res = await fetch(RTDB_ITEMS_URL);
    if (!res.ok) throw new Error(`Firebase 응답 오류: HTTP ${res.status}`);
    raw = await res.json();
  }
  // 루트 export(items 키 포함) / items 단독 모두 허용
  const items = raw && raw.items ? raw.items : raw;
  if (!items || typeof items !== "object") throw new Error("items 데이터를 찾을 수 없습니다.");
  return items;
}

// ── 생성기 ──────────────────────────────────────────────────────
function buildAll(itemsData) {
  const notifyLines = [];
  const luaCatChunks = [];
  const luaMatChunks = [];
  const shortSeen = new Map(); // 중복 단축명 감지
  let totalItems = 0, totalMats = 0;
  const warnings = [];

  notifyLines.push("const ITEM_TO_CRAFTER = {");

  for (const [catKey, catName] of CAT_ORDER) {
    const catItemsRaw = itemsData[catKey];
    if (!catItemsRaw) continue;
    const items = sortItems(
      Object.values(catItemsRaw).map((it) => ({
        ...it,
        reqMats: it.reqMats ? Object.values(it.reqMats) : [],
      })),
      catKey
    );
    if (!items.length) continue;

    // notify.js 블록
    notifyLines.push(`  // ${catName}`);
    for (const it of items) {
      if (!it.name || !it.crafter) { warnings.push(`이름/제작자 누락: ${JSON.stringify(it.name || it)}`); continue; }
      const short = stripBracket(it.name);
      if (shortSeen.has(short) && shortSeen.get(short) !== it.crafter) {
        warnings.push(`단축명 충돌: "${short}" → ${shortSeen.get(short)} vs ${it.crafter}`);
      }
      shortSeen.set(short, it.crafter);
      notifyLines.push(`  "${jsEscape(short)}": "${jsEscape(it.crafter)}",`);
    }

    // Lua CATEGORIES 블록
    const luaItems = items
      .filter((it) => it.name && it.crafter)
      .map((it) => `            { name = "${luaEscape(it.name)}", crafter = "${luaEscape(it.crafter)}" },`)
      .join("\n");
    luaCatChunks.push(
      `    {\n        name = "${luaEscape(catName)}",\n        items = {\n${luaItems}\n        },\n    },`
    );

    // Lua MATS_DB 블록
    for (const it of items) {
      if (!it.name || !Array.isArray(it.reqMats) || !it.reqMats.length) continue;
      const mats = it.reqMats
        .filter((m) => m && m.n)
        .map((m) => `{n="${luaEscape(m.n)}",c=${parseInt(m.c, 10) || 1}}`)
        .join(",");
      if (!mats) continue;
      luaMatChunks.push(`    ["${luaEscape(it.name)}"] = { ${mats} },`);
      totalMats++;
    }

    totalItems += items.length;
  }

  notifyLines.push("};");

  const notifyBlock = notifyLines.join("\n");
  const luaCatBlock = `local CATEGORIES = {\n${luaCatChunks.join("\n")}\n}`;
  const luaMatBlock = `local MATS_DB = {\n${luaMatChunks.join("\n")}\n}`;

  return { notifyBlock, luaCatBlock, luaMatBlock, totalItems, totalMats, warnings };
}

// ── 메인 ────────────────────────────────────────────────────────
(async () => {
  const args = process.argv.slice(2);
  const dry = args.includes("--dry");
  const jsonPath = args.find((a) => !a.startsWith("--"));

  try {
    const items = await loadItems(jsonPath);
    const { notifyBlock, luaCatBlock, luaMatBlock, totalItems, totalMats, warnings } = buildAll(items);

    console.log(`아이템 ${totalItems}개 / 재료 보유 ${totalMats}개 생성 완료`);
    warnings.forEach((w) => console.warn(`⚠ ${w}`));

    if (dry) {
      console.log("--dry 모드: 파일을 수정하지 않았습니다.");
      return;
    }

    // notify.js 갱신
    let notifySrc = fs.readFileSync(NOTIFY_PATH, "utf8");
    notifySrc = replaceBetweenMarkers(
      notifySrc,
      "// === AUTO-GENERATED:ITEM_TO_CRAFTER:START ===",
      "// === AUTO-GENERATED:ITEM_TO_CRAFTER:END ===",
      "// 이 블록은 tools/sync-db.js 가 Firebase 데이터로 자동 생성합니다. 직접 수정하지 마세요.\n" + notifyBlock,
      "notify.js"
    );
    fs.writeFileSync(NOTIFY_PATH, notifySrc);
    console.log(`갱신: ${NOTIFY_PATH}`);

    // HoojeStudio.lua 갱신
    let luaSrc = fs.readFileSync(LUA_PATH, "utf8");
    luaSrc = replaceBetweenMarkers(
      luaSrc,
      "-- AUTO-GENERATED:CATEGORIES:START (tools/sync-db.js 가 자동 생성 — 직접 수정 금지)",
      "-- AUTO-GENERATED:CATEGORIES:END",
      luaCatBlock,
      "HoojeStudio.lua (CATEGORIES)"
    );
    luaSrc = replaceBetweenMarkers(
      luaSrc,
      "-- AUTO-GENERATED:MATS_DB:START (tools/sync-db.js 가 자동 생성 — 직접 수정 금지)",
      "-- AUTO-GENERATED:MATS_DB:END",
      luaMatBlock,
      "HoojeStudio.lua (MATS_DB)"
    );
    fs.writeFileSync(LUA_PATH, luaSrc);
    console.log(`갱신: ${LUA_PATH}`);
    console.log("완료. 변경분을 확인한 뒤 GitHub에 커밋하세요.");
  } catch (err) {
    console.error(`실패: ${err.message}`);
    process.exit(1);
  }
})();
