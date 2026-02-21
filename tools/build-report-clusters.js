#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
const sourcePath = path.join(repoRoot, "data", "czml", "weathernews.json");
const outputRoot = path.join(repoRoot, "data", "czml", "weathernews-clusters");
const zoomLevels = [4, 5, 6, 7, 8, 9, 10, 11, 12];

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function lonLatToTileXY(lon, lat, z) {
  const latClamped = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const n = Math.pow(2, z);
  const x = Math.floor(((lon + 180) / 360) * n);
  const latRad = (latClamped * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n);
  return {
    x: Math.max(0, Math.min(n - 1, x)),
    y: Math.max(0, Math.min(n - 1, y)),
  };
}

function buildClustersForZoom(reports, zoom) {
  const buckets = new Map();

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

    const tile = lonLatToTileXY(lon, lat, zoom);
    const key = `${zoom}/${tile.x}/${tile.y}`;
    const current = buckets.get(key);
    if (current) {
      current.count += 1;
      current.lonSum += lon;
      current.latSum += lat;
    } else {
      buckets.set(key, {
        key,
        count: 1,
        lonSum: lon,
        latSum: lat,
      });
    }
  }

  const clusters = [];
  for (const b of buckets.values()) {
    clusters.push({
      id: `cluster-${b.key}`,
      tile: b.key,
      count: b.count,
      lon: b.lonSum / b.count,
      lat: b.latSum / b.count,
    });
  }

  clusters.sort((a, b) => b.count - a.count);
  return clusters;
}

function main() {
  const reports = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
  ensureDir(outputRoot);

  const levels = [];
  for (const zoom of zoomLevels) {
    const clusters = buildClustersForZoom(reports, zoom);
    const file = `clusters-z${zoom}.json`;
    fs.writeFileSync(
      path.join(outputRoot, file),
      JSON.stringify(
        {
          version: 1,
          generatedAt: new Date().toISOString(),
          zoom,
          clusterCount: clusters.length,
          totalReports: reports.length,
          clusters,
        },
        null,
        0
      )
    );
    levels.push({ zoom, file, clusterCount: clusters.length });
  }

  fs.writeFileSync(
    path.join(outputRoot, "index.json"),
    JSON.stringify(
      {
        version: 1,
        generatedAt: new Date().toISOString(),
        totalReports: reports.length,
        levels,
      },
      null,
      0
    )
  );

  console.log(`Generated precomputed clusters for zooms: ${zoomLevels.join(", ")}`);
}

main();
