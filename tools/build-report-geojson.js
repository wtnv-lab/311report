#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
const sourcePath = path.join(repoRoot, "data", "czml", "weathernews.json");
const outputPath = path.join(repoRoot, "data", "czml", "weathernews.geojson");

function stripHtml(value) {
  return String(value || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function run() {
  const raw = fs.readFileSync(sourcePath, "utf8");
  const items = JSON.parse(raw);
  if (!Array.isArray(items)) {
    throw new Error("Expected weathernews.json to be an array");
  }

  const features = [];

  for (let i = 0; i < items.length; i++) {
    const row = items[i] || {};
    const cartographic = row.position && row.position.cartographicDegrees;
    const lon = Number(Array.isArray(cartographic) ? cartographic[0] : NaN);
    const lat = Number(Array.isArray(cartographic) ? cartographic[1] : NaN);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
      continue;
    }

    const id = String(row.id || `weathernews${i}`);
    const label = String(row.name || "");
    const desc = String(row.text || '<p class="tweettext">本文がありません。</p>');
    const searchText = stripHtml(label + " " + desc).toLowerCase();

    features.push({
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [lon, lat],
      },
      properties: {
        id,
        label,
        desc,
        searchText,
      },
    });
  }

  const geojson = {
    type: "FeatureCollection",
    metadata: {
      source: path.relative(repoRoot, sourcePath),
      generatedAt: new Date().toISOString(),
      totalFeatures: features.length,
    },
    features,
  };

  fs.writeFileSync(outputPath, JSON.stringify(geojson));
  console.log(`Wrote ${features.length} features to ${path.relative(repoRoot, outputPath)}`);
}

run();
