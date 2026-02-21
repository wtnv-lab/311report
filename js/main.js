(function () {
  const appConfig = window.APP_CONFIG || {};
  const mapboxAccessToken = appConfig.mapboxAccessToken || "";
  const mapboxStyleStreets = appConfig.mapboxStyleStreets || "mapbox/streets-v12";
  const reportGeoJsonUrl = appConfig.reportGeoJsonUrl || "data/czml/weathernews.geojson";
  const aboutUrl = appConfig.githubUrl || "https://github.com/wtnv-lab/311report/";

  const mapContainerId = "cesiumContainer";
  const REPORT_SOURCE_ID = "report-source";
  const CLUSTER_GLOW_LAYER_ID = "report-cluster-glow";
  const CLUSTER_CIRCLE_LAYER_ID = "report-cluster-circles";
  const CLUSTER_LABEL_LAYER_ID = "report-cluster-labels";
  const POINT_GLOW_LAYER_ID = "report-point-glow";
  const POINT_LAYER_ID = "report-point-circles";
  const POINT_LABEL_LAYER_ID = "report-point-labels";

  const blackOutDiv = document.getElementById("blackOut");
  const loadingDiv = document.getElementById("twCounter");
  const reportMessageDiv = document.getElementById("tweetMessage");
  const visibleSummaryDiv = document.getElementById("visibleSummary");
  const visibleSummaryStatusDiv = document.getElementById("visibleSummaryStatus");
  const visibleSummaryTextDiv = document.getElementById("visibleSummaryText");
  const visibleSummaryOpenButton = document.getElementById("visibleSummaryOpen");
  const visibleSummaryCloseButton = document.getElementById("visibleSummaryClose");
  const titleScreenDiv = document.querySelector(".titleScreen");
  const SUMMARY_MIN_ZOOM = 10;
  const SUMMARY_MAX_REPORTS = 100;
  const SUMMARY_CACHE_PREFIX = "visible-summary-v1:";
  const SUMMARY_CACHE_TTL_MS = 10 * 60 * 1000;
  const SUMMARY_CACHE_MAX = 200;

  let map = null;
  let pointPopup = null;
  let mapReady = false;
  let layersReady = false;
  let isLoadingInitialData = true;
  let reportGeoJsonAll = createEmptyFeatureCollection();
  let reportGeoJsonFiltered = createEmptyFeatureCollection();
  let currentSearchQuery = "";
  let summaryDebounceTimer = null;
  let summaryLastFeatureHash = "";
  let summaryAbortController = null;
  let summaryCache = new Map();
  let summaryInFlight = new Map();
  let summaryPanelExpanded = false;

  function fadeInOut(layer, show) {
    if (!layer) {
      return;
    }
    if (show) {
      $(layer).fadeIn("slow");
    } else {
      $(layer).fadeOut("slow");
    }
  }

  function hideReportMessage() {
    if (!reportMessageDiv) {
      return;
    }
    reportMessageDiv.classList.remove("mobileInfoBox");
    reportMessageDiv.innerHTML = "";
    $(reportMessageDiv).hide();
  }

  function hideTitleScreen() {
    if (!titleScreenDiv) {
      return;
    }
    setTimeout(function () {
      $(titleScreenDiv).fadeOut(1200, function () {
        $(titleScreenDiv).remove();
      });
    }, 1200);
  }

  function getDevice() {
    const ua = navigator.userAgent;
    if (ua.indexOf("iPhone") > 0 || ua.indexOf("iPod") > 0 || (ua.indexOf("Android") > 0 && ua.indexOf("Mobile") > 0)) {
      return 1;
    }
    if (ua.indexOf("iPad") > 0 || ua.indexOf("Android") > 0) {
      return 2;
    }
    return 0;
  }

  function resizeWindow() {
    const container = document.getElementById(mapContainerId);
    if (!container) {
      return;
    }
    $(container).css("height", "100%");
    $(container).css("width", "100%");
    $(blackOutDiv).css("height", "100%");
    $(blackOutDiv).css("width", "100%");
    setTimeout(initMapbox, 50);
  }

  function createEmptyFeatureCollection() {
    return {
      type: "FeatureCollection",
      features: [],
    };
  }

  function normalizeSearchText(value) {
    return String(value || "").toLowerCase();
  }

  function offsetLonLatByMeters(lon, lat, meters, angleRad) {
    const metersPerDegLat = 111320.0;
    const cosLat = Math.cos((lat * Math.PI) / 180.0);
    const safeCos = Math.max(0.1, Math.abs(cosLat));
    const dLat = (meters * Math.sin(angleRad)) / metersPerDegLat;
    const dLon = (meters * Math.cos(angleRad)) / (metersPerDegLat * safeCos);
    return {
      lon: lon + dLon,
      lat: lat + dLat,
    };
  }

  function applyDuplicatePointOffset(lon, lat, indexAtSamePoint) {
    if (indexAtSamePoint <= 0) {
      return { lon: lon, lat: lat };
    }
    const perRing = 8;
    const ring = Math.floor((indexAtSamePoint - 1) / perRing) + 1;
    const slot = (indexAtSamePoint - 1) % perRing;
    const angle = ((Math.PI * 2) / perRing) * slot;
    const meters = 18 * ring;
    return offsetLonLatByMeters(lon, lat, meters, angle);
  }

  function stripHtmlTags(value) {
    return String(value || "")
      .replace(/<[^>]*>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/\s+/g, " ")
      .trim();
  }

  function setVisibleSummary(statusText, bodyText) {
    if (!visibleSummaryDiv) {
      return;
    }
    if (visibleSummaryStatusDiv) {
      visibleSummaryStatusDiv.textContent = statusText || "";
    }
    if (visibleSummaryTextDiv) {
      visibleSummaryTextDiv.textContent = bodyText || "";
    }
  }

  function setVisibleSummaryVisibility(visible) {
    if (!visibleSummaryDiv) {
      return;
    }
    visibleSummaryDiv.classList.toggle("isOpen", !!visible);
  }

  function setSummaryOpenButtonVisibility(visible) {
    if (!visibleSummaryOpenButton) {
      return;
    }
    visibleSummaryOpenButton.classList.toggle("isHidden", !visible);
  }

  function isSummaryUiAvailable() {
    const isSmartphone = getDevice() === 1 || window.matchMedia("(max-width: 768px)").matches;
    if (isSmartphone) {
      return false;
    }
    if (!map || !mapReady || !layersReady) {
      return false;
    }
    return map.getZoom() >= SUMMARY_MIN_ZOOM;
  }

  function applySummaryPanelState() {
    if (!isSummaryUiAvailable()) {
      setVisibleSummaryVisibility(false);
      setSummaryOpenButtonVisibility(false);
      return;
    }
    if (summaryPanelExpanded) {
      setVisibleSummaryVisibility(true);
      setSummaryOpenButtonVisibility(false);
      return;
    }
    setVisibleSummaryVisibility(false);
    setSummaryOpenButtonVisibility(true);
  }

  function getVisibleReportsForSummary() {
    if (!map) {
      return [];
    }
    const canvas = map.getCanvas();
    if (!canvas) {
      return [];
    }

    const features = map.queryRenderedFeatures(
      [
        [0, 0],
        [canvas.width, canvas.height],
      ],
      { layers: [POINT_LAYER_ID, POINT_LABEL_LAYER_ID] }
    );
    const dedup = new Map();

    for (let i = 0; i < features.length; i++) {
      const props = (features[i] && features[i].properties) || {};
      const id = String(props.id || "");
      if (!id || dedup.has(id)) {
        continue;
      }
      dedup.set(id, {
        id: id,
        label: String(props.label || ""),
        desc: stripHtmlTags(props.desc || "").slice(0, 280),
      });
    }

    return Array.from(dedup.values());
  }

  function hashSummaryReports(reports) {
    const ids = [];
    for (let i = 0; i < reports.length; i++) {
      ids.push(reports[i].id);
    }
    ids.sort();
    return ids.join("|");
  }

  function getSummaryCacheKey(reports) {
    const zoomBucket = Math.floor((map ? map.getZoom() : 0) * 2) / 2;
    return "z" + zoomBucket.toFixed(1) + "|" + hashSummaryReports(reports);
  }

  function pruneSummaryCache() {
    const now = Date.now();
    const keys = Array.from(summaryCache.keys());
    for (let i = 0; i < keys.length; i++) {
      const entry = summaryCache.get(keys[i]);
      if (!entry || entry.expiresAt <= now) {
        summaryCache.delete(keys[i]);
      }
    }
    if (summaryCache.size <= SUMMARY_CACHE_MAX) {
      return;
    }
    const entries = Array.from(summaryCache.entries()).sort(function (a, b) {
      return (a[1].usedAt || 0) - (b[1].usedAt || 0);
    });
    while (entries.length && summaryCache.size > SUMMARY_CACHE_MAX) {
      const oldest = entries.shift();
      if (oldest) {
        summaryCache.delete(oldest[0]);
      }
    }
  }

  function getCachedSummary(cacheKey) {
    const now = Date.now();
    const memory = summaryCache.get(cacheKey);
    if (memory && memory.expiresAt > now && memory.summary) {
      memory.usedAt = now;
      return memory.summary;
    }
    summaryCache.delete(cacheKey);

    try {
      const raw = window.localStorage.getItem(SUMMARY_CACHE_PREFIX + cacheKey);
      if (!raw) {
        return "";
      }
      const parsed = JSON.parse(raw);
      if (!parsed || parsed.expiresAt <= now || !parsed.summary) {
        window.localStorage.removeItem(SUMMARY_CACHE_PREFIX + cacheKey);
        return "";
      }
      summaryCache.set(cacheKey, {
        summary: parsed.summary,
        expiresAt: parsed.expiresAt,
        usedAt: now,
      });
      pruneSummaryCache();
      return parsed.summary;
    } catch (err) {
      return "";
    }
  }

  function setCachedSummary(cacheKey, summaryText) {
    const now = Date.now();
    const entry = {
      summary: summaryText,
      expiresAt: now + SUMMARY_CACHE_TTL_MS,
      usedAt: now,
    };
    summaryCache.set(cacheKey, entry);
    pruneSummaryCache();
    try {
      window.localStorage.setItem(
        SUMMARY_CACHE_PREFIX + cacheKey,
        JSON.stringify({
          summary: summaryText,
          expiresAt: entry.expiresAt,
        })
      );
    } catch (err) {
      // localStorage is optional; continue with memory cache only.
    }
  }

  function requestVisibleSummary(force) {
    if (!map || !mapReady || !layersReady) {
      return;
    }

    if (!isSummaryUiAvailable()) {
      applySummaryPanelState();
      summaryLastFeatureHash = "";
      if (summaryAbortController) {
        summaryAbortController.abort();
        summaryAbortController = null;
      }
      return;
    }
    applySummaryPanelState();
    if (!summaryPanelExpanded) {
      return;
    }

    const reports = getVisibleReportsForSummary();
    if (!reports.length) {
      summaryLastFeatureHash = "";
      setVisibleSummary("AIで要約: 0件", "表示中のリポートがありません。");
      return;
    }
    if (reports.length > SUMMARY_MAX_REPORTS) {
      summaryLastFeatureHash = "";
      setVisibleSummary(
        "AIで要約: " + reports.length + "件",
        "要約は100件以下で実行します。地図を拡大して件数を減らしてください。"
      );
      return;
    }

    const hash = getSummaryCacheKey(reports);
    if (!force && hash === summaryLastFeatureHash) {
      return;
    }
    summaryLastFeatureHash = hash;

    const cachedSummary = getCachedSummary(hash);
    if (cachedSummary) {
      setVisibleSummary("AIで要約: " + reports.length + "件（キャッシュ）", cachedSummary);
      return;
    }

    const inflight = summaryInFlight.get(hash);
    if (inflight) {
      inflight
        .then(function (summaryText) {
          setVisibleSummary("AIで要約: " + reports.length + "件", summaryText);
        })
        .catch(function () {
          setVisibleSummary(
            "AIで要約: エラー",
            "要約APIに接続できません。`node tools/summary-server.js` を起動して再試行してください。"
          );
        });
      return;
    }

    if (summaryAbortController) {
      summaryAbortController.abort();
      summaryAbortController = null;
    }
    summaryAbortController = new AbortController();
    setVisibleSummary("AIで要約: 生成中 (" + reports.length + "件)", "要約を作成しています...");

    const pending = fetch("/api/summarize-visible", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: summaryAbortController.signal,
      body: JSON.stringify({
        reports: reports,
        zoom: map.getZoom(),
      }),
    })
      .then(function (res) {
        if (!res.ok) {
          return res.json().catch(function () {
            return {};
          }).then(function (err) {
            throw new Error(err.error || "summary request failed");
          });
        }
        return res.json();
      })
      .then(function (payload) {
        const summaryText = String((payload && payload.summary) || "").trim();
        if (!summaryText) {
          throw new Error("summary is empty");
        }
        setCachedSummary(hash, summaryText);
        return summaryText;
      })
      .catch(function (err) {
        if (err && err.name === "AbortError") {
          return "";
        }
        throw err;
      })
      .finally(function () {
        if (summaryInFlight.get(hash)) {
          summaryInFlight.delete(hash);
        }
      });
    summaryInFlight.set(hash, pending);

    pending
      .then(function (summaryText) {
        if (!summaryText) {
          return;
        }
        setVisibleSummary("AIで要約: " + reports.length + "件", summaryText);
      })
      .catch(function () {
        setVisibleSummary(
          "AIで要約: エラー",
          "要約APIに接続できません。`node tools/summary-server.js` を起動して再試行してください。"
        );
      });
  }

  function scheduleVisibleSummary(force) {
    if (summaryDebounceTimer) {
      clearTimeout(summaryDebounceTimer);
    }
    summaryDebounceTimer = setTimeout(function () {
      requestVisibleSummary(force);
    }, force ? 50 : 650);
  }

  function buildPointLabel(rawDesc) {
    const source = stripHtmlTags(rawDesc);
    if (!source) {
      return "";
    }
    const maxChars = 16;
    return source.length > maxChars ? source.slice(0, maxChars) + "..." : source;
  }

  function sanitizeGeoJson(data) {
    const sourceFeatures = data && Array.isArray(data.features) ? data.features : [];
    const features = [];
    const samePointCounts = new Map();

    for (let i = 0; i < sourceFeatures.length; i++) {
      const f = sourceFeatures[i] || {};
      const geometry = f.geometry || {};
      const coords = Array.isArray(geometry.coordinates) ? geometry.coordinates : [];
      const lon = Number(coords[0]);
      const lat = Number(coords[1]);
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
        continue;
      }
      const pointKey = lon.toFixed(6) + "," + lat.toFixed(6);
      const indexAtSamePoint = samePointCounts.get(pointKey) || 0;
      samePointCounts.set(pointKey, indexAtSamePoint + 1);
      const shifted = applyDuplicatePointOffset(lon, lat, indexAtSamePoint);

      const props = f.properties || {};
      const id = String(props.id || "weathernews" + i);
      const label = buildPointLabel(props.desc || props.text || "");
      const desc = String(props.desc || props.text || '<p class="tweettext">本文がありません。</p>');
      const searchText = normalizeSearchText(props.searchText || label + " " + desc);

      features.push({
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: [shifted.lon, shifted.lat],
        },
        properties: {
          id: id,
          label: label,
          desc: desc,
          searchText: searchText,
        },
      });
    }

    return {
      type: "FeatureCollection",
      features: features,
    };
  }

  function ensureDataLayers() {
    if (!map || !map.isStyleLoaded()) {
      return;
    }

    if (!map.getSource(REPORT_SOURCE_ID)) {
      map.addSource(REPORT_SOURCE_ID, {
        type: "geojson",
        data: reportGeoJsonFiltered,
        cluster: true,
        clusterMinPoints: 5,
        clusterRadius: 50,
        clusterMaxZoom: 13,
      });
    }

    if (!map.getLayer(CLUSTER_GLOW_LAYER_ID)) {
      map.addLayer({
        id: CLUSTER_GLOW_LAYER_ID,
        type: "circle",
        source: REPORT_SOURCE_ID,
        filter: ["has", "point_count"],
        paint: {
          "circle-color": "#ff9800",
          "circle-opacity": 0.28,
          "circle-blur": 0.92,
          "circle-radius": [
            "step",
            ["get", "point_count"],
            22,
            20,
            30,
            100,
            40,
            500,
            52,
          ],
        },
      });
    }

    if (!map.getLayer(CLUSTER_CIRCLE_LAYER_ID)) {
      map.addLayer({
        id: CLUSTER_CIRCLE_LAYER_ID,
        type: "circle",
        source: REPORT_SOURCE_ID,
        filter: ["has", "point_count"],
        paint: {
          "circle-color": [
            "step",
            ["get", "point_count"],
            "#ffd180",
            20,
            "#ffb74d",
            100,
            "#fb8c00",
            500,
            "#ef6c00",
          ],
          "circle-stroke-color": "#f57c00",
          "circle-stroke-width": 1,
          "circle-opacity": 0.88,
          "circle-radius": [
            "step",
            ["get", "point_count"],
            13,
            20,
            18,
            100,
            24,
            500,
            30,
          ],
        },
      });
    }

    if (!map.getLayer(CLUSTER_LABEL_LAYER_ID)) {
      map.addLayer({
        id: CLUSTER_LABEL_LAYER_ID,
        type: "symbol",
        source: REPORT_SOURCE_ID,
        filter: ["has", "point_count"],
        layout: {
          "text-field": ["get", "point_count_abbreviated"],
          "text-size": 13,
          "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
          "text-allow-overlap": true,
        },
        paint: {
          "text-color": "#ffffff",
          "text-halo-color": "rgba(0,0,0,0.7)",
          "text-halo-width": 1.2,
        },
      });
    }

    if (!map.getLayer(POINT_LAYER_ID)) {
      if (!map.getLayer(POINT_GLOW_LAYER_ID)) {
        map.addLayer({
          id: POINT_GLOW_LAYER_ID,
          type: "circle",
          source: REPORT_SOURCE_ID,
          filter: ["!", ["has", "point_count"]],
          paint: {
            "circle-color": "#ff9800",
            "circle-opacity": 0.34,
            "circle-radius": 11,
            "circle-blur": 0.9,
          },
        });
      }

      map.addLayer({
        id: POINT_LAYER_ID,
        type: "circle",
        source: REPORT_SOURCE_ID,
        filter: ["!", ["has", "point_count"]],
        paint: {
          "circle-color": "#ff9800",
          "circle-stroke-color": "#ff8f00",
          "circle-stroke-width": 1,
          "circle-opacity": 0.9,
          "circle-radius": 4,
        },
      });
    }
    if (!map.getLayer(POINT_LABEL_LAYER_ID)) {
      map.addLayer({
        id: POINT_LABEL_LAYER_ID,
        type: "symbol",
        source: REPORT_SOURCE_ID,
        filter: ["!", ["has", "point_count"]],
        minzoom: 8,
        layout: {
          "text-field": ["coalesce", ["get", "label"], ""],
          "text-size": 11,
          "text-font": ["Open Sans Regular", "Arial Unicode MS Regular"],
          "text-offset": [0, -1.1],
          "text-anchor": "bottom",
          "text-allow-overlap": false,
        },
        paint: {
          "text-color": "#fff3e0",
          "text-halo-color": "rgba(0,0,0,0.8)",
          "text-halo-width": 1.2,
        },
      });
    }

    if (!layersReady) {
      map.on("mouseenter", POINT_LAYER_ID, function () {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", POINT_LAYER_ID, function () {
        map.getCanvas().style.cursor = "";
      });
      map.on("mouseenter", POINT_LABEL_LAYER_ID, function () {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", POINT_LABEL_LAYER_ID, function () {
        map.getCanvas().style.cursor = "";
      });
      map.on("mouseenter", CLUSTER_CIRCLE_LAYER_ID, function () {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", CLUSTER_CIRCLE_LAYER_ID, function () {
        map.getCanvas().style.cursor = "";
      });
      map.on("click", POINT_LAYER_ID, onPointClick);
      map.on("click", POINT_LABEL_LAYER_ID, onPointClick);
      map.on("click", CLUSTER_CIRCLE_LAYER_ID, onClusterClick);
      map.on("click", function (e) {
        const hit = map.queryRenderedFeatures(e.point, {
          layers: [POINT_LAYER_ID, POINT_LABEL_LAYER_ID, CLUSTER_CIRCLE_LAYER_ID],
        });
        if (hit && hit.length) {
          return;
        }
        if (pointPopup) {
          pointPopup.remove();
          pointPopup = null;
        }
        hideReportMessage();
      });
      layersReady = true;
    }
  }

  function updateLoadingLabel() {
    if (!loadingDiv) {
      return;
    }
    const count = reportGeoJsonFiltered && Array.isArray(reportGeoJsonFiltered.features) ? reportGeoJsonFiltered.features.length : 0;
    loadingDiv.innerHTML = "<p>" + count + " markers</p>";
  }

  function setReportSourceData(featureCollection) {
    reportGeoJsonFiltered = featureCollection || createEmptyFeatureCollection();
    if (map && map.getSource(REPORT_SOURCE_ID)) {
      map.getSource(REPORT_SOURCE_ID).setData(reportGeoJsonFiltered);
    }
    updateLoadingLabel();
    scheduleVisibleSummary(false);
  }

  function buildFilteredFeatureCollection(queryLower) {
    if (!queryLower) {
      return reportGeoJsonAll;
    }

    const src = reportGeoJsonAll && Array.isArray(reportGeoJsonAll.features) ? reportGeoJsonAll.features : [];
    const features = [];
    for (let i = 0; i < src.length; i++) {
      const feature = src[i];
      const props = (feature && feature.properties) || {};
      const searchText = normalizeSearchText(props.searchText || props.label || "");
      if (searchText.indexOf(queryLower) !== -1) {
        features.push(feature);
      }
    }

    return {
      type: "FeatureCollection",
      features: features,
    };
  }

  function applyTextFilter(rawQuery) {
    currentSearchQuery = normalizeSearchText(String(rawQuery || "").trim());
    const filtered = buildFilteredFeatureCollection(currentSearchQuery);
    setReportSourceData(filtered);
  }

  function loadReportGeoJson() {
    return Promise.resolve($.getJSON(reportGeoJsonUrl))
      .then(function (data) {
        reportGeoJsonAll = sanitizeGeoJson(data);
        applyTextFilter(currentSearchQuery);
      })
      .catch(function () {
        reportGeoJsonAll = createEmptyFeatureCollection();
        applyTextFilter("");
      })
      .finally(function () {
        if (isLoadingInitialData) {
          isLoadingInitialData = false;
          hideTitleScreen();
          fadeInOut(blackOutDiv, 0);
          fadeInOut(loadingDiv, 0);
        }
      });
  }

  function initMapbox() {
    if (mapReady) {
      return;
    }
    if (!window.mapboxgl) {
      alert("Mapbox GL JSの読み込みに失敗しました。");
      return;
    }
    if (!mapboxAccessToken) {
      alert("Mapboxアクセストークンが未設定です。");
      return;
    }

    mapboxgl.accessToken = mapboxAccessToken;
    map = new mapboxgl.Map({
      container: mapContainerId,
      style: "mapbox://styles/" + mapboxStyleStreets,
      center: [138.5, 36.0],
      zoom: 4.2,
      minZoom: 4,
      maxZoom: 18,
      attributionControl: true,
      pitchWithRotate: false,
      dragRotate: false,
      touchZoomRotate: true,
      antialias: false,
    });

    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "bottom-right");

    map.on("load", function () {
      mapReady = true;
      ensureDataLayers();
      map.fitBounds(
        [
          [122.0, 20.0],
          [154.0, 47.0],
        ],
        { padding: 20, duration: 0 }
      );

      fadeInOut(blackOutDiv, 1);
      fadeInOut(loadingDiv, 1);

      loadReportGeoJson();
    });

    map.on("moveend", function () {
      scheduleVisibleSummary(false);
    });

    map.on("style.load", function () {
      ensureDataLayers();
      if (mapReady) {
        setReportSourceData(reportGeoJsonFiltered);
      }
      scheduleVisibleSummary(true);
    });
  }

  function onClusterClick(e) {
    if (!e || !e.features || !e.features.length || !map) {
      return;
    }
    if (e.originalEvent) {
      if (typeof e.originalEvent.stopPropagation === "function") {
        e.originalEvent.stopPropagation();
      }
      e.originalEvent.cancelBubble = true;
    }

    const feature = e.features[0];
    const clusterId = feature && feature.properties ? feature.properties.cluster_id : null;
    if (clusterId === null || clusterId === undefined) {
      return;
    }

    const source = map.getSource(REPORT_SOURCE_ID);
    if (!source || typeof source.getClusterExpansionZoom !== "function") {
      return;
    }

    source.getClusterExpansionZoom(clusterId, function (err, zoom) {
      if (err) {
        return;
      }
      map.easeTo({
        center: feature.geometry.coordinates,
        zoom: zoom,
        duration: 350,
      });
    });
  }

  function onPointClick(e) {
    if (!e || !e.features || !e.features.length) {
      return;
    }
    if (e.originalEvent) {
      if (typeof e.originalEvent.stopPropagation === "function") {
        e.originalEvent.stopPropagation();
      }
      e.originalEvent.cancelBubble = true;
    }

    const feature = e.features[0];
    const html = String((feature.properties && feature.properties.desc) || "本文がありません。");
    if (pointPopup) {
      pointPopup.remove();
      pointPopup = null;
    }

    const isMobileLayout = getDevice() === 1 || window.matchMedia("(max-width: 768px)").matches;
    if (isMobileLayout && reportMessageDiv) {
      reportMessageDiv.innerHTML =
        '<button type="button" class="mobileInfoClose" aria-label="閉じる">×</button><div class="mobileInfoBody">' +
        html +
        "</div>";
      reportMessageDiv.classList.add("mobileInfoBox");
      $(reportMessageDiv).show();
      const closeButton = reportMessageDiv.querySelector(".mobileInfoClose");
      if (closeButton) {
        closeButton.addEventListener("click", function () {
          hideReportMessage();
        });
      }
      return;
    }

    const viewportWidth = Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0);
    const isNarrowViewport = viewportWidth <= 768;
    const horizontalMargin = isNarrowViewport ? 16 : 24;
    const popupMaxWidth = isNarrowViewport
      ? Math.max(220, viewportWidth - horizontalMargin * 2)
      : 340;

    pointPopup = new mapboxgl.Popup({
      closeButton: true,
      closeOnClick: false,
      maxWidth: popupMaxWidth + "px",
    })
      .setLngLat(feature.geometry.coordinates)
      .setHTML(html)
      .addTo(map);
  }

  function geocode() {
    if (!map) {
      return;
    }
    const input = String(document.getElementById("inputtext").value || "").trim();
    if (!input) {
      return;
    }
    if (!mapboxAccessToken) {
      alert("地名検索のトークンが未設定です。");
      return;
    }

    const url =
      "https://api.mapbox.com/geocoding/v5/mapbox.places/" +
      encodeURIComponent(input) +
      ".json?access_token=" +
      encodeURIComponent(mapboxAccessToken) +
      "&language=ja&limit=1";

    fetch(url)
      .then(function (res) {
        if (!res.ok) {
          throw new Error("geocode request failed");
        }
        return res.json();
      })
      .then(function (data) {
        const features = (data && data.features) || [];
        if (!features.length) {
          alert("見つかりません");
          return;
        }
        const f = features[0];
        const bbox = f.bbox;
        if (Array.isArray(bbox) && bbox.length === 4) {
          map.fitBounds(
            [
              [Number(bbox[0]), Number(bbox[1])],
              [Number(bbox[2]), Number(bbox[3])],
            ],
            { padding: 24, duration: 500 }
          );
          return;
        }
        const center = Array.isArray(f.center) ? f.center : null;
        if (center && Number.isFinite(Number(center[0])) && Number.isFinite(Number(center[1]))) {
          map.flyTo({
            center: [Number(center[0]), Number(center[1])],
            zoom: Math.max(map.getZoom(), 11),
            speed: 1.0,
            curve: 1.2,
          });
          return;
        }
        alert("見つかりません");
      })
      .catch(function () {
        alert("地名検索に失敗しました。");
      });
  }

  function flyToMyLocation() {
    if (!navigator.geolocation || !map) {
      return;
    }
    navigator.geolocation.getCurrentPosition(
      function (pos) {
        map.flyTo({
          center: [pos.coords.longitude, pos.coords.latitude],
          zoom: Math.max(map.getZoom(), 13),
          speed: 1.0,
          curve: 1.2,
        });
      },
      function () {
        alert("現在地を取得できませんでした。");
      }
    );
  }

  function textSearch() {
    hideReportMessage();
    const q = document.getElementById("searchQuery").value;
    applyTextFilter(q);
  }

  function about() {
    window.open(aboutUrl, "_blank");
  }

  function bindUiEvents() {
    const geocodeForm = document.getElementById("geocodeForm");
    const textSearchForm = document.getElementById("textSearchForm");
    const aboutButton = document.getElementById("buttonAbout");
    const geoButton = document.getElementById("buttonGeo");

    if (geocodeForm) {
      geocodeForm.addEventListener("submit", function (e) {
        e.preventDefault();
        geocode();
      });
    }

    if (textSearchForm) {
      textSearchForm.addEventListener("submit", function (e) {
        e.preventDefault();
        textSearch();
      });
    }

    if (aboutButton) {
      aboutButton.addEventListener("click", about);
    }

    if (geoButton) {
      geoButton.addEventListener("click", flyToMyLocation);
    }

    if (visibleSummaryOpenButton) {
      visibleSummaryOpenButton.addEventListener("click", function () {
        summaryPanelExpanded = true;
        applySummaryPanelState();
        scheduleVisibleSummary(true);
      });
    }

    if (visibleSummaryCloseButton) {
      visibleSummaryCloseButton.addEventListener("click", function () {
        summaryPanelExpanded = false;
        applySummaryPanelState();
        if (summaryAbortController) {
          summaryAbortController.abort();
          summaryAbortController = null;
        }
      });
    }
  }

  bindUiEvents();
  setVisibleSummaryVisibility(false);
  setSummaryOpenButtonVisibility(false);
  applySummaryPanelState();

  (function screenAdjust() {
    if (getDevice() !== 1) {
      setTimeout(resizeWindow, 0);
      return;
    }
    $(".titleImage").css("width", "64%");
    setTimeout(resizeWindow, 500);
  })();

  $(window).on("resize", function () {
    applySummaryPanelState();
    if (map) {
      map.resize();
    }
  });

  window.geocode = geocode;
  window.flyToMyLocation = flyToMyLocation;
  window.textSearch = textSearch;
  window.about = about;
})();
