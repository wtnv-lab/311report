# 東日本大震災「減災リポート」アーカイブ

東日本大震災翌日までの、ウェザーニューズ会員による「減災リポート」を地図上で閲覧できるアーカイブです。  
公開サイト: [https://311report.mapping.jp/](https://311report.mapping.jp/)

## 現在の実装仕様

- フロントエンドは **Mapbox GL JS (v2)** ベースです
- データは `data/czml/weathernews.geojson` を読み込みます
- ポイントはクライアント側でクラスタリング表示します
- タイトル画面（ロゴ + ローディング表示）を初期表示し、データ読込完了後にフェードアウトします
- 機能
  - 地名検索（Mapbox Geocoding API）
  - テキスト検索（リポート本文ベース）
  - 現在地へ移動
  - ポップアップで本文表示

## ディレクトリ構成

- `index.html`: エントリポイント（最小のDOM構造）
- `css/style.css`: 画面全体スタイル、タイトル画面、地図UI調整
- `css/menubutton.css`: ボタンとアイコンフォント用スタイル
- `js/app-config.js`: APIキー・スタイルID・データURLなどの設定
- `js/main.js`: アプリ本体（地図初期化、データ読込、検索、UIイベント）
- `js/analytics.js`: Google Analytics 初期化
- `data/czml/weathernews.json`: 元データ（配列形式）
- `data/czml/weathernews.geojson`: 表示用GeoJSON
- `tools/`: データ変換・補助データ生成スクリプト

## 設定

設定値は `js/app-config.js` で管理しています。

主な項目:
- `mapboxAccessToken`
- `mapboxStyleStreets`
- `reportGeoJsonUrl`
- `analyticsTrackingId`

## ローカル実行

静的ファイルとして配信してください（`file://` 直開きは非推奨）。

例:

```bash
cd /Users/wtnv/Repositories/311report
python3 -m http.server 8080
```

ブラウザで `http://localhost:8080` を開きます。

## データ生成

### 1. GeoJSON生成（通常はこちらを使用）

`weathernews.json` から表示用 `weathernews.geojson` を生成します。

```bash
node tools/build-report-geojson.js
```

出力先:
- `data/czml/weathernews.geojson`

### 2. タイル分割データ生成（任意）

検索や分割配信向けの補助データを生成します。

```bash
node tools/build-report-tiles.js
```

出力先:
- `data/czml/weathernews-tiles/`

### 3. 事前クラスターデータ生成（任意）

ズーム別の事前クラスターデータを生成します。

```bash
node tools/build-report-clusters.js
```

出力先:
- `data/czml/weathernews-clusters/`

## 補足

- 現在の実行系は `weathernews.geojson` を直接読む構成で、`weathernews-tiles` / `weathernews-clusters` は補助生成物です。
- お問い合わせ: hwtnv(at)iii.u-tokyo.ac.jp
