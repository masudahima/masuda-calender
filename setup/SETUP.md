# 益田市イベントカレンダー — セットアップ手順

## 必要なもの（すべて無料）

- GitHub アカウント（コード保管 + GitHub Pages 公開）
- Supabase アカウント https://supabase.com（DB + 画像保存 + 認証）

---

## ステップ 1: Supabase プロジェクト作成

1. https://supabase.com にアクセスし、ログイン
2. **New project** をクリック
3. プロジェクト名を入力（例: `masuda-calendar`）
4. データベースのパスワードを設定（メモしておく）
5. リージョンは **Northeast Asia (Tokyo)** を選択
6. **Create new project** をクリック（2〜3分かかります）

---

## ステップ 2: データベース（テーブル）作成

1. 左メニューの **SQL Editor** を開く
2. `schema.sql` の内容をすべてコピーして貼り付け
3. **Run** ボタンを押して実行
4. 「Success. No rows returned」と表示されれば成功

---

## ステップ 3: ストレージバケット作成

1. 左メニューの **Storage** を開く
2. **New bucket** をクリック
3. Bucket name: `event-images`（そのまま）
4. **Public bucket** のチェックを **ON** にする
5. **Create bucket** をクリック
6. ここで `schema.sql` の末尾にある Storage ポリシーの SQL を **SQL Editor** で実行する

---

## ステップ 4: 管理者ユーザー作成

1. 左メニューの **Authentication** を開く
2. **Add user** > **Create new user** をクリック
3. メールアドレスとパスワードを入力
   - **パスワードはここだけで設定します。コード内には書きません。**
   - メールアドレスは後で `config.js` に設定します
4. **Create user** をクリック

---

## ステップ 5: API キーと管理者メールを config.js に設定

1. Supabase 左メニューの **Settings** > **API** を開く
2. **Project URL** と **anon（public）** キーをコピー
   - ⚠️ `service_role` キーは絶対にコピーしない
3. `js/config.js` をテキストエディタで開き、3つの値を設定する

```js
const SUPABASE_URL      = 'https://xxxx.supabase.co';   // ← Project URL
const SUPABASE_ANON_KEY = 'eyJhbGc...';                 // ← anon (public) キー
const ADMIN_EMAIL       = 'you@example.com';            // ← ステップ4で登録したメール
```

> **注意:** パスワードはここには書きません。Supabase Authentication で管理されます。

---

## ステップ 6: GitHub リポジトリ作成 & GitHub Pages 公開

1. https://github.com/new にアクセスし、新しいリポジトリを作成
   - 名前: `masuda-calendar`（任意）
   - **Public**（GitHub Pages 無料枠の条件）
2. ローカルのファイル一式（`masuda-calendar/` の中身）をアップロード
   - GitHub 画面で **uploading an existing file** をクリック → ドラッグ&ドロップ
   - または Git を使う場合: `git init` → `git add .` → `git commit` → `git push`
3. リポジトリの **Settings** > **Pages** を開く
4. Source: **Deploy from a branch** → Branch: **main** → Folder: **/ (root)**
5. **Save** をクリック
6. 数分後に `https://ユーザー名.github.io/masuda-calendar/` で公開される

---

## ステップ 7: Notion への埋め込み

1. 公開された URL をコピー
2. Notion のページを開き、`/embed` と入力
3. URL を貼り付けて **Embed link** をクリック
4. ブロックの高さを調整（800〜1000px 推奨）

---

## ステップ 8: 既存データ（ec_data_v3）の移行

このサイトは2種類のJSON形式を取り込めます。

**形式1（ec_data_v3）:**
```json
{
  "2026-10-29": [
    {"title": "...", "caption": "...", "link": "...", "images": [{"src": "..."}]}
  ]
}
```

**形式2（新形式・イベント配列）:**
```json
[
  {"title": "...", "date": "2026-10-29", "place": "...", "comment": "...", "images": [...]}
]
```

インポート手順:
1. サイトにアクセスし、「イベント登録」からログイン
2. 管理ツールバーの「JSONインポート」をクリック
3. JSON テキストを貼り付けて「プレビュー確認」→「インポート実行」

---

## データ項目（決定版）

| フィールド | 型 | 説明 |
|-----------|-----|------|
| `title` | text（必須） | イベントタイトル |
| `date` | date（必須） | 開催日 |
| `place` | text | 会場・場所 |
| `area` | text | 市街地 / 美都 / 匹見 / 津和野 / その他 |
| `comment` | text | 説明・コメント |
| `link` | text | 関連URL |
| `images` | text[] | 画像URLの配列（複数可） |
| `is_news` | boolean | true = ニュース扱い |
| `posted` | boolean | true = ストーリー掲載済み |

> `area = '津和野'` のニュースは「津和野町のニュース」欄に表示されます。

---

## 注意事項（Supabase 無料プラン）

| 制限 | 内容 |
|------|------|
| **一時停止** | **1週間アクセスがないとプロジェクトが停止**します |
| 停止した場合 | Supabase ダッシュボードから **Restore project** を押して再開 |
| DB 容量 | 500MB（イベント情報のみなら数年は余裕） |
| 画像容量 | 1GB（1枚 300KB × 約3,000枚分） |
| 転送量 | 5GB/月（小規模地域カレンダーなら十分） |
| プロジェクト数 | 最大2つ |

> 停止を防ぐには、週1回以上サイトを開くだけで OK です。

---

## ファイル構成

```
masuda-calendar/
├── index.html          メインページ（カレンダー + リスト + 管理画面）
├── css/
│   └── style.css       スタイルシート
├── js/
│   ├── config.js       ★ Supabase の URL・API キー・管理者メールを設定
│   ├── app.js          カレンダー・リスト・モーダルのロジック
│   └── admin.js        認証・CRUD・画像アップロード・インポート/エクスポート
└── setup/
    ├── schema.sql      データベース・RLS・Storage のセットアップ SQL
    └── SETUP.md        このファイル
```
