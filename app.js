import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
    import { getDatabase, ref, onValue, push, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

    const firebaseConfig = { apiKey: "AIzaSyDXH0-y0vUQ9K29XbtRXDEuIokTqDLmo_I", authDomain: "rougetsblendingroom.firebaseapp.com", databaseURL: "https://rougetsblendingroom-default-rtdb.firebaseio.com/", projectId: "rougetsblendingroom" };
    const app = initializeApp(firebaseConfig);
    const db = getDatabase(app);

    const FIXED_VIDEO_ID = ''; 

    
    // 사용자 입력/외부 데이터 HTML 이스케이프 (XSS 방지)
    const escapeHTML = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    // [신규] 제품별 독립 쿨타임 및 장바구니 저장소
    const itemCooldowns = {};
    let shoppingCart = [];
    let currentDetailItem = null; // 현재 상세 패널에 표시 중인 아이템
    let favorites = JSON.parse(localStorage.getItem('favs')) || [];

    let currentStatusType = '';
    const STATUS_NOTICE_CONFIG = {
      '쐐기 중':  { color: '#3b82f6', bg: 'rgba(59,130,246,0.07)', border: 'rgba(59,130,246,0.3)', icon: '⏱️', msg: '현재 쐐기 진행 중 — 최대 30분 소요될 수 있습니다' },
      '레이드 중': { color: '#a855f7', bg: 'rgba(168,85,247,0.07)', border: 'rgba(168,85,247,0.3)', icon: '⚔️', msg: '현재 레이드 중 — 최대 1시간 소요될 수 있습니다' },
      '자리 비움': { color: '#eab308', bg: 'rgba(234,179,8,0.07)', border: 'rgba(234,179,8,0.3)', icon: '🔔', msg: '잠시 자리를 비웠습니다 — 10분 전후로 돌아옵니다' },
      '외출 중':  { color: '#f97316', bg: 'rgba(249,115,22,0.07)', border: 'rgba(249,115,22,0.3)', icon: '🙏', msg: '외출 중입니다 — 틈틈이 확인하지만 빠른 제작을 장담드리기 어렵습니다' },
      '오프라인': { color: '#6b7280', bg: 'rgba(107,114,128,0.07)', border: 'rgba(107,114,128,0.3)', icon: '💤', msg: '오프라인 상태입니다 — 느긋하게 기다리실 수 있는 분만 의뢰해주세요\n(반나절은 넘기지 않습니다)' },
    };
    function generateStatusNoticeHTML() {
      const cfg = STATUS_NOTICE_CONFIG[currentStatusType];
      if (!cfg) return '';
      return `<div class="status-notice-box w-full mt-2 px-3 py-2.5 rounded-xl flex flex-col items-center justify-center text-xs font-bold text-center" style="background:${cfg.bg}; border:1px solid ${cfg.border}; color:${cfg.color};"><span class="pre-wrap">${cfg.icon} ${cfg.msg}</span></div>`;
    }
    function refreshStatusNotices() {
      document.querySelectorAll('.status-notice-box').forEach(el => {
        const cfg = STATUS_NOTICE_CONFIG[currentStatusType];
        if (!cfg) { el.style.display = 'none'; return; }
        el.style.display = '';
        el.style.background = cfg.bg;
        el.style.border = `1px solid ${cfg.border}`;
        el.style.color = cfg.color;
        el.innerHTML = `<span class="shrink-0">${cfg.icon}</span><span>${cfg.msg}</span>`;
      });
    }

    const STATUS_RGB = {
      '온라인':'34,197,94','쐐기 중':'59,130,246','레이드 중':'168,85,247','자리 비움':'234,179,8','외출 중':'249,115,22','오프라인':'107,114,128'
    };
    function statusRGB(){ return STATUS_RGB[currentStatusType] || '135,136,238'; }
    function refreshOrderButtonColors(){
      const rgb = statusRGB();
      document.querySelectorAll('.order-action-btn.order-pulse').forEach(btn=>{
        btn.style.setProperty('--sc-rgb', rgb);
        btn.style.background = `linear-gradient(to right, rgba(${rgb},0.2), rgba(${rgb},0.1))`;
        btn.style.borderColor = `rgba(${rgb},0.6)`;
      });
    }

    const STATUS_COLOR_MAP = {
      'bg-green-500':  '#22c55e',
      'bg-yellow-500': '#eab308',
      'bg-orange-600': '#ea580c',
      'bg-gray-600':   '#4b5563',
      'bg-teal-500':   '#14b8a6',
      'bg-lime-500':   '#84cc16',
    };

    onValue(ref(db, 'status'), (snap) => {
      const data = snap.val();
      if(data) {
        currentStatusType = data.type;
        document.getElementById('status-text').innerText = `${data.type} : ${data.message}`;
        const rgb = statusRGB();
        const dot = document.getElementById('status-dot');
        dot.className = `w-3 h-3 md:w-3.5 md:h-3.5 rounded-full animate-pulse shrink-0`;
        dot.style.background = `rgb(${rgb})`;
        const liveStatus = document.getElementById('live-status');
        liveStatus.style.borderColor = `rgb(${rgb})`;
        liveStatus.style.boxShadow = `0 0 12px rgba(${rgb},0.28)`;
        refreshStatusNotices();
        refreshOrderButtonColors();
      }
    });

    onValue(ref(db, 'notice'), (snap) => {
      const text = snap.val();
      const tickerContainer = document.getElementById('ticker-container');
      const tickerText = document.getElementById('ticker-text');
      if (text && text.trim() !== "") {
        tickerText.innerText = " " + text + " ";
        tickerContainer.classList.remove('hidden');
      } else {
        tickerContainer.classList.add('hidden');
      }
    });
// [신규] 실시간 주문 현황 수신 및 피드 그리기
    onValue(ref(db, 'orders'), (snap) => {
      const ordersData = snap.val();
      const feedBox = document.getElementById('live-order-feed');
      const container = document.getElementById('live-order-container');

      if (!ordersData) {
        feedBox.classList.add('hidden');
        container.innerHTML = '';
        return;
      }

      feedBox.classList.remove('hidden');

      const ordersArray = Object.keys(ordersData).map(key => ({ id: key, ...ordersData[key] }));
      ordersArray.sort((a, b) => b.timestamp - a.timestamp);
      const top10 = ordersArray.slice(0, 10);

      container.innerHTML = top10.map(order => {
        const timeObj = order.timestamp ? new Date(order.timestamp) : new Date();
        const timeStr = timeObj.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });

        let statusHtml = '';
        let borderClass = 'border-gray-700 border-2';
        let bubbleHtml = '';

        if (order.status === 'done') {
          statusHtml = '<span class="px-1.5 py-0.5 rounded text-[10px] md:text-[11px] font-black border text-emerald-400 border-emerald-500/30 bg-emerald-500/10 flex items-center gap-1">✅ 완료</span>';
          borderClass = 'border-emerald-500/30 opacity-70';
        } else if (order.status === 'accepted') {
          statusHtml = '<span class="px-1.5 py-0.5 rounded text-[10px] md:text-[11px] font-black border text-sky-300 border-sky-400/30 bg-sky-900/20 flex items-center gap-1">🔵 접수</span>';
          borderClass = 'border-sky-400/40 border-2';
        } else if (order.status === 'rejected') {
          statusHtml = '<span class="px-1.5 py-0.5 rounded text-[10px] md:text-[11px] font-black border text-yellow-500 border-yellow-500/30 bg-yellow-500/10 flex items-center gap-1">⚠️ 반려</span>';
          borderClass = 'border-yellow-500/30';
        } else {
          statusHtml = '<span class="px-1.5 py-0.5 rounded text-[10px] md:text-[11px] font-black border text-red-400 border-red-500/30 bg-red-500/10 flex items-center gap-1"><span class="animate-pulse">🔴</span> 대기</span>';
        }

        const myOrders = getMyOrders();
        const isMyOrder = myOrders.some(o => o.key === order.id);
        const myBadge = isMyOrder ? `<div class="absolute -top-2 -left-1 z-10 bg-[#8788EE] text-white text-[8px] font-black px-1.5 py-0.5 rounded-full shadow-md">나의 주문</div>` : '';
        if (isMyOrder && order.status === 'accepted') {
          bubbleHtml = `<div class="flex justify-center mt-0.5"><div class="speech-bubble px-2 py-0.5 w-fit"><span class="text-[9px] md:text-[10px] font-black text-sky-300 whitespace-nowrap">접수 완료! 잠시만 기다려주세요 🙏</span></div></div>`;
        }

        return `
          <div class="flex flex-col shrink-0">
            <div class="relative flex items-center gap-2 px-3 py-1.5 rounded-lg border ${borderClass} bg-gray-950 shadow-md transition-all duration-500">
              ${myBadge}
              <span class="text-xs md:text-sm font-black text-gray-500">${timeStr}</span>
              <span class="text-[11px] md:text-xs font-bold text-white truncate max-w-[120px] md:max-w-[150px]">${escapeHTML(order.itemName)}</span>
              ${statusHtml}
            </div>
            ${bubbleHtml}
          </div>
        `;
      }).join('');

      // 플로팅 시스템 업데이트
      updateFloating(ordersData);
    });

    const CLS_COLOR = { 
      "메오": "#8788EE", "후제": "#8788EE", "무통": "#8788EE", "앙리자이에": "#8788EE", "그로": "#8788EE", "포므리": "#0070DE", 
      "뒤작": "#A330C9", "디켐": "#FFF569", "크뤼그": "#C41E3A", "아르망": "#F48CBA", "라피트": "#3FC7EB", "장테": "#00FF96", "돔페리뇽": "#00FF98", "오베르": "#8788EE", "르루아": "#8788EE", "미정": "#6B7280"
    };
    
    const CAT_ICONS = {
      "무기류 (무기 / 방패 / 보조무기)":    "⚔️",
      "공통 방어구 (망토 / 반지 / 목걸이)": "🧣",
      "천 방어구":       "🧵",
      "가죽 방어구":     "🦎",
      "사슬 방어구":     "⛓️",
      "판금 방어구":     "🛡️",
      "기계공학 방어구": "⚙️",
      "전문 기술 장비":  "🔧",
      "PVP 무기류":      "🏆",
      "PVP 공통 방어구": "🏆",
      "PVP 천 방어구":   "🏆",
      "PVP 가죽 방어구": "🏆",
      "PVP 사슬 방어구": "🏆",
      "PVP 판금 방어구": "🏆"
    };

    const starIconSVG = `<svg class="w-3.5 h-3.5 mb-0.5 inline-block" viewBox="0 0 24 24" fill="#EAB308"><polygon points="12 2, 22 9, 18 21, 6 21, 2 9"/></svg>`;
    function applyGoldStar(text) { return text.replace('(금색)', `<span class="inline-flex items-center text-[#EAB308] gap-0.5 font-black ml-0.5">(금색)${starIconSVG}</span>`); }

    const MISSIVES = [
      { label: "유연+가속<br>(금색)", copy: "서광의 탈라시안 서신", icon: "inv_10_inscription2_repcontracts_scroll_02_uprez" },
      { label: "특화+가속<br>(금색)", copy: "열꽃의 탈라시안 서신", icon: "inv_10_inscription2_repcontracts_scroll_02_uprez_color2" },
      { label: "치명타+가속<br>(금색)", copy: "불꽃섬광의 탈라시안 서신", icon: "inv_10_inscription2_repcontracts_scroll_02_uprez_color3" },
      { label: "유연+특화<br>(금색)", copy: "조화의 탈라시안 서신", icon: "inv_10_inscription2_repcontracts_scroll_02_uprez_color4" },
      { label: "치명타+특화<br>(금색)", copy: "무쌍의 탈라시안 서신", icon: "inv_10_inscription2_repcontracts_scroll_02_uprez_color2" },
      { label: "유연+치명타<br>(금색)", copy: "쾌검의 탈라시안 서신", icon: "inv_10_inscription2_repcontracts_scroll_02_uprez_color5" }
    ];

    const GATHERING_MISSIVES = [
      { label: "인지력<br>(금색)", copy: "인지력의 탈라시안 서신", icon: "inv_10_inscription2_repcontracts_80_warscroll_fortitude_uprez_color3" },
      { label: "능숙함<br>(금색)", copy: "능숙함의 탈라시안 서신", icon: "inv_10_inscription2_repcontracts_80_warscroll_fortitude_uprez_color5" },
      { label: "기교<br>(금색)", copy: "기교의 탈라시안 서신", icon: "inv_10_inscription2_repcontracts_80_warscroll_fortitude_uprez_color2" }
    ];

    const CRAFTING_MISSIVES = [
      { label: "지혜<br>(금색)", copy: "지혜의 탈라시안 서신", icon: "inv_10_inscription2_repcontracts_80_scroll_uprez_color1" },
      { label: "복수 제작<br>(금색)", copy: "복수 제작의 탈라시안 서신", icon: "inv_10_inscription2_repcontracts_80_scroll_uprez_color2" },
      { label: "독창성<br>(금색)", copy: "독창성의 탈라시안 서신", icon: "inv_10_inscription2_repcontracts_80_scroll_uprez" },
      { label: "제작 속도<br>(금색)", copy: "제작 속도의 탈라시안 서신", icon: "inv_10_inscription2_repcontracts_80_warscroll_fortitude_uprez" }
    ];

    const EMBELLISHMENTS_ARMOR = [
      { label: "축복받은 천산갑 부적<br>(금색)", copy: "축복받은 천산갑 부적", icon: "inv_jewelry_necklace_139" },
      { label: "원시 포자 결속끈<br>(금색)", copy: "원시 포자 결속끈", icon: "inv_12_profession_leatherworking_armor_banding_green" },
      { label: "포식의 결속끈<br>(금색)", copy: "포식의 결속끈", icon: "inv_12_profession_leatherworking_armor_banding_brown" },
      { label: "안정화 보석 사선 주머니<br>(금색)", copy: "안정화 보석 사선 주머니", icon: "inv_jewelry_ring_77" },
      { label: "비전매듭 안감<br>(금색)", copy: "비전매듭 안감", icon: "inv_12_tailoring_rare_cloth_violet_rare-cloth" },
      { label: "태양불꽃 비단 안감<br>(금색)", copy: "태양불꽃 비단 안감", icon: "inv_12_tailoring_rare_cloth_orange-_rare-cloth" }
    ];

    const EMBELLISHMENTS_WEAPON = [
      { label: "축복받은 천산갑 부적<br>(금색)", copy: "축복받은 천산갑 부적", icon: "inv_jewelry_necklace_139" },
      { label: "원시 포자 결속끈<br>(금색)", copy: "원시 포자 결속끈", icon: "inv_12_profession_leatherworking_armor_banding_green" },
      { label: "포식의 결속끈<br>(금색)", copy: "포식의 결속끈", icon: "inv_12_profession_leatherworking_armor_banding_brown" },
      { label: "다크문 혈기<br>(금색)", copy: "다크문 인장: 혈기", icon: "inv_12_profession_inscriptions_darkmoonsigil_bloom" },
      { label: "다크문 사냥<br>(금색)", copy: "다크문 인장: 사냥", icon: "inv_12_profession_inscriptions_darkmoonsigil_hunt" },
      { label: "다크문 부식<br>(금색)", copy: "다크문 인장: 부식", icon: "inv_12_profession_inscriptions_darkmoonsigil_rot" },
      { label: "다크문 공허<br>(금색)", copy: "다크문 인장: 공허", icon: "inv_12_profession_inscriptions_darkmoonsigil_void" }
    ];

    const EMBELLISHMENTS_JEWELRY = [
      { label: "오색 집중의 눈동자<br>(금색)", copy: "오색 집중의 눈동자", icon: "item_cutmetagem" },
      { label: "안정화 보석 사선 주머니<br>(금색)", copy: "안정화 보석 사선 주머니", icon: "inv_jewelry_ring_77" },
      { label: "축복받은 천산갑 부적<br>(금색)", copy: "축복받은 천산갑 부적", icon: "inv_jewelry_necklace_139" }
    ];
    const CAT_KEY_TO_NAME = {
      "weapon":       "무기류 (무기 / 방패 / 보조무기)",
      "common_armor": "공통 방어구 (망토 / 반지 / 목걸이)",
      "cloth":        "천 방어구",
      "leather":      "가죽 방어구",
      "chain":        "사슬 방어구",
      "plate":        "판금 방어구",
      "engineering":  "기계공학 방어구",
      "profession":   "전문 기술 장비",
      "pvp_weapon":   "PVP 무기류",
      "pvp_common":   "PVP 공통 방어구",
      "pvp_cloth":    "PVP 천 방어구",
      "pvp_leather":  "PVP 가죽 방어구",
      "pvp_chain":    "PVP 사슬 방어구",
      "pvp_plate":    "PVP 판금 방어구"
    };
    // ── Firebase에서 아이템 데이터 로드 ──────────────────────────────────
    let DB = {};
    const allItemsFlat = [];

    // ── 자동 정렬 로직 ────────────────────────────────────────────────
    // 방어구 슬롯 순서: 머리→어깨→가슴→손목→손→허리→다리→발
    const ARMOR_SLOT_ORDER = { '머리':1,'어깨':2,'가슴':3,'손목':4,'손':5,'허리':6,'다리':7,'발':8 };
    // 공통 방어구 슬롯 순서: 망토→목걸이→반지
    const COMMON_SLOT_ORDER = { '망토':1,'목걸이':2,'반지':3 };

    // [장식 천 머리] → { slot:'머리', isDecoration:true }
    // [천 머리]      → { slot:'머리', isDecoration:false }
    // [방패]         → { slot:'방패', isDecoration:false }
    function parseBracket(name) {
      const m = name.match(/^\[(.+?)\]/);
      if (!m) return { slot: '', isDecoration: false };
      const bracket = m[1];
      const isDecoration = bracket.startsWith('장식');
      const parts = bracket.replace(/^장식\s*/, '').trim().split(/\s+/);
      const slot = parts[parts.length - 1] || '';
      return { slot, isDecoration };
    }

    // HOT+장식=1, HOT=2, 장식=3, 일반=4
    function getSlotPriority(item) {
      const { isDecoration } = parseBracket(item.name);
      if (item.popular && isDecoration) return 1;
      if (item.popular)                 return 2;
      if (isDecoration)                 return 3;
      return 4;
    }

    // 기계공학 방어구: 판금→사슬→가죽→천 순서
    const ARMOR_TYPE_ORDER = { '판금':1, '사슬':2, '가죽':3, '천':4 };

    function sortItems(items, catKey) {
      return items.slice().sort((a, b) => {
        if (catKey === 'weapon' || catKey === 'pvp_weapon' || catKey === 'profession') {
          // HOT 우선, 그 다음 가나다순
          const pa = getSlotPriority(a), pb = getSlotPriority(b);
          if (pa !== pb) return pa - pb;
          return a.name.localeCompare(b.name, 'ko');
        }
        if (catKey === 'common_armor' || catKey === 'pvp_common') {
          const { slot: sa } = parseBracket(a.name);
          const { slot: sb } = parseBracket(b.name);
          const oa = COMMON_SLOT_ORDER[sa] ?? 99;
          const ob = COMMON_SLOT_ORDER[sb] ?? 99;
          if (oa !== ob) return oa - ob;
          return getSlotPriority(a) - getSlotPriority(b);
        }
        if (catKey === 'engineering') {
          // 방어구 타입(판금→사슬→가죽→천) 후 슬롯(머리→손목→발)
          const getAT = n => { const m = n.match(/^\[기계공학\s+(\S+)/); return m ? m[1] : ''; };
          const ta = ARMOR_TYPE_ORDER[getAT(a.name)] ?? 99;
          const tb = ARMOR_TYPE_ORDER[getAT(b.name)] ?? 99;
          if (ta !== tb) return ta - tb;
          const { slot: sa } = parseBracket(a.name);
          const { slot: sb } = parseBracket(b.name);
          return (ARMOR_SLOT_ORDER[sa] ?? 99) - (ARMOR_SLOT_ORDER[sb] ?? 99);
        }
        // 방어구 (cloth/leather/chain/plate + PVP 변형 전부)
        const { slot: sa } = parseBracket(a.name);
        const { slot: sb } = parseBracket(b.name);
        const oa = ARMOR_SLOT_ORDER[sa] ?? 99;
        const ob = ARMOR_SLOT_ORDER[sb] ?? 99;
        if (oa !== ob) return oa - ob;
        return getSlotPriority(a) - getSlotPriority(b);
      });
    }

    function buildDB(itemsData) {
      DB = {};
      allItemsFlat.length = 0;
      if (!itemsData) return;
      Object.keys(CAT_KEY_TO_NAME).forEach(catKey => {
        const catName = CAT_KEY_TO_NAME[catKey];
        const catItems = itemsData[catKey];
        if (!catItems) return;
        const raw = Object.values(catItems).map(item => ({
          ...item,
          reqMats: item.reqMats ? Object.values(item.reqMats) : []
        }));
        DB[catName] = sortItems(raw, catKey);
        DB[catName].forEach(item => allItemsFlat.push({ ...item, cat: catName }));
      });
    }

    // items 경로만 직접 읽기 (루트 읽기 권한 불필요)
    onValue(ref(db, 'items'), (snap) => {
      buildDB(snap.val());
      renderSidebar(); window.__HJ_DB=DB; window.__HJ_ITEMS=allItemsFlat; window.dispatchEvent(new CustomEvent("hj:data"));
    }, { onlyOnce: true });

    // 애드온 다운로드 버튼 문구 동기화
    onValue(ref(db, 'addon_label'), (snap) => {
      const label = snap.val();
      const el = document.getElementById('addon-btn-label');
      if (el) el.textContent = label || '후제공방 애드온 다운로드';
    }, { onlyOnce: true });

    // 애드온 다운로드 링크 동기화
    onValue(ref(db, 'addon_url'), (snap) => {
      const url = snap.val();
      const el = document.getElementById('addon-download-link');
      if (el && url) el.href = url;
    }, { onlyOnce: true });

    // ── 제보 시스템 ────────────────────────────────────────────────────
    let currentReportType = '';

    window.toggleReportMenu = function() {
      const menu = document.getElementById('report-menu');
      const overlay = document.getElementById('report-overlay');
      const isHidden = menu.classList.toggle('hidden');
      overlay.classList.toggle('hidden', isHidden);
    };

    window.closeReportMenu = function() {
      document.getElementById('report-menu').classList.add('hidden');
      document.getElementById('report-overlay').classList.add('hidden');
    };

    window.showReportModal = function(type) {
      closeReportMenu();
      currentReportType = type;
      const title = document.getElementById('report-modal-title');
      const errorSec = document.getElementById('report-error-section');
      const content = document.getElementById('report-content');

      if (type === 'error') {
        title.textContent = '🔧 재료 오류 제보';
        errorSec.classList.remove('hidden');
        content.placeholder = '어떤 재료가 잘못되었는지 알려주세요.';
      } else {
        title.textContent = '💌 후제공방에 바란다';
        errorSec.classList.add('hidden');
        content.placeholder = '후제공방에 바라는 점을 자유롭게 적어주세요.';
      }
      content.value = '';
      document.getElementById('report-modal').classList.remove('hidden');
      document.getElementById('report-modal-overlay').classList.remove('hidden');
    };

    window.closeReportModal = function() {
      document.getElementById('report-modal').classList.add('hidden');
      document.getElementById('report-modal-overlay').classList.add('hidden');
    };

    window.loadReportItems = function() {
      const cat = document.getElementById('report-cat').value;
      const itemSel = document.getElementById('report-item');
      itemSel.innerHTML = '<option value="">아이템 선택</option>';
      if (!cat || !DB[cat]) return;
      DB[cat].forEach(item => {
        const opt = document.createElement('option');
        opt.value = item.name;
        opt.textContent = item.name;
        itemSel.appendChild(opt);
      });
    };

    window.submitReport = function() {
      const content = document.getElementById('report-content').value.trim();
      if (!content) return alert('내용을 입력해주세요.');

      const reportData = {
        type: currentReportType,
        content,
        timestamp: Date.now()
      };

      if (currentReportType === 'error') {
        const cat = document.getElementById('report-cat').value;
        const item = document.getElementById('report-item').value;
        if (!cat) return alert('카테고리를 선택해주세요.');
        reportData.category = cat;
        reportData.itemName = item || '(미선택)';
      }

      push(ref(db, 'reports'), reportData).then(() => {
        closeReportModal();
        alert('소중한 의견 감사합니다 🙏');
      }).catch(() => alert('전송 중 오류가 발생했습니다.'));
    };

    window.showDonationPopup = function() {
      // 자동 복사
      navigator.clipboard.writeText('토스뱅크 1002-6027-8503').catch(()=>{});
      document.getElementById('donation-popup').classList.remove('hidden');
      document.getElementById('donation-overlay').classList.remove('hidden');
    };
    window.hideDonationPopup = function() {
      document.getElementById('donation-popup').classList.add('hidden');
      document.getElementById('donation-overlay').classList.add('hidden');
    };
    window.copyAccountNumber = function() {
      navigator.clipboard.writeText('토스뱅크 1002-6027-8503').then(() => {
        const btn = document.getElementById('donation-copy-btn');
        btn.innerHTML = '<span class="text-amber-400 font-black text-[10px]">✓</span>';
        setTimeout(() => {
          btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f5c842" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
        }, 1500);
      });
    };

    window.showBookmarkToast = function() {
      const toast = document.getElementById('bookmark-toast');
      const overlay = document.getElementById('bookmark-overlay');
      toast.classList.remove('hidden');
      overlay.classList.remove('hidden');
    };
    window.hideBookmarkToast = function() {
      document.getElementById('bookmark-toast').classList.add('hidden');
      document.getElementById('bookmark-overlay').classList.add('hidden');
    };

    window.copyText = function(text, btn, color, isExact=false) {
      let clean = isExact ? text : text.replace(/\s*\(금색\)/g, '').trim();
      navigator.clipboard.writeText(clean).then(() => {
        const status = btn.querySelector('.mat-status');
        const old = status.innerHTML;
        btn.style.borderColor = color;
        btn.style.backgroundColor = color + "20"; 
        status.innerText = "복사됨!";
        status.style.color = color;
        setTimeout(() => { btn.style.borderColor = ""; btn.style.backgroundColor = ""; status.innerHTML = old; status.style.color = ""; }, 1100);
      });
    };

    window.copyTextExact = function(text, btn, color) {
      navigator.clipboard.writeText(text).then(() => {
        const status = btn.querySelector('.mat-status');
        const old = "📋 클릭하여 전체 필수 재료 복사하기";
        btn.style.borderColor = color;
        btn.style.backgroundColor = color + "20"; 
        status.innerText = "✅ 복사되었습니다!";
        status.style.color = color;
        setTimeout(() => { btn.style.borderColor = ""; btn.style.backgroundColor = ""; status.innerText = old; status.style.color = ""; }, 1500);
      });
    };

    window.showNotice = function() {
      document.getElementById('notice-state').classList.remove('hidden');
      document.getElementById('content-state').classList.add('hidden');
      if(window.innerWidth < 768) document.getElementById('detail-panel').scrollTop = 0;
    };

    // sendOrder는 아래 플로팅 시스템 초기화 이후에 정의됩니다

    let pendingItemForWarning = null;
    const WARN_GENERIC_TITLE = '제작 전 안내 말씀';
    const WARN_GENERIC_BODY = '<div class="mb-5">현재 이 품목은 전문화 지식 연구 단계로,<br><span class="text-[#8788EE] font-bold">3성이나 4성까지만 제작</span>이 가능합니다.<br><br>조만간 완벽한 <span class="text-white font-bold border-b border-[#8788EE]/50 pb-0.5">5성 확정 제작</span>으로<br>다시 찾아뵐 것을 약속드립니다!<br>해당 내용을 꼭 확인하신 후 의뢰를 부탁드리겠습니다.</div><p class="text-red-500 font-black text-[15px] md:text-base leading-tight drop-shadow-md">이 문구를 보시고도 의뢰하신 후<br>5성이 안된 부분에 대해서는<br>책임지지 않습니다.</p>';
    const WARN_PVP_TITLE = 'PVP 장비 안내';
    const WARN_PVP_BODY = '<div class="leading-relaxed">PVP 장비는 <span class="text-[#8788EE] font-bold">등급이 상관없는 아이템</span>입니다.<br>재료 자유롭게 넣고 의뢰주시고,<br><br><span class="text-sky-300 font-bold">"5성확정"이 활성화 되어있는 아이템에 한하여</span><br>반드시 5성을 원하시면 <span class="text-yellow-400 font-bold">재료를 모두 금성으로</span>,<br>최소 품질을 <span class="text-yellow-400 font-bold">5성</span>으로 설정 후 의뢰해 주세요</div>';
    function isPVPItem(it) { return !!(it && it.name && it.name.includes('[PVP')); }
    window.openWarningModal = function(item) {
      pendingItemForWarning = item;
      const pvp = isPVPItem(item);
      document.getElementById('warning-title').textContent = pvp ? WARN_PVP_TITLE : WARN_GENERIC_TITLE;
      document.getElementById('warning-body').innerHTML = pvp ? WARN_PVP_BODY : WARN_GENERIC_BODY;
      document.getElementById('warning-modal').classList.remove('hidden');
    };
    window.closeWarningModal = function() { pendingItemForWarning = null; document.getElementById('warning-modal').classList.add('hidden'); };
    window.proceedWarningModal = function() { if(pendingItemForWarning) renderDetail(pendingItemForWarning); closeWarningModal(); };

    window.toggleFav = function(itemName, event) {
      event.stopPropagation();
      if(favorites.includes(itemName)) { favorites = favorites.filter(i => i !== itemName); }
      else { favorites.push(itemName); }
      localStorage.setItem('favs', JSON.stringify(favorites));
      renderSidebar();
    };

    // [신규] 장바구니 기능
    window.addToCart = function(itemName) {
      const item = allItemsFlat.find(i => i.name === itemName);
      if(!item) return;
      if(!shoppingCart.some(i => i.name === itemName)) {
        shoppingCart.push(item);
      }
      updateCartUI();
      const cartBtn = document.getElementById('cart-btn');
      cartBtn.classList.add('scale-110', 'border-emerald-400');
      setTimeout(() => cartBtn.classList.remove('scale-110', 'border-emerald-400'), 300);
    };

    window.removeFromCart = function(itemName) {
      shoppingCart = shoppingCart.filter(i => i.name !== itemName);
      updateCartUI();
    };

    window.clearCart = function() {
      shoppingCart = [];
      updateCartUI();
      toggleCartModal(); 
    };

    window.toggleCartModal = function() {
      const modal = document.getElementById('cart-modal');
      modal.classList.toggle('hidden');
    };

    function updateCartUI() {
      const cartBtn = document.getElementById('cart-btn');
      const cartCount = document.getElementById('cart-count');
      const cartFloat = document.getElementById('cart-float-btn');
      const cartFloatCount = document.getElementById('cart-float-count');

      cartFloat.classList.remove('hidden');
      if(shoppingCart.length > 0) {
        cartBtn.classList.remove('hidden');
        cartCount.innerText = shoppingCart.length;
        cartFloatCount.textContent = shoppingCart.length;
        cartFloatCount.style.background = '#ef4444';
      } else {
        cartBtn.classList.add('hidden');
        cartFloatCount.textContent = '0';
        cartFloatCount.style.background = '#4b5563';
        document.getElementById('cart-modal').classList.add('hidden');
      }

      const itemsContainer = document.getElementById('cart-items-container');
      itemsContainer.innerHTML = '';
      shoppingCart.forEach(item => {
        const div = document.createElement('div');
        div.className = "flex items-center justify-between p-2 md:p-2.5 bg-gray-900 border border-gray-800 rounded-xl";
        div.innerHTML = `
          <div class="flex items-center gap-3 truncate">
            <img src="https://wow.zamimg.com/images/wow/icons/medium/${item.icon}.jpg" class="w-7 h-7 md:w-8 md:h-8 rounded-lg border border-gray-700 shrink-0">
            <span class="text-white font-bold text-xs md:text-sm truncate">${item.name}</span>
          </div>
          <button onclick="removeFromCart('${item.name}')" class="shrink-0 p-1.5 text-gray-500 hover:text-red-400 transition-colors">✕</button>
        `;
        itemsContainer.appendChild(div);
      });

      const matsMap = {};
      shoppingCart.forEach(item => {
        item.reqMats.forEach(mat => {
          if(!matsMap[mat.n]) matsMap[mat.n] = { ...mat, c: 0 };
          matsMap[mat.n].c += mat.c;
        });
      });

      const matsContainer = document.getElementById('cart-mats-container');
      matsContainer.innerHTML = '';
      Object.values(matsMap).forEach(mat => {
        const btn = document.createElement('button');
        btn.className = "flex items-center justify-between p-2.5 md:p-3 bg-gray-900 rounded-xl border border-gray-800 hover:border-emerald-500/50 hover:bg-emerald-500/5 transition-all group";
        btn.onclick = () => {
          const textToCopy = `${mat.n.replace(/\s*\(금색\)/g, ' (금색)')} x ${mat.c}`;
          navigator.clipboard.writeText(textToCopy).then(() => {
            const oldHtml = btn.innerHTML;
            btn.innerHTML = `<span class="text-emerald-400 font-bold text-xs md:text-sm w-full text-center">✅ 복사됨!</span>`;
            btn.style.borderColor = "#34d399";
            setTimeout(() => { btn.innerHTML = oldHtml; btn.style.borderColor = ""; }, 1000);
          });
        };
        btn.innerHTML = `
          <div class="flex items-center gap-3">
            <img src="https://wow.zamimg.com/images/wow/icons/small/${mat.i}.jpg" class="w-5 h-5 md:w-6 md:h-6 rounded-md shrink-0">
            <span class="text-gray-300 group-hover:text-emerald-300 font-bold text-[11px] md:text-xs text-left">${applyGoldStar(mat.n)}</span>
          </div>
          <span class="text-white font-black text-xs md:text-sm shrink-0 ml-2 drop-shadow-md">x ${mat.c}</span>
        `;
        matsContainer.appendChild(btn);
      });
    }

    window.copyCartAll = function() {
      if(shoppingCart.length === 0) return;
      const matsMap = {};
      // 재료 합산 로직
      shoppingCart.forEach(item => { 
        item.reqMats.forEach(mat => { 
          if(!matsMap[mat.n]) matsMap[mat.n] = { ...mat, c: 0 }; 
          matsMap[mat.n].c += mat.c; 
        }); 
      });

      // 재료 이름과 수량만 뽑아서 ' / '로 연결 (수식어 제거)
      const matsList = Object.values(matsMap)
        .map(m => `${m.n.replace(/\s*\(금색\)/g, ' (금색)')} x ${m.c}`)
        .join(" / ");
      
      // 클립보드에 matsList(재료 목록)만 복사
      navigator.clipboard.writeText(matsList).then(() => {
        const txt = document.getElementById('cart-copy-text');
        const oldText = txt.innerText;
        txt.innerText = "재료 리스트 복사 완료!";
        setTimeout(() => {
          txt.innerText = oldText;
        }, 2000);
      });
    };

    function generateOrderButtonHTML(crafter, itemName, showNotice=false) {
      if (itemCooldowns[itemName]) {
        return `
          <button class="order-action-btn w-full p-4 bg-gradient-to-r from-green-600/20 to-green-900/20 border-2 border-green-500/50 rounded-xl md:rounded-2xl font-black text-white cursor-not-allowed opacity-80 flex flex-col items-center justify-center gap-1">
            <span class="text-sm md:text-base z-10">✅ 주문 접수 완료!</span>
            <span class="text-xs md:text-sm text-green-400 relative z-10">잠시만 기다려주세요</span>
          </button>
          ${showNotice ? generateStatusNoticeHTML() : ''}
        `;
      }
      const _sc = statusRGB();
      return `
        <button onclick="sendOrder('${crafter}', '${itemName}')"
          class="order-action-btn order-pulse w-full p-4 border-2 rounded-xl md:rounded-2xl font-black text-white active:scale-95 flex items-center justify-between gap-2 relative overflow-hidden group" style="--sc-rgb:${_sc}; background:linear-gradient(to right, rgba(${_sc},0.2), rgba(${_sc},0.1)); border-color:rgba(${_sc},0.6);">
          <span class="absolute inset-0 w-full h-full bg-gradient-to-r from-transparent via-white/10 to-transparent -translate-x-full group-hover:animate-[shimmer_1.5s_infinite]"></span>
          <span class="finger-left text-lg md:text-xl select-none shrink-0 relative z-10">👉</span>
          <div class="flex flex-col items-center flex-1 gap-1 relative z-10">
            <span class="text-xs md:text-sm text-center leading-snug">
              <span class="text-gray-300 font-bold">① 인게임에서 먼저 주문을 넣어주세요</span><br>
              <span class="font-black text-white text-sm md:text-base">② 그 후 이 버튼을 눌러주세요!</span>
            </span>
            <span class="text-xs md:text-sm font-black tracking-wide animate-pulse" style="color:#f0abfc;">⚡ 클릭 즉시 제작자 핸드폰으로 알림이 전송됩니다</span>
          </div>
          <span class="finger-right text-lg md:text-xl select-none shrink-0 relative z-10">👈</span>
        </button>
        ${showNotice ? generateStatusNoticeHTML() : ''}
      `;
    }

    window.renderDetail = function(item) {
      currentDetailItem = item;
      document.getElementById('notice-state').classList.add('hidden');
      document.getElementById('content-state').classList.remove('hidden');
      document.getElementById('detail-panel').scrollTop = 0;

      const color = CLS_COLOR[item.crafter] || "#8788EE";
      const detailIcon = document.getElementById('detail-icon');
      const borderShine = document.getElementById('detail-5star-border');
      const badge = document.getElementById('detail-5star-badge');
      const whLink = document.getElementById('detail-wh-link');
      const nameLink = document.getElementById('detail-name-link');
      const detailName = document.getElementById('detail-name');
      
      const wowheadUrl = `https://www.wowhead.com/item=${item.id || 0}`;
      whLink.href = wowheadUrl;
      nameLink.href = wowheadUrl;
      detailIcon.src = `https://wow.zamimg.com/images/wow/icons/large/${item.icon}.jpg`;
      
      if(item.is5Star) {
        detailIcon.className = "w-full h-full rounded-2xl md:rounded-3xl relative z-0 shadow-lg";
        borderShine.classList.remove('hidden');
        badge.classList.remove('hidden');
      } else {
        detailIcon.className = "w-full h-full rounded-2xl md:rounded-3xl border-2 border-gray-800 shadow-xl relative z-0";
        borderShine.classList.add('hidden');
        badge.classList.add('hidden');
      }

      const isDecorationDetail = item.name.includes('[장식 ');
      detailName.className = `text-xl md:text-3xl leading-tight font-black tracking-tight font-kr-title truncate ${isDecorationDetail ? 'text-[#D6BCFA]' : 'text-white'}`;
      detailName.innerText = item.name;
      document.getElementById('detail-color-bar').style.color = color;
      document.getElementById('detail-indicator').style.backgroundColor = color;
      
      // [신규] 상세페이지 장바구니 버튼 생성
      const cartBtnWrapper = document.getElementById('detail-cart-btn-wrapper');
      cartBtnWrapper.innerHTML = `
        <button onclick="addToCart('${item.name}')" class="px-3 py-2 md:px-4 md:py-2.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/50 rounded-xl hover:bg-emerald-500/20 hover:scale-105 transition-all font-black text-xs md:text-sm flex items-center gap-2 shadow-md shrink-0">
          <svg class="w-4 h-4 md:w-5 md:h-5" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4"></path></svg>
          <span class="hidden md:inline">장바구니</span> 담기
        </button>
      `;

      document.getElementById('top-order-section').innerHTML = generateOrderButtonHTML(item.crafter, item.name, false);
      document.getElementById('bottom-order-section').innerHTML = generateOrderButtonHTML(item.crafter, item.name, true);
      
      const reqCont = document.getElementById('req-mats-container');
      reqCont.innerHTML = '';
      item.reqMats.forEach(m => {
        const b = document.createElement('button');
        b.className = "flex items-center justify-between p-3 md:p-4 bg-gray-900 rounded-xl border border-gray-800 hover:bg-gray-800 transition-all group";
        b.onclick = () => copyText(m.n, b, color);
        let matNameHtml = applyGoldStar(m.n);
        b.innerHTML = `<div class="flex items-center gap-3 flex-1 min-w-0"><img src="https://wow.zamimg.com/images/wow/icons/small/${m.i}.jpg" class="w-6 h-6 md:w-8 md:h-8 rounded-lg shrink-0"><span class="group-hover:text-white font-bold text-left">${matNameHtml}</span></div><span class="mat-status text-white font-black text-sm md:text-base drop-shadow-md shrink-0 ml-2">x ${m.c}</span>`;
        reqCont.appendChild(b);
      });

      const copyAllSec = document.getElementById('copy-all-section');
      const copyString = item.reqMats.map(m => `${m.n.replace(/\s*\(금색\)/g, ' (금색)')} x ${m.c}`).join(" / ");
      
      copyAllSec.innerHTML = `
        <button onclick="copyTextExact('${copyString.replace(/'/g, "\\'")}', this, '${color}')" class="w-full py-2.5 px-4 bg-gray-900 border border-gray-700 hover:border-[${color}]/50 hover:bg-gray-800 transition-all rounded-lg text-left group shadow-md flex flex-col gap-1.5">
          <div class="text-sm font-bold text-gray-200 group-hover:text-white flex items-center gap-2 transition-colors">
            <span class="mat-status">📋 클릭하여 전체 필수 재료 복사하기</span>
          </div>
          <div class="text-[11px] md:text-xs text-gray-500 group-hover:text-gray-400 leading-tight transition-colors">${copyString}</div>
        </button>
      `;

      const catName = allItemsFlat.find(i => i.name === item.name).cat;
      let showMissive = true, embellishType = null, missiveList = MISSIVES;

      // 신규 필드가 있으면 우선 적용, 없으면 기존 자동 결정
      if (item.missiveType || item.embellishType) {
          // missiveType 처리
          if (item.missiveType === 'none') { showMissive = false; }
          else if (item.missiveType === 'combat') { showMissive = true; missiveList = MISSIVES; }
          else if (item.missiveType === 'gather') { showMissive = true; missiveList = GATHERING_MISSIVES; }
          else if (item.missiveType === 'craft') { showMissive = true; missiveList = CRAFTING_MISSIVES; }
          // embellishType 처리
          if (item.embellishType === 'none') { embellishType = null; }
          else if (item.embellishType === 'armor') { embellishType = 'armor'; }
          else if (item.embellishType === 'weapon') { embellishType = 'weapon'; }
          else if (item.embellishType === 'jewelry') { embellishType = 'jewelry'; }
      } else if (catName === "전문 기술 장비") {
          if (item.name.includes('도구]')) {
              showMissive = true;
              missiveList = (item.name.includes('[약초채집') || item.name.includes('[채광') || item.name.includes('[무두질')) ? GATHERING_MISSIVES : CRAFTING_MISSIVES;
          } else { showMissive = false; }
      } else if (catName.startsWith('PVP ') || catName === "기계공학 방어구") {
          showMissive = false;
          embellishType = null;
      } else if (item.name.includes('[장식 ')) {
          showMissive = item.name.includes('죽음의 골목 낚시 바늘');
      } else {
          showMissive = true;
          if (catName === "무기류 (무기 / 방패 / 보조무기)" || catName === "PVP 무기류") embellishType = item.name.includes('[방패]') || item.name.includes('[PVP 방패]') ? 'armor' : 'weapon';
          else if (catName === "공통 방어구 (망토 / 반지 / 목걸이)") embellishType = item.name.includes('[망토]') ? 'armor' : 'jewelry';
          else embellishType = 'armor';
      }

      const optContSec = document.getElementById('opt-mats-section');
      if (showMissive) {
        optContSec.classList.remove('hidden');
        const optCont = document.getElementById('opt-mats-container');
        optCont.innerHTML = '';
        missiveList.forEach(opt => {
          const b = document.createElement('button');
          b.className = "flex flex-col items-center justify-center p-2 md:p-3 bg-gray-900 rounded-lg md:rounded-xl border border-gray-800 hover:bg-gray-800 transition-all group h-16 md:h-20 relative";
          b.onclick = () => copyText(opt.copy, b, color, true);
          b.innerHTML = `<img src="https://wow.zamimg.com/images/wow/icons/small/${opt.icon}.jpg" class="w-5 h-5 md:w-6 md:h-6 mb-1 opacity-70 group-hover:opacity-100"><span class="text-white group-hover:text-yellow-400 text-center leading-tight text-[10px] md:text-[11px] font-bold">${applyGoldStar(opt.label)}</span><span class="mat-status hidden"></span>`;
          optCont.appendChild(b);
        });
      } else optContSec.classList.add('hidden');

      const embContSec = document.getElementById('embellish-mats-section');
      if (embellishType) {
        embContSec.classList.remove('hidden');
        const embCont = document.getElementById('embellish-mats-container');
        embCont.innerHTML = '';
        let embList = (embellishType === 'weapon') ? EMBELLISHMENTS_WEAPON : (embellishType === 'jewelry' ? EMBELLISHMENTS_JEWELRY : EMBELLISHMENTS_ARMOR);
        embList.forEach(opt => {
          const b = document.createElement('button');
          b.className = "flex flex-col items-center justify-center p-2 md:p-3 bg-gray-900 rounded-lg md:rounded-xl border border-gray-800 hover:bg-gray-800 transition-all group h-16 md:h-20 relative";
          b.onclick = () => copyText(opt.copy, b, color, true);
          b.innerHTML = `<img src="https://wow.zamimg.com/images/wow/icons/small/${opt.icon}.jpg" class="w-5 h-5 md:w-6 md:h-6 mb-1 opacity-70 group-hover:opacity-100"><span class="text-white group-hover:text-yellow-400 text-center leading-tight text-[10px] md:text-[11px] font-bold">${applyGoldStar(opt.label)}</span><span class="mat-status hidden"></span>`;
          embCont.appendChild(b);
        });
      } else embContSec.classList.add('hidden');

      const feeCrafterSec = document.getElementById('fee-crafter-section');
      const getCopyValue = (val) => {
        if (!val || val === "자율") return "1";
        const onlyNumbers = val.replace(/[^0-9]/g, "");
        return onlyNumbers === "" ? "1" : onlyNumbers;
      };

      feeCrafterSec.innerHTML = `
        <div class="flex flex-col md:flex-row gap-4">
          <div class="flex flex-col gap-2.5 flex-1">
            <button onclick="copyText('${getCopyValue(item.fee)}', this, '#EAB308', true)" class="w-full px-4 py-2 bg-gray-900 rounded-xl border border-gray-800 flex justify-between items-center group hover:border-yellow-500 shadow-md">
              <span class="text-xs text-white font-black">기본 수수료</span>
              <span class="mat-status text-white group-hover:text-yellow-400 font-black text-base">${item.fee}</span>
            </button>
            ${item.is5Star ? `
            <button id="fee-5star-btn" onclick="copyText('${getCopyValue(item.fee5Star || item.fee)}', this, '#EAB308', true)" class="w-full p-4 md:p-5 bg-gray-900 rounded-xl md:rounded-2xl border border-yellow-500/40 transition-all flex justify-between items-center group hover:border-yellow-400 shadow-md flex-1">
              <span class="text-xs md:text-sm text-yellow-500/70 font-black tracking-widest flex items-center gap-1"><span class="text-[10px] md:text-xs">★</span>5성 수수료</span>
              <span class="mat-status text-yellow-400 font-black text-lg md:text-xl">${item.fee5Star || item.fee}</span>
            </button>` : `
            <button class="w-full p-4 bg-gray-900/40 rounded-xl border border-gray-800/50 flex justify-between items-center opacity-60 cursor-not-allowed flex-1">
              <span class="text-xs text-gray-600 font-black">5성 수수료</span>
              <span class="mat-status text-gray-500 font-black text-base">Coming Soon</span>
            </button>`}
          </div>
          <button onclick="copyText('${item.crafter}', this, '${color}', true)" class="flex-1 p-4 bg-gray-900 rounded-xl border border-gray-800 flex flex-col justify-center items-center group shadow-md hover:border-gray-700 transition-colors">
            <span class="text-xs text-white font-black">제작자</span>
            <span class="mat-status font-black text-2xl md:text-4xl" style="color: ${color}">${item.crafter}</span>
            <span class="text-xs md:text-sm text-white/80 font-bold mt-1.5">(클릭하시면 제작자 아이디가 복사됩니다)</span>
          </button>
        </div>
      `;
      if (window.$WowheadPower) { window.$WowheadPower.refreshLinks(); }
    };

    function createItemButton(item, container) {
      const btn = document.createElement('div');
      const isLock = !item.active;
      const is5Star = item.is5Star;
      const isFav = favorites.includes(item.name);
      const isDecoration = item.name.includes('[장식 ');
      
      const nameColorClass = isDecoration ? '!text-[#D6BCFA]' : (is5Star ? 'text-yellow-100' : 'text-gray-200');
      const cColor = CLS_COLOR[item.crafter] || "#8788EE";
      
      const hoverClass = isLock ? 'opacity-40 grayscale cursor-not-allowed' : 'cursor-pointer hover:bg-gray-800 group';
      
      btn.className = `w-full flex items-center p-2.5 md:p-3 border-b border-gray-800/30 last:border-0 text-left transition-all relative ${hoverClass}`;
      
      btn.onclick = () => { 
        if(!isLock) {
          if(isPVPItem(item) || !is5Star) {
            openWarningModal(item);
          } else {
            renderDetail(item);
          }
        } 
      };
      
      const iconBorder = is5Star ? 'border-0' : 'border border-gray-700 group-hover:border-['+cColor+'] shadow-md';
      const shineHTML = is5Star ? `<div class="gold-border-shine absolute inset-0 rounded-xl pointer-events-none z-10"></div>` : '';
      const badgeHTML = is5Star ? `
        <div class="wow-rank-5" style="top: -5px; right: -5px; width: 18px; height: 18px; z-index: 20;">
          <div class="wow-rank-5-bg"></div><div class="wow-rank-5-inner"></div>
          <span class="wow-rank-5-text" style="font-size: 10px;">5</span>
        </div>` : '';

      // [신규] HOT 마크 애니메이션
      const popularBadgeHTML = item.popular ? `
        <div class="absolute" style="bottom: -2px; left: -2px; z-index: 30;">
          <div class="hot-badge-flame text-white text-[7px] md:text-[8px] font-black px-1.5 py-0 rounded shadow-[0_0_5px_rgba(255,0,0,0.5)] border border-red-300/40">
            HOT
          </div>
        </div>` : '';

      const starColor = isFav ? "text-yellow-400 drop-shadow-[0_0_8px_rgba(234,179,8,0.6)] scale-110" : "text-gray-700 group-hover:text-yellow-400/50";
      const favStarHtml = `
        <div class="shrink-0 flex items-center justify-center pl-2 md:pl-3 pr-1 z-20 cursor-pointer" onclick="window.toggleFav('${item.name}', event)">
          <svg class="w-5 h-5 md:w-6 md:h-6 transition-all duration-300 ${starColor} hover:scale-125" fill="currentColor" viewBox="0 0 20 20">
            <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"></path>
          </svg>
        </div>
      `;

      btn.innerHTML = `
        <div class="relative shrink-0 w-10 h-10 md:w-11 md:h-11 mr-3 z-10">
          ${popularBadgeHTML}
          <a href="https://www.wowhead.com/item=${item.id || 0}" data-wowhead="domain=ko" onclick="return false;" class="cursor-default">
            <img src="https://wow.zamimg.com/images/wow/icons/large/${item.icon}.jpg" class="w-full h-full rounded-xl ${iconBorder} relative z-0">
            ${shineHTML}
            ${badgeHTML}
          </a>
        </div>
        <div class="flex-1 min-w-0 z-10">
          <a href="https://www.wowhead.com/item=${item.id || 0}" data-wowhead="domain=ko" onclick="return false;" class="text-[13px] md:text-[14px] font-black ${nameColorClass} ${isLock ? '' : 'group-hover:text-white'} hover:text-[${cColor}] transition-colors leading-tight truncate block cursor-default">
            ${item.name} ${isLock ? '<span class="text-red-600 text-[10px] ml-1 font-bold uppercase tracking-tighter no-underline">[Coming Soon]</span>' : ''}
          </a>
          <div class="text-[9px] md:text-[10px] font-black mt-1 uppercase tracking-widest flex items-center justify-between pointer-events-none" style="color: ${isLock ? '#6b7280' : cColor}">
            <span>${item.crafter}</span>
          </div>
        </div>
        ${favStarHtml}
      `;
      container.appendChild(btn);
    }

    function renderSidebar() {
      const categoryList = document.getElementById('category-list');
      const favCategoryContainer = document.getElementById('fav-category-container');
      
      categoryList.innerHTML = '';
      favCategoryContainer.innerHTML = '';

      if(favorites.length > 0) {
        const favDiv = document.createElement('div');
        favDiv.className = "border border-yellow-500/40 rounded-xl overflow-hidden bg-gray-900 mb-2 md:mb-3";

        const favBtn = document.createElement('button');
        favBtn.className = "w-full flex items-center justify-between p-2.5 md:p-3 bg-gradient-to-r from-yellow-500/10 to-gray-900 border-b border-yellow-500/20 transition-colors hover:bg-yellow-500/20";
        favBtn.innerHTML = `
          <span class="text-xs md:text-sm font-black text-yellow-400 tracking-tight font-kr-title flex items-center gap-1.5 truncate">
            <span class="text-sm md:text-base">⭐</span> <span class="truncate">즐겨찾기 목록</span>
          </span>
          <span class="text-[10px] font-black text-yellow-900 bg-yellow-400 px-2 py-0.5 rounded-full shrink-0">${favorites.length}</span>
        `;
        
        const favContent = document.createElement('div');
        favorites.forEach(favName => {
          const item = allItemsFlat.find(i => i.name === favName);
          if(item) createItemButton(item, favContent);
        });

        favBtn.onclick = () => favContent.classList.toggle('hidden');
        favDiv.append(favBtn, favContent);
        favCategoryContainer.appendChild(favDiv);
      }

      Object.keys(DB).forEach(cat => {
        const catIcon = CAT_ICONS[cat] || "📦";
        const isPVP = cat.startsWith('PVP ');
        const catDiv = document.createElement('div');
        catDiv.className = isPVP
          ? "border border-gray-700/40 rounded-xl overflow-hidden bg-gray-900/50 shadow mb-2 md:mb-3"
          : "border border-gray-800 rounded-xl overflow-hidden bg-gray-900 shadow-xl mb-2 md:mb-3";

        const catBtn = document.createElement('button');
        catBtn.className = isPVP
          ? "w-full flex items-center justify-between p-2.5 md:p-3 bg-gray-800/25 border-b border-gray-700/30 transition-colors hover:bg-gray-800/45"
          : "w-full flex items-center justify-between p-2.5 md:p-3 bg-gray-800/80 border-b border-gray-800 transition-colors hover:bg-gray-700";

        const textColor  = isPVP ? 'text-gray-500' : 'text-gray-100';
        const countStyle = isPVP ? 'text-gray-600 bg-gray-950/50' : 'text-gray-400 bg-gray-950';
        
        catBtn.innerHTML = `
          <span class="text-xs md:text-sm font-black ${textColor} tracking-tight font-kr-title flex items-center gap-1.5 truncate">
            <span class="text-sm md:text-base">${catIcon}</span>
            <span class="truncate">${cat}</span>
          </span>
          <span class="text-[10px] font-bold ${countStyle} px-2 py-0.5 rounded-full shrink-0">${DB[cat].length}</span>
        `;
        
        const content = document.createElement('div');
        content.className = "hidden"; 
        catBtn.onclick = () => content.classList.toggle('hidden');
        
        DB[cat].forEach(item => {
          createItemButton(item, content);
        });
        catDiv.append(catBtn, content);
        categoryList.appendChild(catDiv);
      });

      if (window.$WowheadPower) { window.$WowheadPower.refreshLinks(); }
    }

    // [신규] 유튜브 스마트 추출
    async function loadYouTubeVideos() {
      const API_KEY = "AIzaSyA0Z__SnQDgiECAdelINzLUhVu-BUb2S44";
      const CHANNEL_ID = "UCAkSV3gnM8K4a1f9lvvPl1Q";
      const UPLOADS_ID = CHANNEL_ID.replace(/^UC/, 'UU');
      const section = document.getElementById('youtube-section');
      const listContainer = document.getElementById('youtube-list');
      
      try {
        let finalVideos = [];
        
        // 1. 고정 영상
        if (FIXED_VIDEO_ID && FIXED_VIDEO_ID.trim() !== '') {
          const fixedRes = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${FIXED_VIDEO_ID}&key=${API_KEY}`);
          const fixedData = await fixedRes.json();
          if (fixedData.items && fixedData.items.length > 0) {
            const fixedItem = fixedData.items[0];
            fixedItem.snippet.resourceId = { videoId: fixedItem.id }; 
            finalVideos.push(fixedItem);
          }
        }

        // 2. 최신 영상
        const response = await fetch(`https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=6&playlistId=${UPLOADS_ID}&key=${API_KEY}`);
        const data = await response.json();
        let latestVideos = data.items || [];

        // 3. 중복 제거
        if (FIXED_VIDEO_ID && FIXED_VIDEO_ID.trim() !== '') {
          latestVideos = latestVideos.filter(v => v.snippet.resourceId.videoId !== FIXED_VIDEO_ID);
        }
        while (finalVideos.length < 5 && latestVideos.length > 0) {
          finalVideos.push(latestVideos.shift());
        }

        if (finalVideos.length > 0) {
          section.classList.remove('hidden');
          listContainer.innerHTML = finalVideos.map((v, index) => {
            const videoId = v.snippet.resourceId.videoId;
            const title = v.snippet.title;
            const thumb = v.snippet.thumbnails.medium ? v.snippet.thumbnails.medium.url : v.snippet.thumbnails.default.url;
            
            const isFixed = (FIXED_VIDEO_ID && FIXED_VIDEO_ID.trim() !== '' && index === 0);
            const borderClass = isFixed ? "border-yellow-500 shadow-[0_0_10px_rgba(234,179,8,0.3)]" : "border-gray-800 hover:border-[#8788EE]/60";
            const badgeHtml = isFixed ? `<div class="absolute top-1 left-1 bg-gradient-to-r from-yellow-600 to-yellow-500 text-black text-[9px] font-black px-1.5 py-0.5 rounded z-10 shadow-md">필독!</div>` : '';
            
            return `
              <a href="https://www.youtube.com/watch?v=${videoId}" target="_blank" class="group relative bg-gray-950 rounded-lg md:rounded-xl overflow-hidden border ${borderClass} transition-all shadow-md flex flex-col">
                ${badgeHtml}
                <div class="aspect-video overflow-hidden">
                  <img src="${thumb}" class="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500">
                </div>
                <div class="p-2 md:p-2.5">
                  <p class="text-[9px] md:text-[11px] font-bold text-gray-400 line-clamp-2 group-hover:text-white transition-colors leading-snug">${title}</p>
                </div>
              </a>
            `;
          }).join('');
        }
      } catch (e) { console.error("유튜브 로딩 에러:", e); }
    }

    // ── 플로팅 시스템 ────────────────────────────────────────────────────
    const FLOAT_LS_KEY = 'hooje_my_orders';        // 내 주문 key 배열
    const FLOAT_SEEN_KEY = 'hooje_float_seen';     // 이미 닫은 주문 key별 상태
    const FLOAT_24H = 24 * 60 * 60 * 1000;

    // 주문 버튼 클릭 시 key 저장 (sendOrder 호출 직후 연동 / notify 리디렉션 &o= 파라미터에서도 사용)
    function saveMyOrderKey(key, timestamp) {
      if (!key) return;
      const list = JSON.parse(localStorage.getItem(FLOAT_LS_KEY) || '[]');
      if (list.some(o => o.key === key)) return; // 중복 저장 방지 (새로고침 등)
      list.push({ key, timestamp });
      localStorage.setItem(FLOAT_LS_KEY, JSON.stringify(list));
    }

    // 24시간 초과 항목 정리
    function getMyOrders() {
      const now = Date.now();
      const list = JSON.parse(localStorage.getItem(FLOAT_LS_KEY) || '[]');
      const fresh = list.filter(o => (now - o.timestamp) < FLOAT_24H);
      if (fresh.length !== list.length) localStorage.setItem(FLOAT_LS_KEY, JSON.stringify(fresh));
      return fresh;
    }

    // 이미 닫은 상태 기록
    function getSeenMap() { return JSON.parse(localStorage.getItem(FLOAT_SEEN_KEY) || '{}'); }
    function markSeen(key, status) {
      const m = getSeenMap(); m[key] = status;
      localStorage.setItem(FLOAT_SEEN_KEY, JSON.stringify(m));
    }

    // 아이템명 약칭: [천 허리] 부분만 (innerHTML에 들어가므로 이스케이프)
    function shortName(itemName) {
      const m = String(itemName || '').match(/\[([^\]]+)\]/);
      return escapeHTML(m ? `[${m[1]}]` : itemName);
    }

    let floatingVisible = false;
    let floatingStatus = null; // 현재 플로팅에 표시 중인 status

    // 현재 플로팅에 표시된 주문 key들 (상태별로 구분해서 기록용)
    let floatingShownKeys = [];

    window.dismissFloating = function() {
      const el = document.getElementById('order-floating');
      const ov = document.getElementById('order-floating-overlay');
      el.classList.add('hiding');
      setTimeout(() => {
        el.classList.add('hidden');
        el.classList.remove('hiding');
        ov.classList.add('hidden');
        floatingVisible = false;
        // 지금 표시된 주문들만 seen으로 기록
        floatingShownKeys.forEach(({ key, status }) => markSeen(key, status));
        floatingShownKeys = [];
      }, 260);
    };

    function showFloating(msgHtml, status, borderColor, iconEmoji) {
      const el = document.getElementById('order-floating');
      const ov = document.getElementById('order-floating-overlay');
      const inner = document.getElementById('order-floating-inner');
      const msg = document.getElementById('order-floating-msg');
      const icon = document.getElementById('order-floating-icon');

      msg.innerHTML = msgHtml;
      icon.textContent = iconEmoji;
      inner.style.borderColor = borderColor;
      inner.style.boxShadow = `0 0 30px ${borderColor}40`;

      if (floatingVisible) {
        // 이미 열려있으면 반짝이며 교체
        inner.classList.remove('float-flash');
        void inner.offsetWidth;
        inner.classList.add('float-flash');
      } else {
        el.classList.remove('hidden', 'hiding');
        ov.classList.remove('hidden');
        floatingVisible = true;
      }
      floatingStatus = status;
    }

    function updateFloating(ordersData) {
      const myOrders = getMyOrders();
      if (!myOrders.length) return;

      const seenMap = getSeenMap();

      // Firebase에서 내 주문들 현재 상태 수집
      // "아직 이 상태로 닫지 않은" 주문만 골라냄
      const myOrderStatuses = myOrders.map(o => {
        const dbOrder = ordersData[o.key];
        if (!dbOrder) return null;
        const currentStatus = dbOrder.status;
        // pending이면 스킵
        if (currentStatus === 'pending') return null;
        // 이미 이 상태로 닫은 적 있으면 스킵
        if (seenMap[o.key] === currentStatus) return null;
        return { ...dbOrder, key: o.key };
      }).filter(Boolean);

      if (!myOrderStatuses.length) return;

      const accepted = myOrderStatuses.filter(o => o.status === 'accepted');
      const done     = myOrderStatuses.filter(o => o.status === 'done');
      const rejected = myOrderStatuses.filter(o => o.status === 'rejected');

      // 우선순위: accepted > rejected > done
      let targetStatus = null;
      if (accepted.length)       targetStatus = 'accepted';
      else if (rejected.length)  targetStatus = 'rejected';
      else if (done.length)      targetStatus = 'done';
      else return;

      // 메시지 빌드
      let msgHtml = '';

      if (targetStatus === 'accepted') {
        const others = done.length;
        if (accepted.length === 1) {
          const name = shortName(accepted[0].itemName);
          msgHtml = `고객님의 <b>${name}</b> 주문이 접수되었습니다.<br><br>주문이 밀려있거나 캐릭터 로딩 등의 사유로 다소 지연될 수 있으나, <b>3분 안에는 반드시 완료해드리겠습니다</b> 🙏`;
        } else {
          const names = accepted.map(o => shortName(o.itemName)).join(' · ');
          msgHtml = `고객님의 주문 <b>${accepted.length}건</b> (${names})이 접수되었습니다.${others ? `<br><span style="color:#38bdf8">(${others}건 완료 ✅)</span>` : ''}<br><br>주문이 밀려있거나 캐릭터 로딩 등의 사유로 다소 지연될 수 있으나, <b>3분 안에는 반드시 완료해드리겠습니다</b> 🙏`;
        }
        floatingShownKeys = accepted.map(o => ({ key: o.key, status: 'accepted' }));
        showFloating(msgHtml, 'accepted', '#38bdf8', '⚒️');

      } else if (targetStatus === 'rejected') {
        if (rejected.length === 1) {
          const name = shortName(rejected[0].itemName);
          msgHtml = `고객님의 <b>${name}</b> 주문이 반려되었습니다.<br><br>재료 부족, 재료 등급(금색 재료) 등의 사유로 제작이 어려운 상황입니다.<br><br>인게임 우편함에서 반려 사유를 확인해주세요 📬`;
        } else {
          const names = rejected.map(o => shortName(o.itemName)).join(' · ');
          msgHtml = `고객님의 주문 <b>${rejected.length}건</b> (${names})이 반려되었습니다.<br><br>재료 부족, 재료 등급(금색 재료) 등의 사유로 제작이 어려운 상황입니다.<br><br>인게임 우편함에서 반려 사유를 확인해주세요 📬`;
        }
        floatingShownKeys = rejected.map(o => ({ key: o.key, status: 'rejected' }));
        showFloating(msgHtml, 'rejected', '#eab308', '⚠️');

      } else if (targetStatus === 'done') {
        if (done.length === 1) {
          const name = shortName(done[0].itemName);
          msgHtml = `고객님의 <b>${name}</b> 제작이 완료되었습니다!<br><br>인게임 우편함을 확인해주세요 📬<br><br><span style="font-size:0.8em;color:#9ca3af">혹시 주문을 취소하셨더라도 이 메시지를 받으실 수 있습니다. 다음 기회에 다시 이용해주시면 감사드리겠습니다 🙏</span>`;
        } else {
          const names = done.map(o => shortName(o.itemName)).join(' · ');
          msgHtml = `고객님의 주문 <b>${done.length}건</b> (${names})이 모두 완료되었습니다!<br><br>인게임 우편함을 확인해주세요 📬<br><br><span style="font-size:0.8em;color:#9ca3af">혹시 주문을 취소하셨더라도 이 메시지를 받으실 수 있습니다. 다음 기회에 다시 이용해주시면 감사드리겠습니다 🙏</span>`;
        }
        floatingShownKeys = done.map(o => ({ key: o.key, status: 'done' }));
        showFloating(msgHtml, 'done', '#10b981', '✅');
      }
    }

    // ── 주문 버튼 재생성: 항상 "현재 보고 있는 아이템" 기준 ────────────
    function refreshOrderButtons() {
      if (!currentDetailItem) return;
      const top = document.getElementById('top-order-section');
      const bottom = document.getElementById('bottom-order-section');
      if (top) top.innerHTML = generateOrderButtonHTML(currentDetailItem.crafter, currentDetailItem.name, false);
      if (bottom) bottom.innerHTML = generateOrderButtonHTML(currentDetailItem.crafter, currentDetailItem.name, true);
    }

    window.sendOrder = function(crafter, itemName) {
      const now = Date.now();
      const cdKey = 'cd_' + itemName;
      const lastSent = parseInt(localStorage.getItem(cdKey) || '0');
      if (now - lastSent < 60000) return;
      localStorage.setItem(cdKey, now);
      if(itemCooldowns[itemName]) return;
      itemCooldowns[itemName] = true;

      // 1분 후 버튼 자동 복구 — 현재 표시 중인 아이템 기준으로만 재생성
      setTimeout(() => {
        itemCooldowns[itemName] = false;
        localStorage.removeItem(cdKey);
        refreshOrderButtons();
      }, 60000);

      const orderRef = push(ref(db, 'orders'), {
        crafter, itemName, status: 'pending', source: 'web', timestamp: serverTimestamp()
      });
      // key 저장 (serverTimestamp 대신 로컬 시각 사용)
      saveMyOrderKey(orderRef.key, Date.now());

      refreshOrderButtons();

      // 토큰은 서버(notify.js)에서만 관리 — src=web: 주문 기록은 위에서 이미 했으므로 서버 측 중복 기록 방지
      fetch(`/notify?item=${encodeURIComponent(itemName)}&src=web`)
        .catch(err => console.error('[TG] 알림 오류:', err));
    };

    function init() {
      // 알림 전송 완료 리디렉션 처리
      const _np = new URLSearchParams(location.search);
      if (_np.get('notified') === '1') {
        const _nc = decodeURIComponent(_np.get('c') || '');
        const _ni = decodeURIComponent(_np.get('i') || '');
        // notify 경유 주문도 '나의 주문'으로 추적 (뱃지 + 접수/완료 팝업)
        const _no = _np.get('o');
        if (_no) saveMyOrderKey(_no, Date.now());
        history.replaceState({}, '', location.pathname);
        const t = document.createElement('div');
        t.className = 'fixed top-6 left-1/2 -translate-x-1/2 z-[999] px-6 py-3 rounded-2xl bg-gray-900 border border-emerald-500/60 text-emerald-300 font-black text-sm shadow-2xl toast-animate whitespace-nowrap';
        t.textContent = _nc ? `${_nc}에게 알림 전송 완료` + (_ni ? ` — ${_ni}` : '') : '알림 전송 완료';
        document.body.appendChild(t);
        setTimeout(() => t.remove(), 6000);
      }

      const searchInput = document.getElementById('search-input');
      const searchResults = document.getElementById('search-results');
      const categoryList = document.getElementById('category-list');
      const favCategoryContainer = document.getElementById('fav-category-container');
      const noticeTabContainer = document.getElementById('notice-tab-container');

      window.clearSearchInput = function() {
        searchInput.value = '';
        document.getElementById('search-clear-btn').classList.add('hidden');
        searchResults.classList.add('hidden');
        categoryList.classList.remove('hidden');
        favCategoryContainer.classList.remove('hidden');
        noticeTabContainer.style.display = "block";
        searchResults.innerHTML = '';
      };

      searchInput.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase().replace(/\s/g, '');
        const clearBtn = document.getElementById('search-clear-btn');
        clearBtn.classList.toggle('hidden', query === '');
        if(query === '') {
          searchResults.classList.add('hidden');
          categoryList.classList.remove('hidden');
          favCategoryContainer.classList.remove('hidden');
          noticeTabContainer.style.display = "block";
          return;
        }

        searchResults.classList.remove('hidden');
        searchResults.classList.add('flex');
        categoryList.classList.add('hidden');
        favCategoryContainer.classList.add('hidden');
        noticeTabContainer.style.display = "none";
        searchResults.innerHTML = '';

        const filtered = allItemsFlat.filter(item => item.name.toLowerCase().replace(/\s/g, '').includes(query));
        
        if(filtered.length === 0) {
          searchResults.innerHTML = '<div class="text-gray-500 text-center py-5 md:py-6 font-bold text-sm md:text-base">검색 결과가 없습니다.</div>';
          return;
        }

        filtered.forEach(item => {
          const wrapper = document.createElement('div');
          wrapper.className = "bg-gray-900 rounded-xl md:rounded-2xl overflow-hidden";
          createItemButton(item, wrapper);
          searchResults.appendChild(wrapper);
        });
        
        if (window.$WowheadPower) { window.$WowheadPower.refreshLinks(); }
      });

      const noticeDiv = document.createElement('div');
      noticeDiv.className = "border border-white/30 rounded-xl overflow-hidden bg-transparent mb-2 md:mb-3";
      noticeDiv.innerHTML = `
        <button onclick="showNotice()" class="w-full flex items-center gap-2 p-2.5 md:p-3 transition-colors hover:bg-white/5">
          <span class="text-base md:text-lg">🏠</span>
          <span class="text-sm md:text-[15px] font-black text-white tracking-tight font-kr-title">메인화면</span>
        </button>
      `;
      noticeTabContainer.appendChild(noticeDiv);

      // ── 모바일 3단계 뷰 시스템 ──────────────────────────────────────
      // mobileState: 'default' | 'menu-full' | 'detail-full'
      let mobileState = 'default';

      const sidebar = document.getElementById('sidebar');
      const detailPanel = document.getElementById('detail-panel');
      const menuBtn = document.getElementById('mobile-menu-btn');
      const menuIcon = document.getElementById('mobile-menu-icon');
      const menuLabel = document.getElementById('mobile-menu-label');
      const backBtn = document.getElementById('mobile-back-btn');

      function isMobile() { return window.innerWidth < 768; }

      function applyMobileState(state) {
        if (!isMobile()) return;
        mobileState = state;

        if (state === 'default') {
          // 기본: 사이드바 1/3, 상세 2/3
          sidebar.style.height = '33.333%';
          sidebar.style.display = '';
          detailPanel.style.height = '66.666%';
          detailPanel.style.display = '';
          menuIcon.textContent = '☰';
          menuLabel.textContent = '메뉴 전체보기';
          menuBtn.classList.remove('hidden');
          backBtn.classList.add('hidden');

        } else if (state === 'menu-full') {
          // 메뉴 전체
          sidebar.style.height = '100%';
          sidebar.style.display = '';
          detailPanel.style.display = 'none';
          menuIcon.textContent = '✕';
          menuLabel.textContent = '닫기';
          menuBtn.classList.remove('hidden');
          backBtn.classList.add('hidden');

        } else if (state === 'detail-full') {
          // 상세 풀화면
          sidebar.style.display = 'none';
          detailPanel.style.height = '100%';
          detailPanel.style.display = '';
          menuBtn.classList.add('hidden');
          backBtn.classList.remove('hidden');
          // 복귀 버튼 위치: 헤더 아래
          const headerH = document.querySelector('header').offsetHeight +
                          (document.getElementById('live-order-feed').classList.contains('hidden') ? 0 : document.getElementById('live-order-feed').offsetHeight) +
                          (document.getElementById('ticker-container').classList.contains('hidden') ? 0 : document.getElementById('ticker-container').offsetHeight);
          backBtn.style.top = (headerH + 8) + 'px';
        }
      }

      window.toggleMobileMenu = function() {
        if (!isMobile()) return;
        if (mobileState === 'menu-full') applyMobileState('default');
        else applyMobileState('menu-full');
      };

      window.goToDefault = function() {
        if (!isMobile()) return;
        applyMobileState('default');
      };

      window.handleDetailPanelClick = function(e) {
        if (!isMobile()) return;
        if (mobileState !== 'default') return;
        // 인터랙티브 요소 클릭 시 무시
        const tag = e.target.tagName;
        if (['BUTTON','A','INPUT','SELECT','TEXTAREA','IMG'].includes(tag)) return;
        applyMobileState('detail-full');
      };

      // 모바일에서 아이템 클릭 시 detail-full로
      const _origRenderDetail = window.renderDetail;
      window.renderDetail = function(item) {
        _origRenderDetail(item);
        if (isMobile()) applyMobileState('detail-full');
      };

      // 공지사항 버튼 클릭 시도 detail-full로
      const _origShowNotice = window.showNotice;
      window.showNotice = function() {
        _origShowNotice();
        if (isMobile()) applyMobileState('detail-full');
      };

      // 초기 상태 설정
      if (isMobile()) applyMobileState('default');
      window.addEventListener('resize', () => {
        if (!isMobile()) {
          sidebar.style.cssText = '';
          detailPanel.style.cssText = '';
          backBtn.classList.add('hidden');
        } else {
          applyMobileState('default');
        }
      });

      renderSidebar();
      loadYouTubeVideos();
    }
    
    init();
