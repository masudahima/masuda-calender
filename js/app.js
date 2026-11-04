// ===================================================================
//  益田市イベントカレンダー — app.js（決定版）
//  カレンダー・一覧・ニュース・モーダル表示ロジック
// ===================================================================

// --- 共有状態（admin.js と共有）---
let supabaseClient;
let allEvents   = [];
let latestTodayOnly = false;
let calendarYear, calendarMonth;

// --- 定数 ---
const DAY_NAMES = ['日', '月', '火', '水', '木', '金', '土'];

// ===================================================================
//  起動
// ===================================================================
document.addEventListener('DOMContentLoaded', init);

async function init() {
  if (!SUPABASE_URL || SUPABASE_URL.includes('xxxxxxxxx')) {
    document.querySelector('main').innerHTML = `
      <div style="max-width:520px;margin:60px auto;padding:32px;text-align:center;color:#555;">
        <h2 style="font-size:20px;margin-bottom:12px;">セットアップが必要です</h2>
        <p style="line-height:1.7;">
          <code>js/config.js</code> の SUPABASE_URL・SUPABASE_ANON_KEY・ADMIN_EMAIL を設定してください。<br>
          詳しくは <code>setup/SETUP.md</code> を参照してください。
        </p>
      </div>`;
    return;
  }

  supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  const now = new Date();
  calendarYear  = now.getFullYear();
  calendarMonth = now.getMonth();

  setupReloadButton();
  setupCalendarNav();
  setupModalListeners();
  setupLatestCardFocus();
  setupTodayFilter();
  setupAuth();      // admin.js で定義
  await loadEvents();

  // 共有リンク（?e=<id>）で開かれたら、その記事を直接表示する
  const sharedId = new URLSearchParams(location.search).get('e');
  if (sharedId) openDetailModal(sharedId);
}

// ===================================================================
//  更新ボタン（ホーム画面に追加した場合はURLバー／再読み込みボタンが
//  出ないため、ページ内から再読み込みできるようにする）
//  あわせて、アプリに戻ってきたときにデータを取り直す。
// ===================================================================
let _lastLoadAt = 0;
function setupReloadButton() {
  const btn = document.getElementById('reload-btn');
  if (btn) {
    btn.addEventListener('click', () => {
      // キャッシュを避けて開き直す
      const url = new URL(window.location.href);
      url.searchParams.set('_r', Date.now());
      window.location.replace(url.toString());
    });
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - _lastLoadAt > 60 * 1000) {
      loadEvents();
    }
  });
}

// ===================================================================
//  データ取得
// ===================================================================
async function loadEvents() {
  const { data, error } = await supabaseClient
    .from('events')
    .select('*')
    .order('date',  { ascending: true })
    .order('title', { ascending: true });

  if (error) {
    console.error('loadEvents error:', error);
    showToast('イベントの読み込みに失敗しました', 'error');
    return;
  }

  _lastLoadAt = Date.now();
  allEvents = data || [];
  renderCalendar(calendarYear, calendarMonth);
  renderLatest();
  renderEventList();
  renderNews();
  renderOshirase();
}

// ===================================================================
//  ユーティリティ
// ===================================================================

// images[] 優先、なければ image_url にフォールバック
function getImages(ev) {
  if (ev.images && ev.images.length > 0) return ev.images;
  if (ev.image_url) return [ev.image_url];
  return [];
}

// Storageの画像は一覧表示では小さい版（-s）を使い、転送量を抑える（2026-11-03 対策）
function smallImgUrl(url) {
  if (!url || !url.includes('/storage/v1/object/public/event-images/')) return url;
  if (/-s\.jpe?g$/i.test(url)) return url;
  return url.replace(/\.(jpe?g|png)$/i, '-s.jpg');
}
function setThumbImg(img, url) {
  const t = smallImgUrl(url);
  if (t !== url) img.onerror = () => { img.onerror = null; img.src = url; };
  img.src = t;
}

// 新着バッジ: サイトに登録されてから3日以内のものに出す（2026-11-02 ユーザー希望）
function isNewItem(ev) {
  if (!ev.created_at) return false;
  return (Date.now() - new Date(ev.created_at).getTime()) <= 3 * 24 * 60 * 60 * 1000;
}

function buildNewBadge() {
  const b = document.createElement('span');
  b.className = 'new-badge';
  b.textContent = '新着';
  return b;
}

// おおかみ写真展は水曜休館: カレンダー・日付モーダル・地図で水曜日に出さない（2026-11-02 ユーザー指示）
const CLOSED_WED_EVENT_ID = '45c75908-9dec-4457-89e9-23fb975775f4';
function occursOnDate(ev, dateStr) {
  const end = ev.end_date || ev.date;
  if (ev.date > dateStr || end < dateStr) return false;
  if (ev.id === CLOSED_WED_EVENT_ID && new Date(dateStr + 'T00:00:00').getDay() === 3) return false;
  return true;
}

// 「水曜日は休館日です」を赤字で目立たせる（2026-11-02 ユーザー希望）
function appendCommentText(el, text) {
  const TARGET = '水曜日は休館日です';
  let rest = String(text || '');
  while (rest.length > 0) {
    const i = rest.indexOf(TARGET);
    if (i === -1) { el.appendChild(document.createTextNode(rest)); break; }
    if (i > 0) el.appendChild(document.createTextNode(rest.slice(0, i)));
    const s = document.createElement('span');
    s.className = 'text-alert';
    s.textContent = TARGET;
    el.appendChild(s);
    rest = rest.slice(i + TARGET.length);
  }
}

// 本文を一文ごとに分ける（「。」で区切り、段落ごとに間を空けて表示するため）
function splitSentences(text) {
  const out = [];
  String(text || '').split(/\n+/).forEach(line => {
    const parts = line.match(/[^。！？]*[。！？]|[^。！？]+/g) || [];
    parts.forEach(p => { const t = p.trim(); if (t) out.push(t); });
  });
  return out;
}

function pad2(n) { return String(n).padStart(2, '0'); }

function formatDate(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function formatDateJa(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return `${d.getMonth() + 1}月${d.getDate()}日（${DAY_NAMES[d.getDay()]}）`;
}

// ニュース本文の「日時：…」から開催日（M月D日）を抜き出す。期間は開始・終了の両日を返す
function extractEventDates(comment) {
  if (!comment) return [];
  const out = [];
  const push = (mo, dd) => {
    const s = `${Number(mo)}月${Number(dd)}日`;
    if (!out.includes(s)) out.push(s);
  };
  const segRe = /日時[：は]([^。]*)/g;
  let m;
  while ((m = segRe.exec(comment))) {
    const seg = m[1];
    const first = seg.match(/(\d{1,2})月(\d{1,2})日/);
    if (!first) continue;
    push(first[1], first[2]);
    const rest = seg.slice(seg.indexOf(first[0]) + first[0].length);
    const range = rest.match(/〜\s*(?:(\d{1,2})月)?\s*(\d{1,2})日/);
    if (range) push(range[1] || first[1], range[2]);
  }
  return out;
}

function todayStr() { return formatDate(new Date()); }

function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ===================================================================
//  カレンダー
// ===================================================================
function setupCalendarNav() {
  document.getElementById('prev-month').addEventListener('click', () => {
    if (--calendarMonth < 0) { calendarMonth = 11; calendarYear--; }
    renderCalendar(calendarYear, calendarMonth);
  });
  document.getElementById('next-month').addEventListener('click', () => {
    if (++calendarMonth > 11) { calendarMonth = 0; calendarYear++; }
    renderCalendar(calendarYear, calendarMonth);
  });
}

function renderCalendar(year, month) {
  document.getElementById('calendar-title').textContent = `${year}年${month + 1}月`;

  const grid = document.getElementById('calendar-grid');
  grid.innerHTML = '';

  const today    = todayStr();
  const prefix   = `${year}-${pad2(month + 1)}-`;
  const firstDow = new Date(year, month, 1).getDay();
  const lastDay  = new Date(year, month + 1, 0).getDate();

  // 月内イベント（ニュース除く）を日付でグループ化（複数日対応）
  const monthStart = `${year}-${pad2(month + 1)}-01`;
  const monthEnd   = `${year}-${pad2(month + 1)}-${pad2(lastDay)}`;
  const byDate = {};
  for (const ev of allEvents) {
    if (ev.is_news) continue;
    const end = ev.end_date || ev.date;
    if (ev.date > monthEnd || end < monthStart) continue;
    for (let d = 1; d <= lastDay; d++) {
      const ds = `${prefix}${pad2(d)}`;
      if (ds >= ev.date && ds <= end && occursOnDate(ev, ds)) {
        (byDate[ds] = byDate[ds] || []).push(ev);
      }
    }
  }

  // 空セル
  for (let i = 0; i < firstDow; i++) {
    const empty = document.createElement('div');
    empty.className = 'calendar-cell empty';
    grid.appendChild(empty);
  }

  for (let d = 1; d <= lastDay; d++) {
    const dateStr = `${prefix}${pad2(d)}`;
    const dow     = new Date(year, month, d).getDay();
    const evs     = byDate[dateStr] || [];

    const cell = document.createElement('div');
    cell.className = 'calendar-cell';
    if (dateStr === today) cell.classList.add('today');
    if (dow === 0) cell.classList.add('sun');
    if (dow === 6) cell.classList.add('sat');
    cell.dataset.date = dateStr;

    const num = document.createElement('span');
    num.className = 'day-number';
    num.textContent = d;
    cell.appendChild(num);

    if (evs.length > 0) {
      const dotsWrap = document.createElement('div');
      dotsWrap.className = 'day-dots';
      const showDots = Math.min(evs.length, 3);
      for (let i = 0; i < showDots; i++) {
        const dot = document.createElement('span');
        dot.className = 'day-dot';
        dotsWrap.appendChild(dot);
      }
      if (evs.length > 3) {
        const plus = document.createElement('span');
        plus.className = 'day-dot-plus';
        plus.textContent = '+';
        dotsWrap.appendChild(plus);
      }
      cell.appendChild(dotsWrap);
    }

    if (evs.length > 0) {
      cell.style.cursor = 'pointer';
      cell.addEventListener('click', () => openDayModal(dateStr));
    }
    grid.appendChild(cell);
  }
}

// ===================================================================
//  直近のイベント（横スクロールカード）
// ===================================================================
function renderLatest() {
  const container = document.getElementById('latest-scroll');
  if (!container) return;
  container.innerHTML = '';

  const today = todayStr();
  const evs = allEvents.filter(ev => {
    if (ev.is_news) return false;
    const end = ev.end_date || ev.date;
    return end >= today;
  });

  if (evs.length === 0) {
    container.innerHTML = '<p class="empty-msg">直近のイベントはありません。</p>';
    return;
  }
  evs.forEach(ev => container.appendChild(buildLatestCard(ev)));
  scheduleLatestCardFocus();
}

function buildLatestCard(ev) {
  const card = document.createElement('div');
  card.className = 'latest-card';
  card.setAttribute('role', 'button');
  card.setAttribute('tabindex', '0');

  const imgs = getImages(ev);
  const imgWrap = document.createElement('div');
  imgWrap.className = 'latest-card-img';
  if (imgs.length > 0) {
    const img = document.createElement('img');
    setThumbImg(img, imgs[0]);
    img.alt = ev.title;
    img.loading = 'lazy';
    imgWrap.appendChild(img);
  } else {
    imgWrap.innerHTML = `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`;
  }
  card.appendChild(imgWrap);

  const body = document.createElement('div');
  body.className = 'latest-card-body';

  if (ev.area) {
    const area = document.createElement('span');
    area.className = 'latest-card-area';
    area.dataset.area = ev.area;
    area.textContent = ev.area;
    body.appendChild(area);
  }
  if (isNewItem(ev)) body.appendChild(buildNewBadge());

  const title = document.createElement('div');
  title.className = 'latest-card-title';
  title.textContent = ev.title;
  body.appendChild(title);

  const date = document.createElement('div');
  date.className = 'latest-card-date';
  date.textContent = ev.end_date && ev.end_date !== ev.date
    ? `${formatDateJa(ev.date)}〜${formatDateJa(ev.end_date)}`
    : formatDateJa(ev.date);
  body.appendChild(date);

  card.appendChild(body);
  card.addEventListener('click', () => openDetailModal(ev.id));
  card.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetailModal(ev.id); }
  });
  return card;
}

// 横スワイプ：中央に近いカードを少し大きく見せる
let latestFocusFrame = null;

function updateLatestCardFocus() {
  const container = document.getElementById('latest-scroll');
  if (!container) return;
  const cards = container.querySelectorAll('.latest-card');
  if (cards.length === 0) return;

  const center = container.scrollLeft + container.clientWidth / 2;
  let front = null;
  let frontDistance = Infinity;

  cards.forEach(card => {
    const cardCenter = card.offsetLeft + card.offsetWidth / 2;
    const distance = Math.abs(cardCenter - center);
    const range = Math.max((card.offsetWidth + 10) * 1.15, 1);
    const closeness = Math.max(0, 1 - distance / range);
    const scale = 0.94 + closeness * 0.08;
    card.style.setProperty('--latest-scale', scale.toFixed(3));
    card.style.setProperty('--latest-opacity', (0.76 + closeness * 0.24).toFixed(3));
    if (distance < frontDistance) {
      frontDistance = distance;
      front = card;
    }
  });

  cards.forEach(card => card.classList.toggle('is-front', card === front));
}

function scheduleLatestCardFocus() {
  if (latestFocusFrame !== null) return;
  latestFocusFrame = requestAnimationFrame(() => {
    latestFocusFrame = null;
    updateLatestCardFocus();
  });
}

function setupTodayFilter() {
  const btn = document.getElementById('today-filter-btn');
  if (!btn || btn.dataset.ready) return;
  btn.dataset.ready = '1';
  btn.addEventListener('click', () => {
    latestTodayOnly = !latestTodayOnly;
    btn.classList.toggle('active', latestTodayOnly);
    btn.setAttribute('aria-pressed', String(latestTodayOnly));
    btn.textContent = latestTodayOnly ? 'すべて表示' : '今日のイベントにしぼる';
    renderLatest();
    const scroller = document.getElementById('latest-scroll');
    if (scroller) scroller.scrollTo({ left: 0, behavior: 'smooth' });
  });
}

function setupLatestCardFocus() {
  const container = document.getElementById('latest-scroll');
  if (!container || container.dataset.focusReady) return;
  container.dataset.focusReady = '1';
  container.addEventListener('scroll', scheduleLatestCardFocus, { passive: true });
  window.addEventListener('resize', scheduleLatestCardFocus);
}

// ===================================================================
//  イベントリスト（フラット・日付順・今日以降）
// ===================================================================
function renderEventList() {
  const container = document.getElementById('event-list');
  if (!container) return;
  container.innerHTML = '';

  const today = todayStr();
  const evs = allEvents.filter(ev => {
    if (ev.is_news) return false;
    const end = ev.end_date || ev.date;
    return end >= today && (!latestTodayOnly || ev.date <= today);
  });

  if (evs.length === 0) {
    container.innerHTML = latestTodayOnly
      ? '<p class="empty-msg">今日のイベントはありません。</p>'
      : '<p class="empty-msg">登録されているイベントはありません。</p>';
    return;
  }

  evs.forEach(ev => container.appendChild(buildListItem(ev)));
}

function buildListItem(ev) {
  const item = document.createElement('div');
  item.className = 'list-item';
  item.setAttribute('role', 'button');
  item.setAttribute('tabindex', '0');

  const [, mm, dd] = ev.date.split('-');
  const badge = document.createElement('div');
  badge.className = 'list-date-badge';
  badge.innerHTML = `<span class="list-date-month">${parseInt(mm)}月</span><span class="list-date-day">${parseInt(dd)}</span>`;
  item.appendChild(badge);

  const imgs = getImages(ev);
  if (imgs.length > 0) {
    const img = document.createElement('img');
    img.className = 'list-thumb';
    setThumbImg(img, imgs[0]);
    img.alt = ev.title;
    img.loading = 'lazy';
    item.appendChild(img);
  }

  const info = document.createElement('div');
  info.className = 'list-info';

  const titleEl = document.createElement('div');
  titleEl.className = 'list-title';
  titleEl.textContent = ev.title;
  if (isNewItem(ev)) titleEl.appendChild(buildNewBadge());
  info.appendChild(titleEl);

  if (ev.end_date && ev.end_date !== ev.date) {
    const endEl = document.createElement('div');
    endEl.className = 'list-end-date';
    endEl.textContent = `〜${formatDateJa(ev.end_date)}`;
    info.appendChild(endEl);
  }

  if (ev.place) {
    const placeEl = document.createElement('div');
    placeEl.className = 'list-place';
    placeEl.textContent = ev.place;
    info.appendChild(placeEl);
  }

  item.appendChild(info);

  const arrow = document.createElement('span');
  arrow.className = 'list-arrow';
  arrow.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>`;
  item.appendChild(arrow);

  item.addEventListener('click', () => openDetailModal(ev.id));
  item.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetailModal(ev.id); }
  });
  return item;
}

// ===================================================================
//  ニュース（益田 / 浜田市 / 津和野 分離）
// ===================================================================
const STORE_KEYWORDS = /オープン|新店舗|開店|グランドオープン|OPEN/i;

// ===================================================================
//  お知らせ
// ===================================================================
function renderOshirase() {
  const section = document.getElementById('oshirase-section');
  const list    = document.getElementById('oshirase-content');
  if (!section || !list) return;

  const items = allEvents
    .filter(ev => ev.is_news && ev.title.startsWith('お知らせ：'))
    .sort((a, b) => b.date.localeCompare(a.date));

  list.innerHTML = '';

  if (items.length === 0) {
    section.hidden = true;
    return;
  }

  section.hidden = false;
  items.forEach(ev => {
    const li = document.createElement('li');
    li.className = 'oshirase-item';

    const [, m, d] = ev.date.split('-');
    const dateEl = document.createElement('span');
    dateEl.className = 'oshirase-date';
    dateEl.textContent = `${parseInt(m)}月${parseInt(d)}日`;

    const titleEl = document.createElement('p');
    titleEl.className = 'oshirase-title';
    titleEl.textContent = ev.title.replace(/^お知らせ[：:]/, '').trim();

    li.appendChild(dateEl);
    li.appendChild(titleEl);

    if (ev.comment) {
      const body = document.createElement('p');
      body.className = 'oshirase-body';
      body.textContent = ev.comment;
      li.appendChild(body);
    }

    list.appendChild(li);
  });
}

// ニュースは1ページ10件ずつ表示し、11件目以降は次のページに回す（2026-11-03 ユーザー希望）
const NEWS_PER_PAGE = 10;
const newsPageState = { all: 1, masuda: 1, hamada: 1, tsuwano: 1, shintenpo: 1 };
let newsListsCache = { all: [], masuda: [], hamada: [], tsuwano: [], shintenpo: [] };

function fillNewsPanel(areaKey, listEl, emptyMsg) {
  const items = newsListsCache[areaKey] || [];
  listEl.innerHTML = '';
  if (items.length === 0) {
    if (emptyMsg) listEl.innerHTML = `<p class="empty-msg">${emptyMsg}</p>`;
    return;
  }
  const totalPages = Math.ceil(items.length / NEWS_PER_PAGE);
  let page = newsPageState[areaKey] || 1;
  if (page > totalPages) page = totalPages;
  if (page < 1) page = 1;
  newsPageState[areaKey] = page;
  items.slice((page - 1) * NEWS_PER_PAGE, page * NEWS_PER_PAGE)
    .forEach(ev => listEl.appendChild(buildNewsCard(ev)));
  if (totalPages > 1) listEl.appendChild(buildNewsPager(areaKey, page, totalPages));
}

function buildNewsPager(areaKey, page, totalPages) {
  const pager = document.createElement('div');
  pager.className = 'news-pager';
  const prev = document.createElement('button');
  prev.type = 'button';
  prev.className = 'news-pager-btn';
  prev.textContent = '前へ';
  prev.disabled = page <= 1;
  prev.addEventListener('click', () => setNewsPage(areaKey, page - 1));
  const label = document.createElement('span');
  label.className = 'news-pager-label';
  label.textContent = `${page} / ${totalPages}`;
  const next = document.createElement('button');
  next.type = 'button';
  next.className = 'news-pager-btn';
  next.textContent = '次へ';
  next.disabled = page >= totalPages;
  next.addEventListener('click', () => setNewsPage(areaKey, page + 1));
  pager.appendChild(prev);
  pager.appendChild(label);
  pager.appendChild(next);
  return pager;
}

function setNewsPage(areaKey, page) {
  newsPageState[areaKey] = page;
  const listEl = document.getElementById(`news-${areaKey}-list`);
  if (listEl) fillNewsPanel(areaKey, listEl, '');
  const section = document.getElementById('news-section');
  if (section) section.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderNews() {
  const newsEvs = allEvents.filter(ev => ev.is_news && !ev.title.startsWith('お知らせ：'));

  // 3週間（21日）以内のニュースだけ表示
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 21);
  const cutoffStr = formatDate(cutoff);
  const recent = [...newsEvs]
    .filter(ev => ev.date >= cutoffStr)
    .sort((a, b) => b.date.localeCompare(a.date));

  const masuda   = recent.filter(ev => ev.area !== '津和野' && ev.area !== '浜田市');
  const hamada   = recent.filter(ev => ev.area === '浜田市');
  const tsuwano  = recent.filter(ev => ev.area === '津和野');
  const shintenpo = recent.filter(ev => STORE_KEYWORDS.test(ev.title + (ev.comment || '')));

  // サブタブ「すべて」の件数を更新
  const allBtn = document.querySelector('.sub-tab-btn[data-area="all"]');
  if (allBtn) allBtn.innerHTML = `すべて<span class="sub-tab-note">（${recent.length}件）</span>`;

  // 新店舗タブは該当ニュースがある時だけ表示
  const shintenpoTab = document.getElementById('sub-tab-shintenpo');
  if (shintenpoTab) shintenpoTab.hidden = shintenpo.length === 0;

  const allList       = document.getElementById('news-all-list');
  const masudaList    = document.getElementById('news-masuda-list');
  const hamadaList    = document.getElementById('news-hamada-list');
  const tsuwanoList   = document.getElementById('news-tsuwano-list');
  const shintenpoList = document.getElementById('news-shintenpo-list');

  newsListsCache = { all: recent, masuda, hamada, tsuwano, shintenpo };
  fillNewsPanel('all', allList, 'ニュースはありません。');
  fillNewsPanel('masuda', masudaList, '益田市のニュースはありません。');
  fillNewsPanel('hamada', hamadaList, '浜田市のニュースはありません。');
  fillNewsPanel('tsuwano', tsuwanoList, '津和野町のニュースはありません。');
  fillNewsPanel('shintenpo', shintenpoList, '');
}

function buildNewsCard(ev) {
  const card = document.createElement('div');
  card.className = 'news-card';

  // 左カラム（サムネイル＋日付）
  const side = document.createElement('div');
  side.className = 'news-card-side';

  // サムネイル（image_url 優先、なければ images[0]）
  const thumbUrl = ev.image_url || (ev.images && ev.images[0]);
  if (thumbUrl) {
    const img = document.createElement('img');
    img.className = 'news-card-img';
    setThumbImg(img, thumbUrl);
    img.alt = ev.title;
    img.loading = 'lazy';
    side.appendChild(img);
  } else {
    const ph = document.createElement('div');
    ph.className = 'news-card-img-placeholder';
    ph.innerHTML = `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`;
    side.appendChild(ph);
  }

  const dateEl = document.createElement('span');
  dateEl.className = 'news-card-date';
  // 開催日と混同しないよう「M/Dのニュース」と表示する（2026-11-04 ユーザー指示）
  const dp = ev.date.split('-');
  dateEl.textContent = `${Number(dp[1])}/${Number(dp[2])}のニュース`;
  side.appendChild(dateEl);
  card.appendChild(side);

  const body = document.createElement('div');
  body.className = 'news-card-body';

  // 出典行（日付は写真の下に表示）
  const meta = document.createElement('div');
  meta.className = 'news-card-meta';
  if (isNewItem(ev)) meta.appendChild(buildNewBadge());
  if (STORE_KEYWORDS.test(ev.title + (ev.comment || ''))) {
    const tag = document.createElement('span');
    tag.className = 'news-card-tag news-card-tag--store';
    tag.textContent = '新店舗情報';
    meta.appendChild(tag);
  }
  if (ev.place) {
    const src = document.createElement('span');
    src.className = 'news-card-source';
    src.textContent = ev.place;
    meta.appendChild(src);
  }
  body.appendChild(meta);

  const titleEl = document.createElement('div');
  titleEl.className = 'news-card-title';
  titleEl.textContent = ev.title;
  body.appendChild(titleEl);

  if (ev.comment) {
    const desc = document.createElement('div');
    desc.className = 'news-card-desc';
    appendCommentText(desc, ev.comment);
    body.appendChild(desc);
  }

  card.appendChild(body);

  card.addEventListener('click', e => {
    if (e.target.tagName === 'A') return;
    openDetailModal(ev.id);
  });
  return card;
}

// ===================================================================
//  日付モーダル
// ===================================================================
function openDayModal(dateStr) {
  document.getElementById('day-modal-title').textContent = `${dateStr} のイベント`;

  const evs   = allEvents.filter(ev => {
    if (ev.is_news) return false;
    return occursOnDate(ev, dateStr);
  });
  const listEl = document.getElementById('day-modal-events');
  listEl.innerHTML = '';

  if (evs.length === 0) {
    listEl.innerHTML = '<p class="empty-msg">この日に登録されたイベントはありません。</p>';
  } else {
    evs.forEach(ev => listEl.appendChild(buildDayEventRow(ev)));
  }

  // 「イベント登録」ボタンに日付を渡す
  document.getElementById('day-register-btn').dataset.date = dateStr;

  // スクロールヒント
  const hint = document.getElementById('day-scroll-hint');
  const modalContent = document.querySelector('#day-modal .modal-content');
  hint.hidden = true;
  if (evs.length > 1) {
    requestAnimationFrame(() => {
      if (modalContent.scrollHeight > modalContent.clientHeight) {
        hint.hidden = false;
      }
    });
  }
  modalContent.addEventListener('scroll', function onScroll() {
    const nearBottom = modalContent.scrollTop + modalContent.clientHeight >= modalContent.scrollHeight - 40;
    hint.hidden = nearBottom;
    if (nearBottom) modalContent.removeEventListener('scroll', onScroll);
  }, { passive: true });

  document.getElementById('day-modal').hidden = false;
  document.body.classList.add('modal-open');
}

function buildDayEventRow(ev) {
  const row = document.createElement('div');
  row.className = 'day-event-row';

  const imgs = getImages(ev);
  if (imgs.length > 0) {
    const imgWrap = document.createElement('div');
    imgWrap.className = 'day-event-thumb-wrap';
    const img = document.createElement('img');
    img.className = 'day-event-thumb';
    setThumbImg(img, imgs[0]);
    img.alt = ev.title;
    img.loading = 'lazy';
    imgWrap.appendChild(img);
    const hint = document.createElement('span');
    hint.className = 'day-event-thumb-hint';
    hint.textContent = 'タップして詳細を見る';
    imgWrap.appendChild(hint);
    row.appendChild(imgWrap);
  }

  const info = document.createElement('div');
  info.className = 'day-event-info';

  const title = document.createElement('div');
  title.className = 'day-event-title';
  title.textContent = ev.title;
  info.appendChild(title);

  if (ev.place) {
    const place = document.createElement('div');
    place.className = 'day-event-place';
    place.textContent = `【場所】${ev.place}`;
    info.appendChild(place);
  }

  row.appendChild(info);
  row.addEventListener('click', () => {
    closeDayModal();
    openDetailModal(ev.id);
  });
  return row;
}

function closeDayModal() {
  document.getElementById('day-modal').hidden = true;
  document.body.classList.remove('modal-open');
}

// ===================================================================
//  詳細モーダル
// ===================================================================
async function openDetailModal(id) {
  let ev = allEvents.find(e => e.id === id);
  if (!ev) {
    const { data } = await supabaseClient.from('events').select('*').eq('id', id).single();
    ev = data;
  }
  if (!ev) return;

  const modal = document.getElementById('detail-modal');
  const body  = document.getElementById('detail-body');
  body.innerHTML = '';

  const imgs = getImages(ev);

  // 画像ギャラリー（タップで拡大）
  if (imgs.length > 0) {
    const gallery = document.createElement('div');
    gallery.className = 'detail-gallery';
    imgs.forEach((src, idx) => {
      const wrap = document.createElement('div');
      wrap.className = 'detail-img-wrap';
      const img = document.createElement('img');
      img.src = src;
      img.alt = `${ev.title} 画像${idx + 1}`;
      img.loading = 'lazy';
      wrap.appendChild(img);
      const hint = document.createElement('span');
      hint.className = 'detail-img-hint';
      hint.textContent = 'タップして拡大';
      wrap.appendChild(hint);
      wrap.addEventListener('click', () => openLightbox(imgs, idx));
      gallery.appendChild(wrap);
    });
    body.appendChild(gallery);
  }

  // タイトル
  const titleEl = document.createElement('h2');
  titleEl.className = 'detail-title';
  titleEl.textContent = ev.title;
  body.appendChild(titleEl);

  // メタ
  const meta = document.createElement('div');
  meta.className = 'detail-meta';

  // ニュース: 報道日は薄いグレーで小さく別表示し、本文の「日時：」から開催日を表示する（2026-11-04 ユーザー指示）
  if (ev.is_news) {
    const rep = document.createElement('div');
    rep.className = 'detail-reported';
    rep.textContent = `報道日 ${formatDateJa(ev.date)}`;
    body.appendChild(rep);
  }
  const eventDates = ev.is_news ? extractEventDates(ev.comment) : [];
  const rows = [
    ev.is_news
      ? (eventDates.length ? ['開催日', eventDates.join('／')] : null)
      : ['日時', ev.end_date && ev.end_date !== ev.date
        ? `${formatDateJa(ev.date)}〜${formatDateJa(ev.end_date)}`
        : formatDateJa(ev.date)],
    ev.place ? [ev.is_news ? '出典' : '場所', ev.place] : null,
    ev.area  ? ['エリア', ev.area] : null,
  ].filter(Boolean);

  rows.forEach(([label, val]) => {
    const row = document.createElement('div');
    row.className = 'detail-meta-row';
    row.innerHTML = `<span class="detail-meta-label">${label}</span><span>${esc(val)}</span>`;
    meta.appendChild(row);
  });
  body.appendChild(meta);

  // コメント（一文ごとに改行し、文の間を空けて読みやすくする）
  if (ev.comment) {
    const commentEl = document.createElement('div');
    commentEl.className = 'detail-comment';
    splitSentences(ev.comment).forEach(s => {
      const p = document.createElement('p');
      p.className = 'detail-sentence';
      appendCommentText(p, s);
      commentEl.appendChild(p);
    });
    body.appendChild(commentEl);
  }

  // 関連リンク
  if (ev.link) {
    const linkEl = document.createElement('a');
    linkEl.className = 'detail-link';
    linkEl.href = ev.link;
    linkEl.target = '_blank';
    linkEl.rel = 'noopener noreferrer';
    linkEl.textContent = '詳しくはこちら →';
    body.appendChild(linkEl);
  }

  // 共有ボタン（記事への直リンクを共有／コピーする）
  const shareBtn = document.createElement('button');
  shareBtn.className = 'detail-share-btn';
  shareBtn.textContent = '共有する';
  shareBtn.addEventListener('click', () => shareEvent(ev));
  body.appendChild(shareBtn);

  // 管理ボタン（ログイン中のみ）
  const sess = await supabaseClient.auth.getSession();
  if (sess?.data?.session) {
    const adminBtns = document.createElement('div');
    adminBtns.className = 'detail-admin-btns';

    const editBtn = document.createElement('button');
    editBtn.className = 'btn btn-outline btn-sm';
    editBtn.textContent = '編集';
    editBtn.addEventListener('click', () => {
      closeDetailModal();
      if (typeof openEventForm === 'function') openEventForm(ev);
    });
    adminBtns.appendChild(editBtn);

    const delBtn = document.createElement('button');
    delBtn.className = 'btn btn-danger btn-sm';
    delBtn.textContent = '削除';
    delBtn.addEventListener('click', async () => {
      if (!confirm(`「${ev.title}」を削除しますか？`)) return;
      if (typeof deleteEvent === 'function') await deleteEvent(ev.id);
      closeDetailModal();
    });
    adminBtns.appendChild(delBtn);

    const postedBtn = document.createElement('button');
    postedBtn.className = 'btn btn-ghost btn-sm';
    postedBtn.textContent = ev.posted ? '掲載済み ✓' : 'ストーリー掲載済みにする';
    postedBtn.addEventListener('click', async () => {
      if (typeof togglePosted === 'function') await togglePosted(ev.id, !ev.posted);
      closeDetailModal();
    });
    adminBtns.appendChild(postedBtn);

    body.appendChild(adminBtns);
  }

  modal.hidden = false;
  document.body.classList.add('modal-open');
}

function shareEvent(ev) {
  const url = `${location.origin}${location.pathname}?e=${ev.id}`;
  if (navigator.share) {
    navigator.share({ title: ev.title, text: ev.title, url }).catch(() => {});
  } else if (navigator.clipboard) {
    navigator.clipboard.writeText(url)
      .then(() => showToast('リンクをコピーしました'))
      .catch(() => showToast('コピーできませんでした', 'error'));
  } else {
    showToast('このブラウザでは共有できません', 'error');
  }
}

function closeDetailModal() {
  document.getElementById('detail-modal').hidden = true;
  document.body.classList.remove('modal-open');
}

// ===================================================================
//  ライトボックス（複数画像対応）
// ===================================================================
function openLightbox(imgs, startIdx) {
  const lb = document.getElementById('lightbox');
  const container = document.getElementById('lightbox-imgs');
  container.innerHTML = '';
  imgs.forEach(src => {
    const img = document.createElement('img');
    img.src = src;
    img.loading = 'lazy';
    container.appendChild(img);
  });
  lb.hidden = false;
  setTimeout(() => {
    const imgEls = container.querySelectorAll('img');
    if (imgEls[startIdx]) imgEls[startIdx].scrollIntoView({ behavior: 'instant', inline: 'start' });
  }, 0);
}

// ===================================================================
//  トースト
// ===================================================================
let _toastTimer;
function showToast(msg, type = 'info') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `toast toast--${type}`;
  el.hidden = false;
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => { el.hidden = true; }, 3800);
}

// ===================================================================
//  サブタブ切り替え（ニュース）
// ===================================================================
function switchSubTab(areaName) {
  document.querySelectorAll('.sub-tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.area === areaName);
  });
  document.querySelectorAll('.sub-tab-panel').forEach(panel => {
    panel.hidden = panel.id !== `news-${areaName}-list`;
  });
}

// ===================================================================
//  アジェンダ（テキストカレンダー）
// ===================================================================
function openAgendaModal() {
  renderAgenda();
  document.getElementById('agenda-modal').hidden = false;
  document.body.classList.add('modal-open');
}

function closeAgendaModal() {
  document.getElementById('agenda-modal').hidden = true;
  document.body.classList.remove('modal-open');
}

function renderAgenda() {
  const container = document.getElementById('agenda-body');
  container.innerHTML = '';

  const today = todayStr();
  const evs = allEvents.filter(ev => !ev.is_news && ev.date >= today);

  if (evs.length === 0) {
    container.innerHTML = '<p class="empty-msg">登録されているイベントはありません。</p>';
    return;
  }

  const byDate = {};
  evs.forEach(ev => {
    (byDate[ev.date] = byDate[ev.date] || []).push(ev);
  });

  Object.entries(byDate).sort().forEach(([date, events]) => {
    const d = new Date(date + 'T00:00:00');
    const group = document.createElement('div');
    group.className = 'agenda-group';

    const header = document.createElement('div');
    header.className = 'agenda-date-header';
    header.innerHTML = `
      <span class="agenda-date-label">${d.getFullYear()}年</span>
      <span class="agenda-date-num">${d.getMonth() + 1}/${d.getDate()}</span>
      <span class="agenda-date-dow">（${DAY_NAMES[d.getDay()]}）</span>
    `;
    group.appendChild(header);

    events.forEach(ev => {
      const row = document.createElement('div');
      row.className = 'agenda-event-row';
      row.setAttribute('role', 'button');
      row.setAttribute('tabindex', '0');

      const marker = document.createElement('div');
      marker.className = 'agenda-event-marker';
      row.appendChild(marker);

      const info = document.createElement('div');
      info.className = 'agenda-event-info';

      const title = document.createElement('div');
      title.className = 'agenda-event-title';
      title.textContent = ev.title;
      info.appendChild(title);

      if (ev.place) {
        const place = document.createElement('div');
        place.className = 'agenda-event-place';
        place.textContent = ev.place;
        info.appendChild(place);
      }

      row.appendChild(info);

      const arrow = document.createElement('span');
      arrow.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>`;
      arrow.style.color = 'var(--color-text-light)';
      arrow.style.flexShrink = '0';
      row.appendChild(arrow);

      row.addEventListener('click', () => { closeAgendaModal(); openDetailModal(ev.id); });
      row.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); closeAgendaModal(); openDetailModal(ev.id); }
      });

      group.appendChild(row);
    });

    container.appendChild(group);
  });
}

// ===================================================================
//  モーダル・ドロワー・タブ リスナーセットアップ
// ===================================================================
function setupModalListeners() {
  // ハンバーガー & ドロワー
  const hamburger    = document.getElementById('hamburger-btn');
  const drawer       = document.getElementById('nav-drawer');
  const drawerOverlay = document.getElementById('drawer-overlay');
  const drawerClose  = document.getElementById('drawer-close');

  function openDrawer() {
    drawer.hidden = false;
    drawerOverlay.hidden = false;
    hamburger.setAttribute('aria-expanded', 'true');
    document.body.classList.add('modal-open');
  }
  function closeDrawer() {
    drawer.hidden = true;
    drawerOverlay.hidden = true;
    hamburger.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('modal-open');
  }

  hamburger.addEventListener('click', openDrawer);
  drawerClose.addEventListener('click', closeDrawer);
  drawerOverlay.addEventListener('click', closeDrawer);

  drawer.querySelectorAll('.drawer-item').forEach(btn => {
    btn.addEventListener('click', e => {
      // 押した感触（ポチッ）を一瞬見せてから動作する
      btn.classList.add('is-pressed');
      if (!btn.dataset.action && btn.tagName === 'A') {
        // 温泉まとめ（リンク）は、押し感を見せてから遷移する
        e.preventDefault();
        setTimeout(() => { window.location.href = btn.href; }, 140);
        return;
      }
      setTimeout(() => {
        btn.classList.remove('is-pressed');
        closeDrawer();
        if (btn.dataset.action === 'agenda') {
          openAgendaModal();
        } else if (btn.dataset.action === 'map') {
          openMapModal();
        } else if (btn.dataset.action === 'news-scroll') {
          switchSubTab(btn.dataset.area);
          setTimeout(() => {
            document.getElementById('news-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }, 100);
        }
      }, 140);
    });
  });

  // サブタブ切り替え
  document.querySelectorAll('.sub-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchSubTab(btn.dataset.area));
  });

  // アジェンダモーダル
  document.getElementById('agenda-modal-close').addEventListener('click', closeAgendaModal);
  document.getElementById('agenda-modal-overlay').addEventListener('click', closeAgendaModal);

  // 日付モーダル
  document.getElementById('day-modal-close').addEventListener('click', closeDayModal);
  document.getElementById('day-modal').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeDayModal();
  });

  // 詳細モーダル
  document.getElementById('detail-modal-close').addEventListener('click', closeDetailModal);
  document.getElementById('detail-modal').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeDetailModal();
  });

  // ライトボックス
  document.getElementById('lightbox-close').addEventListener('click', () => {
    document.getElementById('lightbox').hidden = true;
  });
  document.getElementById('lightbox').addEventListener('click', e => {
    if (e.target === e.currentTarget) e.currentTarget.hidden = true;
  });

  // ESC キー
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (!drawer.hidden) { closeDrawer(); return; }
    if (!document.getElementById('lightbox').hidden) {
      document.getElementById('lightbox').hidden = true;
      return;
    }
    if (!document.getElementById('agenda-modal').hidden) { closeAgendaModal(); return; }
    closeDetailModal();
    closeDayModal();
  });
}

// ===================================================================
//  全体リフレッシュ（admin.js から呼ぶ）
// ===================================================================
async function refreshAll() {
  await loadEvents();
}

// ===================================================================
//  ボトムタブバー
// ===================================================================
(function () {
  const tabs = document.querySelectorAll('.bottom-tab-item');

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const targetId = tab.dataset.target;
      const target = document.getElementById(targetId);
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
    });
  });

  // スクロール位置に応じてアクティブタブを切り替え
  const sections = [
    { id: 'section-calendar', tab: document.querySelector('[data-target="section-calendar"]') },
    { id: 'section-events',   tab: document.querySelector('[data-target="section-events"]') },
    { id: 'news-section',     tab: document.querySelector('[data-target="news-section"]') },
  ];

  window.addEventListener('scroll', () => {
    const scrollY = window.scrollY + window.innerHeight / 3;
    let current = sections[0];
    sections.forEach(s => {
      const el = document.getElementById(s.id);
      if (el && el.offsetTop <= scrollY) current = s;
    });
    tabs.forEach(t => t.classList.remove('active'));
    if (current.tab) current.tab.classList.add('active');
  }, { passive: true });
})();


// ===================================================================
//  地図から見つける（ハンバーガーメニュー／日付ごとに切替）
// ===================================================================
const MAP_PIN_SPOTS = [
  ['美濃地屋敷', 34.6500, 132.1013],
  ['レストパーク', 34.5498, 132.0341],
  ['匹見事業所', 34.5647, 132.0254],
  ['サンエイト', 34.6878, 132.0223],
  ['さくらドーム', 34.6652, 131.9936],
  ['ひだまりパーク', 34.6652, 131.9936],
  ['ふれあいホールみと', 34.6652, 131.9936],
  ['ふれあいジム', 34.8571, 132.1433],
  ['三隅中央公園', 34.7838, 131.9569],
  ['石正美術館', 34.7845, 131.9567],
  ['三隅まちづくり', 34.7817, 131.9722],
  ['三隅', 34.7817, 131.9722],
  ['こども美術館', 34.8855, 132.0774],
  ['サンマリン浜田', 34.8874, 132.0586],
  ['いわみ中央', 34.8985, 132.1011],
  ['黒川町', 34.8985, 132.1011],
  ['市民体育館', 34.6859, 131.8551],
  ['万葉公園', 34.6817, 131.8101],
  ['さんさん牧場', 34.6800, 131.8220],
  ['グラントワ', 34.6728, 131.8473],
  ['市役所前', 34.6747, 131.8429],
  ['益田市役所', 34.6747, 131.8429],
  ['文華堂', 34.6785, 131.8432],
  ['高等技術校', 34.7047, 131.8611],
  ['ダイハツ', 34.6851, 131.8477],
  ['大草町', 34.7002, 131.8899],
  ['駅前', 34.6771, 131.8389],
  ['養老館', 34.4666, 131.7733],
  ['殿町', 34.4666, 131.7733],
  ['青原', 34.5787, 131.7951],
  ['柿木', 34.4560, 131.8690],
  ['六日市', 34.3539, 131.9353],
  ['金城', 34.8571, 132.1433],
  ['美都', 34.6652, 131.9936],
  ['匹見', 34.5647, 132.0254],
  ['津和野', 34.4666, 131.7733],
  ['吉賀', 34.3539, 131.9353],
  ['浜田', 34.8991, 132.0797],
  ['江津', 35.011, 132.218],
  ['萩', 34.408, 131.399]
];
const MAP_AREA_CENTER = {
  '市街地': [34.6771, 131.8450],
  '匹見': [34.5647, 132.0254],
  '美都': [34.6652, 131.9936],
  '津和野': [34.4666, 131.7733],
  '吉賀': [34.3539, 131.9353],
  '浜田市': [34.8991, 132.0797],
  '浜田': [34.8991, 132.0797],
  '江津市': [35.011, 132.218],
  '萩市': [34.408, 131.399]
};
function coordForEvent(ev) {
  const text = (ev.place || '') + ' ' + (ev.title || '');
  for (const [kw, la, ln] of MAP_PIN_SPOTS) {
    if (text.includes(kw)) return [la, ln];
  }
  return MAP_AREA_CENTER[ev.area] || null;
}

let evMap = null;
let evMapLayer = null;
let mapDateStr = null;
let mapListenersBound = false;

function mapFmtDate(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function mapParseDate(str) {
  const p = str.split('-').map(Number);
  return new Date(p[0], p[1] - 1, p[2]);
}

function openMapModal() {
  const modal = document.getElementById('map-modal');
  modal.hidden = false;
  document.body.classList.add('modal-open');
  if (!mapDateStr) mapDateStr = mapFmtDate(new Date());
  if (!mapListenersBound) { bindMapListeners(); mapListenersBound = true; }
  if (!evMap) {
    evMap = L.map('event-map').setView([34.68, 131.95], 9);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 18
    }).addTo(evMap);
    evMapLayer = L.layerGroup().addTo(evMap);
  }
  setTimeout(() => { evMap.invalidateSize(); renderMapDay(); }, 80);
}
function closeMapModal() {
  document.getElementById('map-modal').hidden = true;
  document.body.classList.remove('modal-open');
}
function bindMapListeners() {
  document.getElementById('map-modal-close').addEventListener('click', closeMapModal);
  document.getElementById('map-modal-overlay').addEventListener('click', closeMapModal);
  document.getElementById('map-prev-day').addEventListener('click', () => shiftMapDay(-1));
  document.getElementById('map-next-day').addEventListener('click', () => shiftMapDay(1));
  document.getElementById('map-today-btn').addEventListener('click', () => {
    mapDateStr = mapFmtDate(new Date());
    renderMapDay();
  });
  document.getElementById('map-date-input').addEventListener('change', e => {
    if (e.target.value) { mapDateStr = e.target.value; renderMapDay(); }
  });
}
function shiftMapDay(delta) {
  const d = mapParseDate(mapDateStr);
  d.setDate(d.getDate() + delta);
  mapDateStr = mapFmtDate(d);
  renderMapDay();
}
function renderMapDay() {
  const d = mapParseDate(mapDateStr);
  const dow = ['日', '月', '火', '水', '木', '金', '土'][d.getDay()];
  document.getElementById('map-date-label').textContent =
    (d.getMonth() + 1) + '月' + d.getDate() + '日（' + dow + '）';
  document.getElementById('map-date-input').value = mapDateStr;

  const evs = allEvents.filter(ev =>
    !ev.is_news && occursOnDate(ev, mapDateStr)
  );

  evMapLayer.clearLayers();
  const byCoord = {};
  evs.forEach(ev => {
    const c = coordForEvent(ev);
    if (!c) return;
    const key = c.join(',');
    (byCoord[key] = byCoord[key] || []).push(ev);
  });
  Object.entries(byCoord).forEach(([key, group]) => {
    const parts = key.split(',').map(Number);
    group.forEach((ev, i) => {
      let lat = parts[0], lng = parts[1];
      if (group.length > 1) {
        const a = (i / group.length) * Math.PI * 2;
        lat += Math.sin(a) * 0.012;
        lng += Math.cos(a) * 0.012;
      }
      const icon = L.divIcon({
        className: 'map-pin-wrap',
        html: '<div class="map-pin"></div>',
        iconSize: [22, 22],
        iconAnchor: [11, 20]
      });
      const marker = L.marker([lat, lng], { icon }).addTo(evMapLayer);
      const period = (ev.end_date && ev.end_date !== ev.date)
        ? ev.date + ' 〜 ' + ev.end_date : ev.date;
      marker.bindPopup(
        '<strong>' + esc(ev.title) + '</strong><br>' + period +
        (ev.place ? '<br>' + esc(ev.place) : '') +
        '<br><a href="#" class="map-popup-link" data-id="' + ev.id + '">詳細を見る</a>' +
        '<br><a href="https://www.google.com/maps/search/?api=1&query=' + lat + ',' + lng + '" target="_blank" rel="noopener">Googleマップで開く</a>'
      );
    });
  });

  const pinLatLngs = [];
  evMapLayer.eachLayer(m => { if (m.getLatLng) pinLatLngs.push(m.getLatLng()); });
  if (pinLatLngs.length > 0) {
    evMap.fitBounds(L.latLngBounds(pinLatLngs).pad(0.25), { maxZoom: 12 });
  } else {
    evMap.setView([34.68, 131.95], 9);
  }

  const list = document.getElementById('map-day-list');
  list.innerHTML = '';
  if (evs.length === 0) {
    list.innerHTML = '<p class="map-empty">この日のイベントはありません。「次の日」で進んでみてください。</p>';
    return;
  }
  const heading = document.createElement('p');
  heading.className = 'map-list-heading';
  heading.textContent = 'この日のイベント（' + evs.length + '件）';
  list.appendChild(heading);
  evs.forEach(ev => {
    const row = document.createElement('button');
    row.className = 'map-day-row';
    row.innerHTML = '<span class="map-day-row-title">' + esc(ev.title) + '</span>' +
      (ev.place ? '<span class="map-day-row-place">' + esc(ev.place) + '</span>' : '');
    row.addEventListener('click', () => { closeMapModal(); openDetailModal(ev.id); });
    list.appendChild(row);
  });
}
document.addEventListener('click', e => {
  const link = e.target.closest ? e.target.closest('.map-popup-link') : null;
  if (link) {
    e.preventDefault();
    closeMapModal();
    openDetailModal(link.dataset.id);
  }
});
