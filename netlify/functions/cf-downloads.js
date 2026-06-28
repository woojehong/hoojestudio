// ============================================================
// cf-downloads.js — 커스포지(CurseForge) 애드온 다운로드 수 조회
// CurseForge API v1: GET /v1/mods/{modId} → data.downloadCount
// API 키는 코드에 넣지 않고 Netlify 환경변수 CURSEFORGE_API_KEY 사용.
// 결과를 Firebase stats/cf_downloads 에 캐시(클라이언트는 Firebase 구독).
// ============================================================

const MOD_ID = 1569557; // HoojeStudio 프로젝트 ID
const FIREBASE_URL =
  'https://rougetsblendingroom-default-rtdb.firebaseio.com/stats/cf_downloads.json';

exports.handler = async () => {
  const headers = {
    'Content-Type': 'application/json',
    'Cache-Control': 'public, max-age=300', // 5분
    'Access-Control-Allow-Origin': '*',
  };

  try {
    const apiKey = process.env.CURSEFORGE_API_KEY;
    if (!apiKey) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'missing_api_key' }) };
    }

    const res = await fetch(`https://api.curseforge.com/v1/mods/${MOD_ID}`, {
      headers: { 'x-api-key': apiKey, Accept: 'application/json' },
    });

    if (!res.ok) {
      return { statusCode: 502, headers, body: JSON.stringify({ error: 'curseforge_' + res.status }) };
    }

    const json = await res.json();
    const count = json && json.data && typeof json.data.downloadCount === 'number'
      ? json.data.downloadCount
      : null;

    // Firebase 캐시에 기록(실패해도 무시) — 클라이언트는 stats/cf_downloads 구독
    if (count != null) {
      try {
        await fetch(FIREBASE_URL, { method: 'PUT', body: JSON.stringify(count) });
      } catch (e) { /* noop */ }
    }

    return { statusCode: 200, headers, body: JSON.stringify({ count }) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: String(err) }) };
  }
};
