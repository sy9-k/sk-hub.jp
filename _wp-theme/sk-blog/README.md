# SK Blog（WordPress テーマ）

SK のサイトの上のバー・SK Hub Support の記事ページを基にした、ブログ用のクラシックテーマ。

## 入れ方
1. このフォルダ `sk-blog` を zip にする（`sk-blog.zip`）。
2. WordPress 管理画面 → 外観 → テーマ → 新規追加 → テーマのアップロード。
3. 有効化したら、外観 → メニュー で「ヘッダーのメニュー」「フッターのリンク」を設定（未設定でもカテゴリーが自動で並ぶ）。
4. 外観 → カスタマイズ → SK Blog で、テーマカラー（SK's Blue / Sakura / Matcha / Mikan / Fuji / Sora / Sumi）・トップの小見出し・説明文を変更。

## 中身
- `header.php` / `footer.php` — 固定すりガラスのバー（スマホはロゴ＋メニューのボタン）、サポートと同じフッター
- `index.php` — トップ・カテゴリー・タグ・検索の一覧（検索ボックス＋カテゴリータイル＋カード）
- `single.php` — 記事（右に同じカテゴリーの記事、前後の記事、コメント）
- `page.php` / `404.php` / `comments.php` / `searchform.php`
- `assets/css/main.css` — SK のトークン（色・ダークモード・テーマカラー）と全部の見た目
- `assets/js/main.js` — スマホのメニューとライト・ダーク切替（SK のサイトと同じ `sk_theme` に保存）
