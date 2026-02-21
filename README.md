# 東日本大震災「減災リポート」アーカイブ

東日本大震災翌日までの、ウェザーニューズ会員による「減災リポート」のデジタルアーカイブです。
- [https://311report.mapping.jp/](https://311report.mapping.jp/) で公開中です。
- 9780件の「減災リポート」を、位置情報をある程度ずらした上でマッピングしています。
- このコンテンツは、2012年に開催された「[東日本大震災ビッグデータワークショップ](https://sites.google.com/site/prj311/)」の成果物をCesiumに移植したものです。
- [東京大学大学院 渡邉英徳研究室](https://labo.wtnv.jp/)が作成・運営しています。

## コード構成

`tweetMapping` リポジトリの構成を参考に、以下の構成へ改修しています。
- `index.html`: UIとエントリポイントのみ
- `js/app-config.js`: APIキー、視点、データURLなどの設定
- `js/analytics.js`: Google Analytics 初期化
- `js/main.js`: Mapbox初期化、標準クラスタリング、検索、ポップアップ表示

## 改修・利用

- ソースコードはコメントを参考に改修の上、自由に利用できます。
- お問い合わせは hwtnv(at)iii.u-tokyo.ac.jp までお願いします。

## GeoJSON生成

元データ `data/czml/weathernews.json`（配列形式）を、Mapboxが直接読めるGeoJSONへ変換します。

```bash
node tools/build-report-geojson.js
```

生成先:
- `data/czml/weathernews.geojson`
