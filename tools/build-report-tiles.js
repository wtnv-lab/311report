#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
const sourcePath = path.join(repoRoot, "data", "czml", "weathernews.json");
const outputRoot = path.join(repoRoot, "data", "czml", "weathernews-tiles");
const tilesDir = path.join(outputRoot, "tiles");
const zoomLevel = 9;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function lonLatToTileXY(lon, lat, z) {
  const latClamped = clamp(lat, -85.05112878, 85.05112878);
  const n = Math.pow(2, z);
  const x = Math.floor(((lon + 180) / 360) * n);
  const latRad = (latClamped * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n);
  return {
    x: clamp(x, 0, n - 1),
    y: clamp(y, 0, n - 1),
  };
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function cleanDirFiles(dirPath) {
  if (!fs.existsSync(dirPath)) {
    return;
  }
  const names = fs.readdirSync(dirPath);
  for (const name of names) {
    const targetPath = path.join(dirPath, name);
    const stat = fs.statSync(targetPath);
    if (stat.isFile()) {
      fs.unlinkSync(targetPath);
    }
  }
}

function stripTags(html) {
  return String(html || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildLongName(reportName, plainText) {
  const fromName = String(reportName || "").trim();
  const fromText = String(plainText || "").trim();
  const fromNameLooksTruncated = fromName.endsWith("...") || fromName.endsWith("…");
  const base = !fromName || fromNameLooksTruncated ? fromText : fromName;
  if (!base) {
    return "No Text";
  }
  const limit = 80;
  return base.length > limit ? base.slice(0, limit) + "..." : base;
}

function buildLabelText(text, fallbackName) {
  const base = String(text || fallbackName || "No Text").trim();
  const limit = 40;
  return base.length > limit ? base.slice(0, limit) + "..." : base;
}

function main() {
  const raw = fs.readFileSync(sourcePath, "utf8");
  const reports = JSON.parse(raw);

  ensureDir(outputRoot);
  ensureDir(tilesDir);
  cleanDirFiles(tilesDir);

  const tileBuckets = new Map();
  const searchReports = [];
  let totalValid = 0;

  for (let i = 0; i < reports.length; i++) {
    const report = reports[i];
    const coords = report && report.position && report.position.cartographicDegrees;
    if (!Array.isArray(coords) || coords.length < 2) {
      continue;
    }

    const lon = Number(coords[0]);
    const lat = Number(coords[1]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
      continue;
    }

    const tile = lonLatToTileXY(lon, lat, zoomLevel);
    const key = `${zoomLevel}/${tile.x}/${tile.y}`;
    const plainText = stripTags(report.text || "");

    const longName = buildLongName(report.name, plainText);
    const compactReport = {
      id: String(report.id || `weathernews${i}`),
      name: longName,
      text: plainText,
      label: buildLabelText(plainText, longName),
      desc: String(report.text || ""),
      lon: lon,
      lat: lat,
      img: String(report.iconUrl || "megaphone.png"),
    };

    searchReports.push({
      id: compactReport.id,
      text: `${compactReport.name} ${compactReport.text}`.trim(),
      tile: key,
    });

    const target = tileBuckets.get(key);
    if (target) {
      target.push(compactReport);
    } else {
      tileBuckets.set(key, [compactReport]);
    }

    totalValid++;
  }

  const index = {
    version: 1,
    generatedAt: new Date().toISOString(),
    zoom: zoomLevel,
    totalTweets: totalValid,
    tiles: {},
  };

  for (const [tileKey, items] of tileBuckets.entries()) {
    const relativePath = `tiles/${tileKey.replace(/\//g, "_")}.json`;
    const outputPath = path.join(outputRoot, relativePath);

    fs.writeFileSync(
      outputPath,
      JSON.stringify({
        version: 1,
        tile: tileKey,
        count: items.length,
        reports: items,
      })
    );

    index.tiles[tileKey] = {
      path: relativePath,
      count: items.length,
    };
  }

  fs.writeFileSync(path.join(outputRoot, "index.json"), JSON.stringify(index));
  fs.writeFileSync(
    path.join(outputRoot, "search.json"),
    JSON.stringify({
      version: 1,
      generatedAt: index.generatedAt,
      totalTweets: searchReports.length,
      tweets: searchReports,
    })
  );

  console.log(`Generated ${Object.keys(index.tiles).length} tiles for ${totalValid} reports at z=${zoomLevel}`);
}

main();
