(function () {
  const appConfig = window.APP_CONFIG || {};
  const googleMapsApiKey = appConfig.googleMapsApiKey || "";
  const cesiumIonToken = appConfig.cesiumIonToken || "";
  const mapTilerTerrainKey = appConfig.mapTilerTerrainKey || "";
  const viewPointsArray = appConfig.viewPoints || [
    { label: "日本全国", lat: 34.00934, lng: 135.843524, heading: -47, pitch: -50, range: 2000000 },
    { label: "初期視点", lat: 37.81995, lng: 141.101672, heading: -27, pitch: -40, range: 240000 },
  ];
  const legacyReportJsonUrl = appConfig.dataUrl || "data/czml/weathernews.json";
  const reportTileIndexUrl = appConfig.tileIndexUrl || "data/czml/weathernews-tiles/index.json";
  const reportSearchIndexUrl = appConfig.tileSearchUrl || "data/czml/weathernews-tiles/search.json";
  const reportTileBaseUrl = reportTileIndexUrl.slice(0, reportTileIndexUrl.lastIndexOf("/") + 1);
  const aboutUrl = appConfig.githubUrl || "https://github.com/wtnv-lab/311report/";

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

  if (cesiumIonToken) {
    Cesium.Ion.defaultAccessToken = cesiumIonToken;
  }

  const cesiumContainerDiv = document.getElementById("cesiumContainer");
  const blackOutDiv = document.getElementById("blackOut");
  const loadingDiv = document.getElementById("twCounter");
  const reportMessageDiv = document.getElementById("tweetMessage");

  let viewer;
  let scene;
  let shinsai2011Photo;
  let reportBillboards;
  let reportLabels;

  const reportTextById = new Map();
  const reportDescriptionById = new Map();
  const renderedReportById = new Map();
  const loadedTileKeys = new Set();
  const loadingTileKeys = new Set();
  const tileReportIds = new Map();

  let reportTileIndex = null;
  let visibleFilterIds = null;
  let cullingEnabled = false;
  let cullTimer = null;
  let tileLoadTimer = null;
  let isInitialTilesLoaded = false;

  const isSmartphone = detectSmartphoneContext();
  const cullMarginPx = 32;
  const tileLoadDebounceMs = 120;
  const tilePrefetchMargin = 1;
  const scratchToObject = new Cesium.Cartesian3();
  const scratchWindow = new Cesium.Cartesian2();
  const translucencyByDistanceBillboard = new Cesium.NearFarScalar(500.0, 1.0, 500000, 0.5);
  const translucencyByDistanceLabel = new Cesium.NearFarScalar(100.0, 1.0, 100000, 0.2);
  const projectToWindowCoordinates =
    (typeof Cesium.SceneTransforms.wgs84ToWindowCoordinates === "function" &&
      Cesium.SceneTransforms.wgs84ToWindowCoordinates.bind(Cesium.SceneTransforms)) ||
    (typeof Cesium.SceneTransforms.worldToWindowCoordinates === "function" &&
      Cesium.SceneTransforms.worldToWindowCoordinates.bind(Cesium.SceneTransforms)) ||
    null;

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

  function detectSmartphoneContext() {
    const ua = navigator.userAgent || "";
    const uaMobile = /iPhone|iPod|Android.*Mobile|Windows Phone|BlackBerry|webOS|Opera Mini/i.test(ua);

    const shortEdge = Math.min(window.screen.width || 0, window.screen.height || 0);
    const longEdge = Math.max(window.screen.width || 0, window.screen.height || 0);
    const smartphoneScreen = shortEdge > 0 && shortEdge <= 480 && longEdge <= 932;

    const compactViewport = Math.min(window.innerWidth || 0, window.innerHeight || 0) <= 480;
    const coarsePointer =
      typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
    const touchDevice = (navigator.maxTouchPoints || 0) > 0;

    if (getDevice() === 1) {
      return true;
    }
    if (uaMobile) {
      return true;
    }
    if (touchDevice && coarsePointer && (smartphoneScreen || compactViewport)) {
      return true;
    }
    return false;
  }

  function resizeWindow() {
    $(cesiumContainerDiv).css("height", "100%");
    $(cesiumContainerDiv).css("width", "100%");
    $(blackOutDiv).css("height", "100%");
    $(blackOutDiv).css("width", "100%");
    setTimeout(loadCesium, 100);
  }

  (function screenAdjust() {
    if (!isSmartphone) {
      setTimeout(resizeWindow, 0);
      return;
    }
    $(".titleImage").css("width", "100%");
    setTimeout(resizeWindow, 1000);
  })();

  function baseLayerPickerAdd() {
    const layers = viewer.imageryLayers;
    const imageryViewModels = [];

    const satelliteMap = new Cesium.ArcGisMapServerImageryProvider({
      url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer",
      enablePickFeatures: false,
    });

    const roadMap = new Cesium.OpenStreetMapImageryProvider({
      url: "https://cyberjapandata.gsi.go.jp/xyz/pale/",
      credit: "国土地理院",
      minimumLevel: 5,
      maximumLevel: 18,
    });

    const terrainMap = new Cesium.OpenStreetMapImageryProvider({
      url: "https://cyberjapandata.gsi.go.jp/xyz/relief/",
      credit: "国土地理院",
      minimumLevel: 5,
      maximumLevel: 15,
    });

    imageryViewModels.push(
      new Cesium.ProviderViewModel({
        name: "航空写真",
        iconUrl: Cesium.buildModuleUrl("Widgets/Images/ImageryProviders/bingAerial.png"),
        creationFunction: function () {
          setTimeout(function () {
            const layer = layers.get(0);
            if (layer) {
              layer.brightness = 0.5;
              layer.saturation = 1.0;
            }
            if (shinsai2011Photo) {
              shinsai2011Photo.alpha = 1;
            }
          }, 10);
          return satelliteMap;
        },
      })
    );

    imageryViewModels.push(
      new Cesium.ProviderViewModel({
        name: "詳細地図",
        iconUrl: Cesium.buildModuleUrl("Widgets/Images/ImageryProviders/gsiGray.png"),
        creationFunction: function () {
          setTimeout(function () {
            const layer = layers.get(0);
            if (layer) {
              layer.brightness = 0.3;
              layer.saturation = 0.2;
            }
            if (shinsai2011Photo) {
              shinsai2011Photo.alpha = 0;
            }
          }, 10);
          return roadMap;
        },
      })
    );

    imageryViewModels.push(
      new Cesium.ProviderViewModel({
        name: "標高地図",
        iconUrl: Cesium.buildModuleUrl("Widgets/Images/ImageryProviders/japanRelief.png"),
        tooltip: "海域部は海上保安庁海洋情報部の資料を使用して作成",
        creationFunction: function () {
          setTimeout(function () {
            const layer = layers.get(0);
            if (layer) {
              layer.brightness = 0.4;
              layer.saturation = 1.0;
            }
            if (shinsai2011Photo) {
              shinsai2011Photo.alpha = 0;
            }
          }, 10);
          return terrainMap;
        },
      })
    );

    new Cesium.BaseLayerPicker("baseLayerPickerContainer", {
      globe: viewer.scene.globe,
      imageryProviderViewModels: imageryViewModels,
    });

    shinsai2011Photo = layers.addImageryProvider(
      new Cesium.OpenStreetMapImageryProvider({
        url: "https://cyberjapandata.gsi.go.jp/xyz/toho1/",
        fileExtension: "jpg",
        credit: "国土地理院",
        maximumLevel: 17,
      })
    );
    shinsai2011Photo.brightness = 0.5;
  }

  function loadCesium() {
    const viewerOptions = {
      navigationHelpButton: false,
      navigationInstructionsInitiallyVisible: false,
      geocoder: false,
      timeline: false,
      animation: false,
      sceneModePicker: false,
      baseLayerPicker: false,
      requestRenderMode: true,
      maximumRenderTimeChange: Infinity,
      useBrowserRecommendedResolution: true,
    };

    if (mapTilerTerrainKey) {
      viewerOptions.terrainProvider = new Cesium.CesiumTerrainProvider({
        url: "https://api.maptiler.com/tiles/terrain-quantized-mesh/?key=" + mapTilerTerrainKey,
        requestVertexNormals: false,
        requestWaterMask: false,
      });
    }

    viewer = new Cesium.Viewer(cesiumContainerDiv, viewerOptions);
    scene = viewer.scene;

    baseLayerPickerAdd();
    viewer.screenSpaceEventHandler.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
    viewer.camera.frustum.fov = Cesium.Math.toRadians(60);
    scene.globe.maximumScreenSpaceError = 3;

    const cesiumDiv = document.getElementById("cesiumContainer");
    function preventScroll(event) {
      event.preventDefault();
    }
    cesiumDiv.addEventListener("gesturestart", preventScroll, false);
    cesiumDiv.addEventListener("gesturechange", preventScroll, false);
    cesiumDiv.addEventListener("gestureend", preventScroll, false);

    openingSequence();
  }

  function openingSequence() {
    fadeInOut(blackOutDiv, 0);
    fadeInOut(loadingDiv, 0);

    Promise.resolve()
      .then(function () {
        return new Promise(function (resolve) {
          setTimeout(function () {
            $(".titleScreen").fadeOut(1000);
            setTimeout(function () {
              $(".titleScreen").remove();
            }, 1000);
            changeViewPoint(0, 3);
            resolve();
          }, 2000);
        });
      })
      .then(function () {
        return new Promise(function (resolve) {
          setTimeout(function () {
            fadeInOut(blackOutDiv, 1);
            fadeInOut(loadingDiv, 1);
            resolve();
          }, 4000);
        });
      })
      .then(function () {
        return new Promise(function (resolve) {
          setTimeout(function () {
            loadReports();
            resolve();
          }, 1000);
        });
      });
  }

  function stripTags(html) {
    return String(html || "")
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function lonLatToTileXY(lon, lat, z) {
    const latClamped = Math.max(-85.05112878, Math.min(85.05112878, lat));
    const n = Math.pow(2, z);
    const x = Math.floor(((lon + 180.0) / 360.0) * n);
    const latRad = Cesium.Math.toRadians(latClamped);
    const y = Math.floor(((1.0 - Math.log(Math.tan(latRad) + 1.0 / Math.cos(latRad)) / Math.PI) / 2.0) * n);
    return {
      x: Math.max(0, Math.min(n - 1, x)),
      y: Math.max(0, Math.min(n - 1, y)),
    };
  }

  function buildVisibleTileKeySet() {
    const tileKeys = new Set();
    if (!reportTileIndex) {
      return tileKeys;
    }

    const rectangle = viewer.camera.computeViewRectangle(viewer.scene.globe.ellipsoid);
    if (!rectangle) {
      return tileKeys;
    }

    const zoom = reportTileIndex.zoom;
    const westDeg = Cesium.Math.toDegrees(rectangle.west);
    const eastDeg = Cesium.Math.toDegrees(rectangle.east);
    const southDeg = Cesium.Math.toDegrees(rectangle.south);
    const northDeg = Cesium.Math.toDegrees(rectangle.north);
    const lonSegments = westDeg <= eastDeg ? [[westDeg, eastDeg]] : [[westDeg, 180.0], [-180.0, eastDeg]];

    for (let i = 0; i < lonSegments.length; i++) {
      const segment = lonSegments[i];
      const min = lonLatToTileXY(segment[0], northDeg, zoom);
      const max = lonLatToTileXY(segment[1], southDeg, zoom);
      const minX = Math.min(min.x, max.x) - tilePrefetchMargin;
      const maxX = Math.max(min.x, max.x) + tilePrefetchMargin;
      const minY = Math.min(min.y, max.y) - tilePrefetchMargin;
      const maxY = Math.max(min.y, max.y) + tilePrefetchMargin;
      const tileCount = Math.pow(2, zoom);

      for (let x = minX; x <= maxX; x++) {
        for (let y = minY; y <= maxY; y++) {
          if (x < 0 || y < 0 || y >= tileCount || x >= tileCount) {
            continue;
          }
          const tileKey = zoom + "/" + x + "/" + y;
          if (reportTileIndex.tiles[tileKey]) {
            tileKeys.add(tileKey);
          }
        }
      }
    }

    return tileKeys;
  }

  function normalizeCompactReport(item) {
    if (!item) {
      return null;
    }

    const lon = Number(item.lon);
    const lat = Number(item.lat);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
      return null;
    }

    const plainText = String(item.text || "");
    const name = String(item.name || plainText || "No Text");

    return {
      id: String(item.id || ""),
      lon: lon,
      lat: lat,
      name: name,
      text: plainText,
      descriptionHtml: String(item.desc || "<p class=\"tweettext\">本文がありません。</p>"),
      iconUrl: String(item.img || "megaphone.png"),
    };
  }

  function addReportToScene(report, tileKey) {
    if (!report || !report.id || renderedReportById.has(report.id)) {
      return;
    }

    const labelSrc = report.text || report.name || "No Text";
    const labelText = labelSrc.length > 40 ? labelSrc.slice(0, 40) + "..." : labelSrc;
    const height = 400 + 400 * Math.random();
    const position = Cesium.Cartesian3.fromDegrees(report.lon, report.lat, height);

    const billboard = reportBillboards.add({
      id: report.id,
      position: position,
      image: "data/icon/flags/" + report.iconUrl,
      scale: isSmartphone ? 0.63 : 0.54,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
      translucencyByDistance: translucencyByDistanceBillboard,
    });

    const label = reportLabels.add({
      id: report.id,
      position: position,
      font: "12pt Sans-Serif",
      style: Cesium.LabelStyle.FILL,
      fillColor: Cesium.Color.WHITE,
      pixelOffset: new Cesium.Cartesian2(20.0, 0),
      text: labelText,
      scaleByDistance: new Cesium.NearFarScalar(0.0, 1.5, 1500, 0.7),
      verticalOrigin: Cesium.VerticalOrigin.CENTER,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
      translucencyByDistance: translucencyByDistanceLabel,
      show: !isSmartphone,
    });

    reportTextById.set(report.id, (report.name + " " + report.text).trim());
    reportDescriptionById.set(report.id, report.descriptionHtml);
    renderedReportById.set(report.id, {
      billboard: billboard,
      label: label,
      tileKey: tileKey,
    });
  }

  function removeTileFromScene(tileKey) {
    const reportIds = tileReportIds.get(tileKey);
    if (!reportIds) {
      return;
    }

    for (let i = 0; i < reportIds.length; i++) {
      const reportId = reportIds[i];
      const rendered = renderedReportById.get(reportId);
      if (!rendered) {
        continue;
      }
      reportBillboards.remove(rendered.billboard);
      reportLabels.remove(rendered.label);
      renderedReportById.delete(reportId);
    }

    tileReportIds.delete(tileKey);
    loadedTileKeys.delete(tileKey);
  }

  function loadTileByKey(tileKey) {
    if (!reportTileIndex || loadedTileKeys.has(tileKey) || loadingTileKeys.has(tileKey)) {
      return Promise.resolve();
    }

    const tileMeta = reportTileIndex.tiles[tileKey];
    if (!tileMeta) {
      return Promise.resolve();
    }

    loadingTileKeys.add(tileKey);
    return $.getJSON(reportTileBaseUrl + tileMeta.path)
      .then(function (tileData) {
        const tileReports = (tileData && tileData.reports) || [];
        const ids = [];

        for (let i = 0; i < tileReports.length; i++) {
          const normalized = normalizeCompactReport(tileReports[i]);
          if (!normalized) {
            continue;
          }
          addReportToScene(normalized, tileKey);
          ids.push(normalized.id);
        }

        tileReportIds.set(tileKey, ids);
        loadedTileKeys.add(tileKey);
        loadingDiv.innerHTML =
          "<p>" +
          renderedReportById.size +
          "/" +
          (reportTileIndex.totalTweets || renderedReportById.size) +
          " (visible tiles)</p>";
      })
      .always(function () {
        loadingTileKeys.delete(tileKey);
      });
  }

  function scheduleTileLoadByView() {
    if (tileLoadTimer !== null) {
      return;
    }

    tileLoadTimer = setTimeout(function () {
      tileLoadTimer = null;
      loadTilesByView();
    }, tileLoadDebounceMs);
  }

  function loadTilesByView() {
    if (!reportTileIndex) {
      return;
    }

    const targetTileKeys = buildVisibleTileKeySet();
    const loadPromises = [];

    loadedTileKeys.forEach(function (loadedTileKey) {
      if (!targetTileKeys.has(loadedTileKey)) {
        removeTileFromScene(loadedTileKey);
      }
    });

    targetTileKeys.forEach(function (tileKey) {
      loadPromises.push(loadTileByKey(tileKey));
    });

    Promise.all(loadPromises).then(function () {
      if (!isInitialTilesLoaded) {
        isInitialTilesLoaded = true;
        finishLoading();
      }
      updateVisibleReports();
      viewer.scene.requestRender();
    });
  }

  function loadSearchIndex() {
    return $.getJSON(reportSearchIndexUrl).then(function (searchData) {
      const reports = (searchData && searchData.tweets) || [];
      for (let i = 0; i < reports.length; i++) {
        const item = reports[i];
        if (item && item.id) {
          reportTextById.set(String(item.id), String(item.text || ""));
        }
      }
    });
  }

  function normalizeLegacyReport(record, index) {
    if (!record || !record.position || !record.position.cartographicDegrees) {
      return null;
    }

    const coords = record.position.cartographicDegrees;
    if (!Array.isArray(coords) || coords.length < 2) {
      return null;
    }

    const lon = Number(coords[0]);
    const lat = Number(coords[1]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
      return null;
    }

    const htmlText = String(record.text || "");
    const plainText = stripTags(htmlText);
    const name = String(record.name || plainText || "No Text");

    return {
      id: String(record.id || "weathernews" + index),
      lon: lon,
      lat: lat,
      name: name,
      text: plainText,
      descriptionHtml: htmlText || "<p class=\"tweettext\">本文がありません。</p>",
      iconUrl: String(record.iconUrl || "megaphone.png"),
    };
  }

  function convertLegacyReportsToTileIndex(legacyReports) {
    reportTileIndex = {
      zoom: 9,
      totalTweets: legacyReports.length,
      tiles: {
        "9/0/0": { path: "__legacy__", count: legacyReports.length },
      },
    };

    const ids = [];
    for (let i = 0; i < legacyReports.length; i++) {
      const normalized = normalizeLegacyReport(legacyReports[i], i);
      if (!normalized) {
        continue;
      }
      addReportToScene(normalized, "9/0/0");
      ids.push(normalized.id);
    }

    tileReportIds.set("9/0/0", ids);
    loadedTileKeys.add("9/0/0");
    isInitialTilesLoaded = true;
    finishLoading();
    updateVisibleReports();
    viewer.scene.requestRender();
  }

  function loadReports() {
    reportBillboards = viewer.scene.primitives.add(new Cesium.BillboardCollection());
    reportLabels = viewer.scene.primitives.add(new Cesium.LabelCollection());

    $.getJSON(reportTileIndexUrl)
      .done(function (indexData) {
        reportTileIndex = indexData;
        loadSearchIndex().always(function () {
          scheduleTileLoadByView();
          viewer.camera.changed.addEventListener(scheduleTileLoadByView);
          window.addEventListener("resize", scheduleTileLoadByView);
        });
      })
      .fail(function () {
        $.getJSON(legacyReportJsonUrl)
          .done(convertLegacyReportsToTileIndex)
          .fail(function () {
            loadingDiv.innerHTML = "<p class='twCounter'>データの読み込みに失敗しました。</p>";
          });
      });
  }

  function finishLoading() {
    setTimeout(function () {
      fadeInOut(blackOutDiv, 0);
      fadeInOut(loadingDiv, 0);
      changeViewPoint(1, 3);
    }, 1000);

    setupVisibilityCulling();
    descriptionBalloon();
    loadingDiv.innerHTML = "<p class='twCounter'>Completed.</p>";
  }

  function scheduleVisibilityUpdate() {
    if (cullTimer !== null) {
      return;
    }
    cullTimer = setTimeout(function () {
      cullTimer = null;
      updateVisibleReports();
    }, 50);
  }

  function updateVisibleReports() {
    if (!reportBillboards || !reportLabels) {
      return;
    }

    const canvas = viewer.scene.canvas;
    for (let i = 0; i < reportBillboards.length; i++) {
      const billboard = reportBillboards.get(i);
      const label = reportLabels.get(i);

      if (visibleFilterIds && !visibleFilterIds.has(billboard.id)) {
        billboard.show = false;
        label.show = false;
        continue;
      }

      const toObject = Cesium.Cartesian3.subtract(billboard.position, viewer.camera.positionWC, scratchToObject);
      const isFront = Cesium.Cartesian3.dot(viewer.camera.directionWC, toObject) > 0;
      if (!isFront) {
        billboard.show = false;
        label.show = false;
        continue;
      }

      const windowPosition = projectToWindowCoordinates
        ? projectToWindowCoordinates(viewer.scene, billboard.position, scratchWindow)
        : null;
      const isOnScreen =
        !!windowPosition &&
        windowPosition.x >= -cullMarginPx &&
        windowPosition.x <= canvas.clientWidth + cullMarginPx &&
        windowPosition.y >= -cullMarginPx &&
        windowPosition.y <= canvas.clientHeight + cullMarginPx;

      billboard.show = isOnScreen;
      label.show = isOnScreen && !isSmartphone;
    }

    viewer.scene.requestRender();
  }

  function setupVisibilityCulling() {
    if (cullingEnabled) {
      return;
    }
    cullingEnabled = true;
    viewer.camera.changed.addEventListener(scheduleVisibilityUpdate);
    window.addEventListener("resize", scheduleVisibilityUpdate);
    scheduleVisibilityUpdate();
  }

  function descriptionBalloon() {
    $(".functions,.general-button").click(function () {
      $(reportMessageDiv).hide();
    });

    viewer.camera.changed.addEventListener(function () {
      $(reportMessageDiv).fadeOut(100);
    });

    viewer.screenSpaceEventHandler.setInputAction(
      function onLeftClick(movement) {
        const pickedObject = scene.pick(movement.position);
        if (!pickedObject || pickedObject.id === undefined || pickedObject.id === null) {
          $(reportMessageDiv).hide();
          return;
        }

        const pickedId = String(pickedObject.id);
        const htmlText = reportDescriptionById.get(pickedId);
        if (!htmlText) {
          return;
        }

        const windowWidth = $(window).width();
        $(reportMessageDiv).fadeIn(200);
        adjustDivPosition();

        $(window).click(function (e) {
          $(window).off("click");
          const rightMargin = windowWidth - e.pageX;
          $(reportMessageDiv).html(htmlText);

          if (!isSmartphone) {
            if (rightMargin < 320) {
              $(reportMessageDiv).offset({ top: e.pageY + 8, left: e.pageX - 312 });
            } else {
              $(reportMessageDiv).offset({ top: e.pageY + 8, left: e.pageX + 8 });
            }
          } else {
            $(reportMessageDiv).offset({
              top: e.pageY + 8,
              left: windowWidth * 0.5 - 160,
            });
          }
        });
      },
      Cesium.ScreenSpaceEventType.LEFT_DOWN
    );
  }

  function adjustDivPosition() {
    setTimeout(function () {
      const windowHeight = $(window).height();
      const pos = $(reportMessageDiv).offset().top;
      const height = $(reportMessageDiv).height();
      if (windowHeight - (pos + height) < 0) {
        $(reportMessageDiv).offset({
          top: windowHeight - height - 12,
        });
      }
    }, 200);
  }

  function changeViewPoint(num, delay) {
    const viewPoint = viewPointsArray[num];
    const newHeading = Cesium.Math.toRadians(viewPoint.heading);
    const newPitch = Cesium.Math.toRadians(viewPoint.pitch);
    const center = Cesium.Cartesian3.fromDegrees(viewPoint.lng, viewPoint.lat);
    const boundingSphere = new Cesium.BoundingSphere(center, viewPoint.range);
    const headingPitchRange = new Cesium.HeadingPitchRange(newHeading, newPitch, viewPoint.range);

    viewer.camera.constrainedAxis = Cesium.Cartesian3.UNIT_Z;
    viewer.camera.flyToBoundingSphere(boundingSphere, {
      duration: delay,
      offset: headingPitchRange,
      easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT,
    });
  }

  function geocode() {
    if (!window.google || !google.maps || !google.maps.Geocoder) {
      alert("地名検索の初期化に失敗しました。");
      return;
    }

    const geocoder = new google.maps.Geocoder();
    const input = document.getElementById("inputtext").value;

    geocoder.geocode({ address: input }, function (results, status) {
      if (status !== "OK") {
        alert("見つかりません");
        return;
      }

      const viewport = results[0].geometry.viewport;
      const southWest = viewport.getSouthWest();
      const northEast = viewport.getNorthEast();
      const rectangle = Cesium.Rectangle.fromDegrees(
        southWest.lng(),
        southWest.lat(),
        northEast.lng(),
        northEast.lat()
      );
      viewer.camera.flyTo({
        destination: rectangle,
        easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT,
      });
    });
  }

  function flyToMyLocation() {
    function fly(position) {
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(position.coords.longitude, position.coords.latitude, 3000.0),
        easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT,
      });
    }

    navigator.geolocation.getCurrentPosition(fly);
  }

  function textSearch() {
    $(reportMessageDiv).hide();
    const searchQuery = String(document.getElementById("searchQuery").value).trim().toLowerCase();
    const matchedIdSet = searchQuery === "" ? null : new Set();

    if (searchQuery !== "") {
      reportTextById.forEach(function (text, id) {
        if (String(text).toLowerCase().indexOf(searchQuery) !== -1) {
          matchedIdSet.add(id);
        }
      });
    }

    visibleFilterIds = matchedIdSet;
    updateVisibleReports();
  }

  function fadeInOut(layer, param) {
    if (param === 0) {
      $(layer).fadeOut("slow");
      viewer.trackedEntity = undefined;
      return;
    }
    $(layer).fadeIn("slow");
  }

  function about() {
    window.open(aboutUrl);
  }

  window.geocode = geocode;
  window.flyToMyLocation = flyToMyLocation;
  window.textSearch = textSearch;
  window.about = about;
})();
