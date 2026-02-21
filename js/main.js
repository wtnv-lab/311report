(function () {
  const appConfig = window.APP_CONFIG || {};
  const googleMapsApiKey = appConfig.googleMapsApiKey || "";
  const mapboxAccessToken = appConfig.mapboxAccessToken || "";
  const mapboxStyleStreets = appConfig.mapboxStyleStreets || "mapbox/streets-v12";
  const reportGeoJsonUrl = appConfig.reportGeoJsonUrl || appConfig.dataUrl || "data/czml/weathernews.geojson";
  const aboutUrl = appConfig.githubUrl || "https://github.com/wtnv-lab/311report/";

  const mapContainerId = "cesiumContainer";
  const REPORT_SOURCE_ID = "report-source";
  const CLUSTER_CIRCLE_LAYER_ID = "report-cluster-circles";
  const CLUSTER_LABEL_LAYER_ID = "report-cluster-labels";
  const POINT_LAYER_ID = "report-point-circles";

  const blackOutDiv = document.getElementById("blackOut");
  const loadingDiv = document.getElementById("twCounter");
  const reportMessageDiv = document.getElementById("tweetMessage");

  let map = null;
  let mapReady = false;
  let layersReady = false;
  let isLoadingInitialData = true;
  let reportGeoJsonAll = createEmptyFeatureCollection();
  let reportGeoJsonFiltered = createEmptyFeatureCollection();
  let currentSearchQuery = "";

  if (googleMapsApiKey) {
    const googleMapsScript = document.createElement("script");
    googleMapsScript.src =
      "https://maps.googleapis.com/maps/api/js?key=" +
      googleMapsApiKey +
      "&callback=initMap&loading=async";
    googleMapsScript.async = true;
    googleMapsScript.defer = true;
    window.initMap = function () {};
    document.head.appendChild(googleMapsScript);
  }

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

  function sanitizeGeoJson(data) {
    const sourceFeatures = data && Array.isArray(data.features) ? data.features : [];
    const features = [];

    for (let i = 0; i < sourceFeatures.length; i++) {
      const f = sourceFeatures[i] || {};
      const geometry = f.geometry || {};
      const coords = Array.isArray(geometry.coordinates) ? geometry.coordinates : [];
      const lon = Number(coords[0]);
      const lat = Number(coords[1]);
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
        continue;
      }

      const props = f.properties || {};
      const id = String(props.id || "weathernews" + i);
      const label = String(props.label || props.name || "");
      const desc = String(props.desc || props.text || '<p class="tweettext">本文がありません。</p>');
      const searchText = normalizeSearchText(props.searchText || label + " " + desc);

      features.push({
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: [lon, lat],
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
        clusterRadius: 50,
        clusterMaxZoom: 13,
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

    if (!layersReady) {
      map.on("mouseenter", POINT_LAYER_ID, function () {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", POINT_LAYER_ID, function () {
        map.getCanvas().style.cursor = "";
      });
      map.on("mouseenter", CLUSTER_CIRCLE_LAYER_ID, function () {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", CLUSTER_CIRCLE_LAYER_ID, function () {
        map.getCanvas().style.cursor = "";
      });
      map.on("click", POINT_LAYER_ID, onPointClick);
      map.on("click", CLUSTER_CIRCLE_LAYER_ID, onClusterClick);
      map.on("click", function () {
        $(reportMessageDiv).hide();
      });
      layersReady = true;
    }
  }

  function updateLoadingLabel() {
    const count = reportGeoJsonFiltered && Array.isArray(reportGeoJsonFiltered.features) ? reportGeoJsonFiltered.features.length : 0;
    loadingDiv.innerHTML = "<p>" + count + " markers</p>";
  }

  function setReportSourceData(featureCollection) {
    reportGeoJsonFiltered = featureCollection || createEmptyFeatureCollection();
    if (map && map.getSource(REPORT_SOURCE_ID)) {
      map.getSource(REPORT_SOURCE_ID).setData(reportGeoJsonFiltered);
    }
    updateLoadingLabel();
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

      $(".titleScreen").remove();
      fadeInOut(blackOutDiv, 1);
      fadeInOut(loadingDiv, 1);

      loadReportGeoJson();
    });

    map.on("style.load", function () {
      ensureDataLayers();
      if (mapReady) {
        setReportSourceData(reportGeoJsonFiltered);
      }
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
    $(reportMessageDiv).html(html).fadeIn(120);

    const p = e.point || { x: 0, y: 0 };
    const w = $(window).width();
    if (w - p.x < 340) {
      $(reportMessageDiv).css({ left: p.x - 320, top: p.y + 8 });
    } else {
      $(reportMessageDiv).css({ left: p.x + 8, top: p.y + 8 });
    }
  }

  function geocode() {
    if (!window.google || !google.maps || !google.maps.Geocoder) {
      alert("地名検索の初期化に失敗しました。");
      return;
    }
    const geocoder = new google.maps.Geocoder();
    const input = document.getElementById("inputtext").value;
    geocoder.geocode({ address: input }, function (results, status) {
      if (status !== "OK" || !results || !results[0]) {
        alert("見つかりません");
        return;
      }
      const vp = results[0].geometry.viewport;
      const sw = vp.getSouthWest();
      const ne = vp.getNorthEast();
      map.fitBounds(
        [
          [sw.lng(), sw.lat()],
          [ne.lng(), ne.lat()],
        ],
        { padding: 24, duration: 500 }
      );
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
    $(reportMessageDiv).hide();
    const q = document.getElementById("searchQuery").value;
    applyTextFilter(q);
  }

  function about() {
    window.open(aboutUrl, "_blank");
  }

  (function screenAdjust() {
    if (getDevice() !== 1) {
      setTimeout(resizeWindow, 0);
      return;
    }
    $(".titleImage").css("width", "100%");
    setTimeout(resizeWindow, 500);
  })();

  $(window).on("resize", function () {
    if (map) {
      map.resize();
    }
  });

  window.geocode = geocode;
  window.flyToMyLocation = flyToMyLocation;
  window.textSearch = textSearch;
  window.about = about;
})();
