// ===================================================================
//  益田市イベントカレンダー — app.js（決定版）
//  カレンダー・一覧・ニュース・モーダル表示ロジック
// ===================================================================

// --- 共有状態（admin.js と共有）---
let supabaseClient;
let allEvents   = [];
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

  setupCalendarNav();
  setupModalListeners();
  setupAuth();      // admin.js で定義
  await loadEvents();
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

  allEvents = data || [];
  renderCalendar(calendarYear, calendarMonth);
  renderLatest();
  renderEventList();
  renderNews();
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

function pad2(n) { return String(n).padStart(2, '0'); }

function formatDate(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function formatDateJa(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return `${d.getMonth() + 1}月${d.getDate()}日（${DAY_NAMES[d.getDay()]}）`;
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

  // 月内イベント（ニュース除く）を日付でグループ化
  const byDate = {};
  for (const ev of allEvents) {
    if (!ev.is_news && ev.date.startsWith(prefix)) {
      (byDate[ev.date] = byDate[ev.date] || []).push(ev);
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
      if (evs.length <= 3) {
        for (let i = 0; i < evs.length; i++) {
          const dot = document.createElement('span');
          dot.className = 'day-dot';
          dotsWrap.appendChild(dot);
        }
      } else {
        const badge = document.createElement('span');
        badge.className = 'day-dot-count';
        badge.textContent = evs.length;
        dotsWrap.appendChild(badge);
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
  const evs = allEvents.filter(ev => !ev.is_news && ev.date >= today).slice(0, 10);

  if (evs.length === 0) {
    container.innerHTML = '<p class="empty-msg">直近のイベントはありません。</p>';
    return;
  }
  evs.forEach(ev => container.appendChild(buildLatestCard(ev)));
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
    img.src = imgs[0];
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

  const title = document.createElement('div');
  title.className = 'latest-card-title';
  title.textContent = ev.title;
  body.appendChild(title);

  const date = document.createElement('div');
  date.className = 'latest-card-date';
  date.textContent = formatDateJa(ev.date);
  body.appendChild(date);

  card.appendChild(body);
  card.addEventListener('click', () => openDetailModal(ev.id));
  card.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetailModal(ev.id); }
  });
  return card;
}

// ===================================================================
//  イベントリスト（フラット・日付順・今日以降）
// ===================================================================
function renderEventList() {
  const container = document.getElementById('event-list');
  if (!container) return;
  container.innerHTML = '';

  const today = todayStr();
  const evs = allEvents.filter(ev => !ev.is_news && ev.date >= today);

  if (evs.length === 0) {
    container.innerHTML = '<p class="empty-msg">登録されているイベントはありません。</p>';
    return;
  }

  evs.forEach(ev => container.appendChild(buildListItem(ev)));
}

function buildListItem(ev) {
  const item = document.createElement('div');
  item.className = 'list-item';
  item.setAttribute('role', 'button');
  item.setAttribute('tabindex', '0');

  const imgs = getImages(ev);
  if (imgs.length > 0) {
    const img = document.createElement('img');
    img.className = 'list-thumb';
    img.src = imgs[0];
    img.alt = ev.title;
    img.loading = 'lazy';
    item.appendChild(img);
  } else {
    const ph = document.createElement('div');
    ph.className = 'list-thumb-placeholder';
    ph.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`;
    item.appendChild(ph);
  }

  const info = document.createElement('div');
  info.className = 'list-info';

  const dateEl = document.createElement('div');
  dateEl.className = 'list-date';
  dateEl.textContent = formatDateJa(ev.date);
  info.appendChild(dateEl);

  const titleEl = document.createElement('div');
  titleEl.className = 'list-title';
  titleEl.textContent = ev.title;
  info.appendChild(titleEl);

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

function renderNews() {
  const newsEvs = allEvents.filter(ev => ev.is_news);

  // 14日以内のニュースだけ表示
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 14);
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

  allList.innerHTML = masudaList.innerHTML = hamadaList.innerHTML = tsuwanoList.innerHTML = shintenpoList.innerHTML = '';

  if (recent.length > 0) {
    recent.forEach(ev => allList.appendChild(buildNewsCard(ev)));
  } else {
    allList.innerHTML = '<p class="empty-msg">ニュースはありません。</p>';
  }

  if (masuda.length > 0) {
    masuda.forEach(ev => masudaList.appendChild(buildNewsCard(ev)));
  } else {
    masudaList.innerHTML = '<p class="empty-msg">益田市のニュースはありません。</p>';
  }

  if (hamada.length > 0) {
    hamada.forEach(ev => hamadaList.appendChild(buildNewsCard(ev)));
  } else {
    hamadaList.innerHTML = '<p class="empty-msg">浜田市のニュースはありません。</p>';
  }

  if (tsuwano.length > 0) {
    tsuwano.forEach(ev => tsuwanoList.appendChild(buildNewsCard(ev)));
  } else {
    tsuwanoList.innerHTML = '<p class="empty-msg">津和野町のニュースはありません。</p>';
  }

  shintenpo.forEach(ev => shintenpoList.appendChild(buildNewsCard(ev)));
}

function buildNewsCard(ev) {
  const card = document.createElement('div');
  card.className = 'news-card';

  // サムネイル（image_url 優先、なければ images[0]）
  const thumbUrl = ev.image_url || (ev.images && ev.images[0]);
  if (thumbUrl) {
    const img = document.createElement('img');
    img.className = 'news-card-img';
    img.src = thumbUrl;
    img.alt = ev.title;
    img.loading = 'lazy';
    card.appendChild(img);
  } else {
    const ph = document.createElement('div');
    ph.className = 'news-card-img-placeholder';
    ph.innerHTML = `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`;
    card.appendChild(ph);
  }

  const body = document.createElement('div');
  body.className = 'news-card-body';

  // 出典・日付行
  const meta = document.createElement('div');
  meta.className = 'news-card-meta';
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
  const dateEl = document.createElement('span');
  dateEl.className = 'news-card-date';
  dateEl.textContent = formatDateJa(ev.date);
  meta.appendChild(dateEl);
  body.appendChild(meta);

  const titleEl = document.createElement('div');
  titleEl.className = 'news-card-title';
  titleEl.textContent = ev.title;
  body.appendChild(titleEl);

  if (ev.comment) {
    const desc = document.createElement('div');
    desc.className = 'news-card-desc';
    desc.textContent = ev.comment;
    body.appendChild(desc);
  }

  if (ev.link) {
    const linkEl = document.createElement('a');
    linkEl.className = 'news-card-link';
    linkEl.href = ev.link;
    linkEl.target = '_blank';
    linkEl.rel = 'noopener noreferrer';
    linkEl.textContent = `詳しくはこちら${ev.place ? `（${ev.place}）` : ''} →`;
    body.appendChild(linkEl);
  }

  card.appendChild(body);

  card.addEventListener('click', e => {
    if (e.target.tagName === 'A') return;
    if (ev.link) window.open(ev.link, '_blank', 'noopener,noreferrer');
    else openDetailModal(ev.id);
  });
  return card;
}

// ===================================================================
//  日付モーダル
// ===================================================================
function openDayModal(dateStr) {
  document.getElementById('day-modal-title').textContent = `${dateStr} のイベント`;

  const evs   = allEvents.filter(ev => ev.date === dateStr && !ev.is_news);
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
    img.src = imgs[0];
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

  const rows = [
    ['日時', formatDateJa(ev.date)],
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

  // コメント
  if (ev.comment) {
    const commentEl = document.createElement('p');
    commentEl.className = 'detail-comment';
    commentEl.textContent = ev.comment;
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
    btn.addEventListener('click', () => {
      closeDrawer();
      if (btn.dataset.action === 'agenda') {
        openAgendaModal();
      } else if (btn.dataset.action === 'news-scroll') {
        switchSubTab(btn.dataset.area);
        setTimeout(() => {
          document.getElementById('news-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 100);
      }
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
