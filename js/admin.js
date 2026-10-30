// ===================================================================
//  益田市イベントカレンダー — admin.js（決定版）
//  認証・CRUD・画像アップロード・インポート/エクスポート
//  app.js の後に読み込んでください
// ===================================================================

// --- 内部状態 ---
let _editingId   = null;   // 編集中ID（新規は null）
let _imageState  = [];     // [{url: string, file: File|null}]
let _importData  = null;   // インポート用パース済みデータ

// ===================================================================
//  認証セットアップ（app.js の init() から呼ばれる）
// ===================================================================
function setupAuth() {
  // 認証状態の変化を監視
  supabaseClient.auth.onAuthStateChange((_event, session) => {
    _updateAuthUI(!!session);
    if (session) {
      checkAndDeleteOldData();
    }
  });

  // 初回セッション確認
  supabaseClient.auth.getSession().then(({ data: { session } }) => {
    _updateAuthUI(!!session);
    if (session) checkAndDeleteOldData();
  });

  // ログアウトボタン
  document.getElementById('logout-btn').addEventListener('click', async () => {
    await supabaseClient.auth.signOut();
    showToast('ログアウトしました', 'info');
  });

  // 「イベント登録」ボタン（日付パネル内）
  document.getElementById('day-register-btn').addEventListener('click', async () => {
    const date = document.getElementById('day-register-btn').dataset.date;
    const sess = await supabaseClient.auth.getSession();
    if (sess?.data?.session) {
      // ログイン済み → フォームを直接開く
      closeDayModal();
      openEventForm(null, date);
    } else {
      // 未ログイン → パスワードダイアログを表示
      _showPasswordDialog(() => {
        closeDayModal();
        openEventForm(null, date);
      });
    }
  });

  // パスワードモーダル
  document.getElementById('pw-submit').addEventListener('click', _onPwSubmit);
  document.getElementById('pw-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') _onPwSubmit();
  });
  document.getElementById('pw-modal-close').addEventListener('click', _closePwModal);
  document.getElementById('pw-cancel').addEventListener('click', _closePwModal);
  document.getElementById('password-modal').addEventListener('click', e => {
    if (e.target === e.currentTarget) _closePwModal();
  });

  // イベントフォームモーダル
  document.getElementById('event-modal-close').addEventListener('click', _closeEventModal);
  document.getElementById('event-modal').addEventListener('click', e => {
    if (e.target === e.currentTarget) _closeEventModal();
  });
  document.getElementById('cancel-event').addEventListener('click', _closeEventModal);
  document.getElementById('event-form').addEventListener('submit', _saveEvent);

  // ニュースチェック → 専用フィールドの表示切替
  document.getElementById('ev-is-news').addEventListener('change', _toggleNewsFields);

  // リンクURL入力 → ニュース時はOGP自動取得
  let _ogpTimer;
  document.getElementById('ev-link').addEventListener('input', () => {
    clearTimeout(_ogpTimer);
    _ogpTimer = setTimeout(() => {
      if (document.getElementById('ev-is-news').checked) {
        _fetchOGP(document.getElementById('ev-link').value.trim());
      }
    }, 800);
  });

  // 画像追加ボタン
  document.getElementById('ev-images').addEventListener('change', _onImagesSelect);

  // 管理ツールバー（ログイン中のみ表示）
  const importBtn = document.getElementById('import-btn');
  const exportBtn = document.getElementById('export-btn');
  if (importBtn) importBtn.addEventListener('click', () => {
    document.getElementById('import-modal').hidden = false;
  });
  if (exportBtn) exportBtn.addEventListener('click', _exportJSON);

  // インポートモーダル（存在する場合のみ）
  const importModal = document.getElementById('import-modal');
  if (importModal) {
    document.getElementById('import-modal-close')?.addEventListener('click', () => { importModal.hidden = true; });
    importModal.addEventListener('click', e => { if (e.target === e.currentTarget) e.currentTarget.hidden = true; });
    document.getElementById('import-cancel')?.addEventListener('click', () => { importModal.hidden = true; });
    document.getElementById('import-preview-btn')?.addEventListener('click', _previewImport);
    document.getElementById('import-execute-btn')?.addEventListener('click', _executeImport);
  }

  // クリーンアップバナー
  document.getElementById('cleanup-export-btn').addEventListener('click', _exportJSON);
  document.getElementById('cleanup-delete-btn').addEventListener('click', _executeOldDataDelete);
  document.getElementById('cleanup-later-btn').addEventListener('click', () => {
    document.getElementById('cleanup-banner').hidden = true;
  });
}

// ===================================================================
//  UI 更新
// ===================================================================
function _updateAuthUI(loggedIn) {
  document.getElementById('logout-btn').hidden    = !loggedIn;
  document.getElementById('admin-toolbar').hidden = !loggedIn;
}

// ===================================================================
//  パスワードダイアログ
// ===================================================================
let _pwSuccessCallback = null;

function _showPasswordDialog(onSuccess) {
  _pwSuccessCallback = onSuccess;
  document.getElementById('pw-input').value = '';
  document.getElementById('pw-error').hidden = true;
  document.getElementById('password-modal').hidden = false;
  document.body.classList.add('modal-open');
  setTimeout(() => document.getElementById('pw-input').focus(), 100);
}

function _closePwModal() {
  document.getElementById('password-modal').hidden = true;
  document.body.classList.remove('modal-open');
  _pwSuccessCallback = null;
}

async function _onPwSubmit() {
  const pw    = document.getElementById('pw-input').value;
  const errEl = document.getElementById('pw-error');
  const btn   = document.getElementById('pw-submit');

  errEl.hidden = true;
  btn.disabled = true;
  btn.textContent = '確認中…';

  const { error } = await supabaseClient.auth.signInWithPassword({
    email:    ADMIN_EMAIL,
    password: pw,
  });

  btn.disabled = false;
  btn.textContent = 'ログイン';

  if (error) {
    errEl.textContent = 'パスワードが正しくありません';
    errEl.hidden = false;
    document.getElementById('pw-input').value = '';
    document.getElementById('pw-input').focus();
    return;
  }

  _closePwModal();
  showToast('ログインしました', 'success');
  if (_pwSuccessCallback) {
    const cb = _pwSuccessCallback;
    _pwSuccessCallback = null;
    cb();
  }
}

// ===================================================================
//  イベントフォーム
// ===================================================================
function openEventForm(ev = null, defaultDate = null) {
  _editingId  = ev?.id ?? null;
  _imageState = [];

  document.getElementById('event-modal-h').textContent = ev ? 'イベント編集' : 'イベント登録';
  document.getElementById('event-form').reset();
  document.getElementById('event-form-error').hidden = true;

  // 日付（タップした日を自動入力）
  const dateVal = ev?.date ?? defaultDate ?? '';
  document.getElementById('ev-date').value     = dateVal;
  document.getElementById('ev-end-date').value = '';

  const isNews = ev?.is_news || false;

  if (ev) {
    document.getElementById('ev-title').value    = ev.title    || '';
    document.getElementById('ev-end-date').value = ev.end_date || '';
    document.getElementById('ev-comment').value  = ev.comment  || '';
    document.getElementById('ev-link').value     = ev.link     || '';
    document.getElementById('ev-area').value     = ev.area     || '';
    document.getElementById('ev-is-news').checked  = isNews;
    document.getElementById('ev-posted').checked   = ev.posted || false;

    if (isNews) {
      // ニュース: place → 出典媒体名、image_url → サムネイル
      document.getElementById('ev-source').value    = ev.place     || '';
      document.getElementById('ev-thumb-url').value = ev.image_url || '';
      // サムネがなくてリンクがあれば自動取得
      if (!ev.image_url && ev.link) {
        setTimeout(() => _fetchOGP(ev.link), 300);
      }
    } else {
      document.getElementById('ev-place').value = ev.place || '';
      // 既存アップロード画像を imageState に読み込む
      const imgs = ev.images && ev.images.length > 0 ? ev.images : [];
      _imageState = imgs.map(url => ({ url, file: null }));
    }
  }

  _toggleNewsFields();
  _renderImagePreviews();

  document.getElementById('event-modal').hidden = false;
  document.body.classList.add('modal-open');
}

function _toggleNewsFields() {
  const isNews = document.getElementById('ev-is-news').checked;
  document.getElementById('news-fields').hidden        = !isNews;
  document.getElementById('event-place-group').hidden  = isNews;
  document.getElementById('image-upload-area').closest('.form-group').hidden = isNews;
  if (!isNews) {
    document.getElementById('ev-source').value    = '';
    document.getElementById('ev-thumb-url').value = '';
  }
}

function _closeEventModal() {
  document.getElementById('event-modal').hidden = true;
  document.body.classList.remove('modal-open');
  _imageState = [];
  _editingId  = null;
}

// ===================================================================
//  複数画像管理
// ===================================================================
function _onImagesSelect(e) {
  const files = Array.from(e.target.files);
  files.forEach(file => {
    const url = URL.createObjectURL(file);
    _imageState.push({ url, file });
  });
  e.target.value = '';
  _renderImagePreviews();
}

function _renderImagePreviews() {
  const container = document.getElementById('image-previews');
  container.innerHTML = '';

  _imageState.forEach((item, idx) => {
    const wrap = document.createElement('div');
    wrap.className = 'img-preview-item';

    const img = document.createElement('img');
    img.src = item.url;
    img.alt = `画像${idx + 1}`;
    wrap.appendChild(img);

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'img-preview-remove';
    delBtn.setAttribute('aria-label', `画像${idx + 1}を削除`);
    delBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
    delBtn.addEventListener('click', () => {
      _imageState.splice(idx, 1);
      _renderImagePreviews();
    });
    wrap.appendChild(delBtn);
    container.appendChild(wrap);
  });
}

// ===================================================================
//  保存
// ===================================================================
async function _saveEvent(e) {
  e.preventDefault();
  const btn   = document.getElementById('save-event');
  const errEl = document.getElementById('event-form-error');
  btn.disabled    = true;
  btn.textContent = '保存中…';
  errEl.hidden    = true;

  try {
    const title  = document.getElementById('ev-title').value.trim();
    const date   = document.getElementById('ev-date').value;
    const isNews = document.getElementById('ev-is-news').checked;

    if (!title || !date) throw new Error('タイトルと日付は必須です');
    if (!isNews && _imageState.length === 0) throw new Error('画像を1枚以上追加してください');

    // 重複チェック（新規のみ）
    if (!_editingId) {
      const { data: dup } = await supabaseClient
        .from('events')
        .select('id')
        .eq('date', date)
        .eq('title', title)
        .maybeSingle();
      if (dup) throw new Error('同じ日付と同じタイトルのイベントがすでに登録されています');
    }

    let finalUrls = [];
    if (!isNews) {
      // 通常イベント: ファイルをアップロード
      finalUrls = await Promise.all(
        _imageState.map(async item => {
          if (!item.file) return item.url;
          return await _uploadImage(item.file);
        })
      );
    }

    const endDateVal = document.getElementById('ev-end-date').value.trim();
    const payload = {
      title,
      date,
      end_date:  endDateVal || null,
      place:     isNews
        ? (document.getElementById('ev-source').value.trim()    || null)
        : (document.getElementById('ev-place').value.trim()     || null),
      image_url: isNews
        ? (document.getElementById('ev-thumb-url').value.trim() || null)
        : null,
      comment:   document.getElementById('ev-comment').value.trim() || null,
      link:      document.getElementById('ev-link').value.trim()    || null,
      area:      document.getElementById('ev-area').value            || null,
      images:    isNews ? [] : finalUrls,
      is_news:   isNews,
      posted:    document.getElementById('ev-posted').checked,
    };

    const { error } = _editingId
      ? await supabaseClient.from('events').update(payload).eq('id', _editingId)
      : await supabaseClient.from('events').insert(payload);

    if (error) throw error;

    _closeEventModal();
    showToast(_editingId ? 'イベントを更新しました' : 'イベントを登録しました', 'success');
    await refreshAll();

  } catch (err) {
    errEl.textContent = err.message || '保存に失敗しました';
    errEl.hidden = false;
  } finally {
    btn.disabled    = false;
    btn.textContent = '登録する';
  }
}

// ===================================================================
//  OGP自動取得
// ===================================================================
async function _fetchOGP(url) {
  if (!url || !url.startsWith('http')) return;

  const thumbInput   = document.getElementById('ev-thumb-url');
  const titleInput   = document.getElementById('ev-title');
  const commentInput = document.getElementById('ev-comment');

  thumbInput.placeholder = '取得中…';

  try {
    const res  = await fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(url)}`);
    const data = await res.json();
    const html = data.contents || '';

    const getMeta = (prop) => {
      const m = html.match(new RegExp(`<meta[^>]*property=["']${prop}["'][^>]*content=["']([^"']+)["']`, 'i'))
             || html.match(new RegExp(`<meta[^>]*content=["']([^"']+)["'][^>]*property=["']${prop}["']`, 'i'));
      return m ? m[1] : null;
    };

    const img   = getMeta('og:image');
    const title = getMeta('og:title');
    const desc  = getMeta('og:description');

    if (img)   thumbInput.value = img;
    if (title && !titleInput.value)   titleInput.value   = title;
    if (desc  && !commentInput.value) commentInput.value = desc;

  } catch (err) {
    console.warn('OGP fetch error:', err);
  } finally {
    thumbInput.placeholder = '記事のOGP画像URL（https://...）';
  }
}

// ===================================================================
//  削除
// ===================================================================
async function deleteEvent(id) {
  const ev = allEvents.find(e => e.id === id);
  if (!ev) return;

  // 画像を Storage から削除
  const imgs = getImages(ev);
  for (const url of imgs) {
    const filename = _getStorageFilename(url);
    if (filename) {
      await supabaseClient.storage.from('event-images').remove([filename]);
    }
  }

  const { error } = await supabaseClient.from('events').delete().eq('id', id);
  if (error) { showToast('削除に失敗しました', 'error'); return; }

  showToast('イベントを削除しました', 'info');
  await refreshAll();
}

// ===================================================================
//  掲載済みトグル
// ===================================================================
async function togglePosted(id, posted) {
  const { error } = await supabaseClient.from('events').update({ posted }).eq('id', id);
  if (error) { showToast('更新に失敗しました', 'error'); return; }

  const ev = allEvents.find(e => e.id === id);
  if (ev) ev.posted = posted;
  showToast(posted ? 'ストーリー掲載済みにしました' : '掲載済みを解除しました', 'success');
}

// ===================================================================
//  画像ユーティリティ
// ===================================================================
async function _compressImage(file, maxWidth = 1200) {
  return new Promise(resolve => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      let { width: w, height: h } = img;
      if (w > maxWidth) { h = Math.round(h * maxWidth / w); w = maxWidth; }
      const canvas = document.createElement('canvas');
      canvas.width  = w;
      canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      canvas.toBlob(resolve, 'image/jpeg', 0.85);
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
    img.src = url;
  });
}

async function _uploadImage(file) {
  const blob     = await _compressImage(file);
  const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;

  const { error: upErr } = await supabaseClient.storage
    .from('event-images')
    .upload(filename, blob, { contentType: 'image/jpeg', upsert: false });
  if (upErr) throw upErr;

  const { data: { publicUrl } } = supabaseClient.storage
    .from('event-images')
    .getPublicUrl(filename);
  return publicUrl;
}

function _getStorageFilename(url) {
  try {
    const marker = '/event-images/';
    const idx = url.indexOf(marker);
    if (idx === -1) return null;
    // クエリ文字列を除去
    return url.slice(idx + marker.length).split('?')[0];
  } catch {
    return null;
  }
}

// ===================================================================
//  古いデータの自動削除チェック
// ===================================================================
let _oldEventsToDelete = [];

async function checkAndDeleteOldData() {
  const now       = new Date();
  const thisMonth = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-01`;

  const { data, error } = await supabaseClient
    .from('events')
    .select('*')
    .lt('date', thisMonth);

  if (error || !data || data.length === 0) return;

  _oldEventsToDelete = data;
  document.getElementById('cleanup-count').textContent = data.length;
  document.getElementById('cleanup-banner').hidden = false;
}

async function _executeOldDataDelete() {
  if (_oldEventsToDelete.length === 0) return;

  const btn = document.getElementById('cleanup-delete-btn');
  btn.disabled = true;
  btn.textContent = '削除中…';

  let deleted = 0;
  for (const ev of _oldEventsToDelete) {
    const imgs = getImages(ev);
    for (const url of imgs) {
      const filename = _getStorageFilename(url);
      if (filename) {
        await supabaseClient.storage.from('event-images').remove([filename]);
      }
    }
    const { error } = await supabaseClient.from('events').delete().eq('id', ev.id);
    if (!error) deleted++;
  }

  btn.disabled = false;
  btn.textContent = '画像ごと削除';

  document.getElementById('cleanup-banner').hidden = true;
  _oldEventsToDelete = [];
  showToast(`${deleted} 件の古いデータを削除しました`, 'info');
  await refreshAll();
}

// ===================================================================
//  JSON インポート（ec_data_v3 + 新形式 両対応）
// ===================================================================
function _previewImport() {
  const text    = document.getElementById('import-json').value.trim();
  const errEl   = document.getElementById('import-error');
  const prevEl  = document.getElementById('import-preview-area');
  const execBtn = document.getElementById('import-execute-btn');


  errEl.hidden  = true;
  prevEl.hidden = true;
  execBtn.hidden = true;
  _importData = null;

  let json;
  try { json = JSON.parse(text); }
  catch {
    errEl.textContent = 'JSONの形式が正しくありません。';
    errEl.hidden = false;
    return;
  }

  const entries = _convertJSON(json);
  if (entries.length === 0) {
    errEl.textContent = '取り込めるデータが見つかりませんでした。形式を確認してください。';
    errEl.hidden = false;
    return;
  }

  _importData = entries;
  const preview = entries.slice(0, 10).map(e => `<li>${e.date}：${e.title}</li>`).join('');
  const more    = entries.length > 10 ? `<li>…他 ${entries.length - 10} 件</li>` : '';
  prevEl.innerHTML = `<p><strong>${entries.length} 件</strong>を取り込みます。</p>
    <ul style="margin-top:8px;padding-left:16px;list-style:disc;">${preview}${more}</ul>`;
  prevEl.hidden  = false;
  execBtn.hidden = false;
}

function _convertJSON(json) {
  const entries = [];

  if (Array.isArray(json)) {
    // 新形式: イベントオブジェクトの配列
    for (const ev of json) {
      if (!ev.title || !ev.date) continue;
      entries.push({
        title:   ev.title,
        date:    ev.date,
        place:   ev.place   || null,
        comment: ev.comment || ev.description || null,
        link:    ev.link    || null,
        area:    ev.area    || null,
        images:  Array.isArray(ev.images) ? ev.images : (ev.image_url ? [ev.image_url] : []),
        is_news: ev.is_news  || false,
        posted:  ev.posted   || false,
      });
    }
  } else if (typeof json === 'object' && json !== null) {
    // ec_data_v3 形式: {"YYYY-MM-DD": [{title, caption, link, images:[{src}]}]}
    for (const [dateStr, evs] of Object.entries(json)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) continue;
      if (!Array.isArray(evs)) continue;
      for (const ev of evs) {
        if (!ev.title) continue;
        const imgs = Array.isArray(ev.images)
          ? ev.images.map(i => (typeof i === 'string' ? i : i?.src)).filter(Boolean)
          : [];
        entries.push({
          title:   ev.title,
          date:    dateStr,
          place:   ev.place   || null,
          comment: ev.caption || ev.comment || null,
          link:    ev.link    || null,
          area:    null,
          images:  imgs,
          is_news: false,
          posted:  false,
        });
      }
    }
  }

  return entries.sort((a, b) => a.date.localeCompare(b.date));
}

async function _executeImport() {
  if (!_importData?.length) return;

  const btn   = document.getElementById('import-execute-btn');
  const count = _importData.length;
  btn.disabled    = true;
  btn.textContent = 'インポート中…';

  // ON CONFLICT (date, title) DO NOTHING で重複をスキップ
  const { error } = await supabaseClient.from('events').upsert(
    _importData,
    { onConflict: 'date,title', ignoreDuplicates: true }
  );

  btn.disabled    = false;
  btn.textContent = 'インポート実行';

  if (error) {
    document.getElementById('import-error').textContent = 'インポートに失敗しました: ' + error.message;
    document.getElementById('import-error').hidden = false;
    return;
  }

  document.getElementById('import-modal').hidden = true;
  document.getElementById('import-json').value = '';
  _importData = null;
  showToast(`${count} 件をインポートしました`, 'success');
  await refreshAll();
}

// ===================================================================
//  JSON エクスポート
// ===================================================================
function _exportJSON() {
  const data = allEvents.map(ev => {
    const obj = { ...ev };
    delete obj.created_at;
    return obj;
  });

  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `masuda-calendar-${formatDate(new Date())}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('JSONをエクスポートしました', 'success');
}
