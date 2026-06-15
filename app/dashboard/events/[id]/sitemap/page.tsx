"use client";

import { use, useEffect, useRef, useState, useCallback } from "react";
import Link from "next/link";
import { jsPDF } from "jspdf";
import { createClient } from "@/lib/supabase";
import { useRequireAuth } from "@/lib/useRequireAuth";

// ── Constants ──────────────────────────────────────────────────────────────

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "";

const ZONE_TYPES = [
  { id: "Vendor Zone",       label: "Vendor Zone",       emoji: "🪧", color: "#5B4AE8" },
  { id: "Stage",             label: "Stage",             emoji: "🎭", color: "#E91E8C" },
  { id: "Open Dining Area",  label: "Open Dining Area",  emoji: "🍽️", color: "#00C896" },
  { id: "Closed Dining Area",label: "Closed Dining Area",emoji: "🍴", color: "#FFD60A" },
  { id: "Parking",           label: "Parking",           emoji: "🚗", color: "#888888" },
  { id: "Custom",            label: "Custom",            emoji: "✏️", color: "#2979FF" },
];

const MARKER_TYPES = [
  { id: "First Aid",        label: "First Aid",        emoji: "🏥" },
  { id: "Toilets",          label: "Toilets",          emoji: "🚻" },
  { id: "Entry/Exit",       label: "Entry/Exit",       emoji: "🚪" },
  { id: "Bins",             label: "Bins",             emoji: "🗑️" },
  { id: "Emergency Access", label: "Emergency Access", emoji: "🚨" },
  { id: "Custom",           label: "Custom",           emoji: "✏️" },
];

const ZONE_COLOR_MATCH = [
  "match", ["get", "spot_type"],
  "Vendor Zone",        "#5B4AE8",
  "Stage",              "#E91E8C",
  "Open Dining Area",   "#00C896",
  "Closed Dining Area", "#FFD60A",
  "Parking",            "#888888",
  "#2979FF",
] as unknown as any;

const QUICK_SHAPES = ["Rectangle", "Triangle", "Hexagon", "Circle"] as const;

const OPS_TEXT_FIELDS: [string, string, string][] = [
  ["councilName",        "Council Name",        "text"],
  ["expectedAttendance", "Expected Attendance", "number"],
  ["securityPersonnel",  "Security Personnel",  "number"],
  ["firstAidStaff",      "First Aid Staff",     "number"],
  ["eventManagerName",   "Event Manager Name",  "text"],
  ["eventManagerPhone",  "Event Manager Phone", "text"],
  ["eventStartTime",     "Event Start Time",    "text"],
  ["eventEndTime",       "Event End Time",      "text"],
  ["bumpInTime",         "Bump In Time",        "text"],
  ["bumpOutTime",        "Bump Out Time",       "text"],
  ["toiletsTotal",       "Toilets Total",       "number"],
  ["accessibleToilets",  "Accessible Toilets",  "number"],
  ["binsTotal",          "Bins Total",          "number"],
  ["recyclingBins",      "Recycling Bins",      "number"],
  ["generalBins",        "General Bins",        "number"],
];

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

// ── Types ──────────────────────────────────────────────────────────────────

type OpsFields = {
  councilName: string; expectedAttendance: string; securityPersonnel: string;
  firstAidStaff: string; eventManagerName: string; eventManagerPhone: string;
  eventStartTime: string; eventEndTime: string; bumpInTime: string;
  bumpOutTime: string; toiletsTotal: string; accessibleToilets: string;
  binsTotal: string; recyclingBins: string; generalBins: string;
  liveMusic: boolean | null; alcohol: boolean | null;
};
type CustomField = { label: string; value: string };
const DEFAULT_OPS: OpsFields = {
  councilName: "", expectedAttendance: "", securityPersonnel: "",
  firstAidStaff: "", eventManagerName: "", eventManagerPhone: "",
  eventStartTime: "", eventEndTime: "", bumpInTime: "",
  bumpOutTime: "", toiletsTotal: "", accessibleToilets: "",
  binsTotal: "", recyclingBins: "", generalBins: "",
  liveMusic: null, alcohol: null,
};

type SiteBoundary = { id: string; event_id: string; coordinates: [number, number][] };
type Zone = { id: string; event_id: string; spot_type: string; name: string | null; coordinates: number[][]; area_sqm: number | null; color: string | null };
type SiteMarker = { id: string; event_id: string; name: string; marker_type: string; latitude: number; longitude: number };
type VendorOption = { id: string; name: string };
type Mode = "view" | "drawing_boundary" | "drawing_zone" | "placing_marker" | "quick_zone";
type QuickShape = typeof QUICK_SHAPES[number];

// ── Helpers ────────────────────────────────────────────────────────────────

function calcAreaSqm(coords: [number, number][]): number {
  if (coords.length < 3) return 0;
  const R = 6371000;
  let area = 0;
  const n = coords.length;
  for (let i = 0; i < n; i++) {
    const [lng1, lat1] = coords[i];
    const [lng2, lat2] = coords[(i + 1) % n];
    const phi1 = (lat1 * Math.PI) / 180;
    const phi2 = (lat2 * Math.PI) / 180;
    const dLng = ((lng2 - lng1) * Math.PI) / 180;
    area += dLng * (2 + Math.sin(phi1) + Math.sin(phi2));
  }
  return Math.abs((area * R * R) / 2);
}

function centroid(coords: [number, number][]): [number, number] {
  return [
    coords.reduce((s, c) => s + c[0], 0) / coords.length,
    coords.reduce((s, c) => s + c[1], 0) / coords.length,
  ];
}

function fmtArea(sqm: number | null): string {
  if (!sqm) return "";
  return sqm >= 10000 ? `${(sqm / 10000).toFixed(2)} ha` : `${sqm.toFixed(0)} m²`;
}

function zoneInfo(type: string) {
  return ZONE_TYPES.find((z) => z.id === type) ?? ZONE_TYPES[5];
}

function markerInfo(type: string) {
  return MARKER_TYPES.find((m) => m.id === type) ?? MARKER_TYPES[5];
}

function meterOffset(lngCenter: number, latCenter: number, dx: number, dy: number): [number, number] {
  const latM = 111320;
  const lngM = 111320 * Math.cos((latCenter * Math.PI) / 180);
  return [lngCenter + dx / lngM, latCenter + dy / latM];
}

function buildQuickCoords(
  lngCenter: number, latCenter: number,
  shape: QuickShape,
  dims: { length: number; width: number; base: number; height: number; diameter: number }
): [number, number][] {
  switch (shape) {
    case "Rectangle": {
      const hw = dims.width / 2, hl = dims.length / 2;
      return [
        meterOffset(lngCenter, latCenter, -hw, -hl),
        meterOffset(lngCenter, latCenter,  hw, -hl),
        meterOffset(lngCenter, latCenter,  hw,  hl),
        meterOffset(lngCenter, latCenter, -hw,  hl),
      ];
    }
    case "Triangle": {
      const hb = dims.base / 2;
      return [
        meterOffset(lngCenter, latCenter,   0,  dims.height * 2 / 3),
        meterOffset(lngCenter, latCenter, -hb, -dims.height / 3),
        meterOffset(lngCenter, latCenter,  hb, -dims.height / 3),
      ];
    }
    case "Hexagon": {
      const r = dims.diameter / 2;
      return Array.from({ length: 6 }, (_, i) => {
        const a = ((i * 60 - 30) * Math.PI) / 180;
        return meterOffset(lngCenter, latCenter, r * Math.cos(a), r * Math.sin(a));
      });
    }
    case "Circle": {
      const r = dims.diameter / 2;
      return Array.from({ length: 32 }, (_, i) => {
        const a = ((i * 360) / 32 * Math.PI) / 180;
        return meterOffset(lngCenter, latCenter, r * Math.cos(a), r * Math.sin(a));
      });
    }
  }
}

function zonesToGeoJSON(zones: Zone[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: zones.map((z) => ({
      type: "Feature",
      id: z.id,
      geometry: { type: "Polygon", coordinates: [[...z.coordinates, z.coordinates[0]]] } as GeoJSON.Polygon,
      properties: { id: z.id, spot_type: z.spot_type, label_display: [z.name ?? "", z.area_sqm ? `\n${fmtArea(z.area_sqm)}` : ""].join("").trim() },
    })),
  };
}

function boundaryToGeoJSON(b: SiteBoundary | null): GeoJSON.FeatureCollection {
  if (!b) return { type: "FeatureCollection", features: [] };
  return {
    type: "FeatureCollection",
    features: [{ type: "Feature", id: b.id, geometry: { type: "Polygon", coordinates: [[...b.coordinates, b.coordinates[0]]] } as GeoJSON.Polygon, properties: {} }],
  };
}

function drawingToGeoJSON(pts: [number, number][]): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  if (pts.length >= 2) {
    const lineCoords = pts.length >= 3 ? [...pts, pts[0]] : pts;
    features.push({ type: "Feature", geometry: { type: "LineString", coordinates: lineCoords } as GeoJSON.LineString, properties: {} });
  }
  pts.forEach((p) => features.push({ type: "Feature", geometry: { type: "Point", coordinates: p } as GeoJSON.Point, properties: {} }));
  return { type: "FeatureCollection", features };
}

// ── Page ───────────────────────────────────────────────────────────────────

export default function SiteMapPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { loading: authLoading } = useRequireAuth();

  // Data state
  const [boundary,     setBoundary]     = useState<SiteBoundary | null>(null);
  const [zones,        setZones]        = useState<Zone[]>([]);
  const [zoneVendors,  setZoneVendors]  = useState<Record<string, string[]>>({});
  const [markers,      setMarkers]      = useState<SiteMarker[]>([]);
  const [vendors,      setVendors]      = useState<VendorOption[]>([]);
  const [eventName,    setEventName]    = useState("");
  const [eventDate,    setEventDate]    = useState("");
  const [eventLocation,setEventLocation]= useState("");
  const [promoterName, setPromoterName] = useState("");
  const [dataLoading,  setDataLoading]  = useState(true);
  const [mapLoaded,    setMapLoaded]    = useState(false);

  // UI state
  const [sidebarOpen,        setSidebarOpen]        = useState(true);
  const [mode,               setMode]               = useState<Mode>("view");
  const [drawZoneType,       setDrawZoneType]        = useState("Vendor Zone");
  const [drawMarkerType,     setDrawMarkerType]      = useState("First Aid");
  const [drawPoints,         setDrawPoints]          = useState<[number, number][]>([]);
  const [quickZoneOpen,      setQuickZoneOpen]       = useState(false);
  const [quickShape,         setQuickShape]          = useState<QuickShape>("Rectangle");
  const [quickDims,          setQuickDims]           = useState({ length: 10, width: 10, base: 10, height: 10, diameter: 20 });
  const [searchQuery,        setSearchQuery]         = useState("");
  const [searchResults,      setSearchResults]       = useState<{ place_name: string; center: [number, number] }[]>([]);
  const [showSearchResults,  setShowSearchResults]   = useState(false);
  const [selectedZoneId,     setSelectedZoneId]      = useState<string | null>(null);
  const [selectedMkrId,      setSelectedMkrId]       = useState<string | null>(null);
  const [addVendorZoneId,    setAddVendorZoneId]     = useState<string | null>(null);
  const [showResetConfirm,   setShowResetConfirm]    = useState(false);
  const [showSitePlan,       setShowSitePlan]        = useState(false);
  const [ops,                setOps]                 = useState<OpsFields>(DEFAULT_OPS);
  const [customFields,       setCustomFields]        = useState<CustomField[]>([]);
  const [saving,             setSaving]              = useState(false);
  const [exporting,          setExporting]           = useState(false);

  // Pending save state
  const [pendingSpot,        setPendingSpot]         = useState<{ coords: [number, number][]; area: number; isBoundary: boolean } | null>(null);
  const [pendingMarker,      setPendingMarker]       = useState<[number, number] | null>(null);
  const [saveZoneLabel,      setSaveZoneLabel]       = useState("");
  const [saveZoneType,       setSaveZoneType]        = useState("Vendor Zone");
  const [selectedVendorIds,  setSelectedVendorIds]   = useState<string[]>([]);
  const [saveMarkerLabel,    setSaveMarkerLabel]      = useState("");

  // Refs
  const mapContainerRef  = useRef<HTMLDivElement>(null);
  const mapRef           = useRef<any>(null);
  const mapboxglRef      = useRef<any>(null);
  const modeRef          = useRef<Mode>("view");
  const drawPointsRef    = useRef<[number, number][]>([]);
  const mkrInstancesRef  = useRef(new Map<string, any>());
  const quickShapeRef    = useRef<QuickShape>("Rectangle");
  const quickDimsRef     = useRef({ length: 10, width: 10, base: 10, height: 10, diameter: 20 });

  // Keep refs in sync
  useEffect(() => { quickShapeRef.current = quickShape; }, [quickShape]);
  useEffect(() => { quickDimsRef.current = quickDims; }, [quickDims]);

  // ── Map init ──────────────────────────────────────────────────────────────

  useEffect(() => {
    let map: any;

    const initMap = async () => {
      const mod = await import("mapbox-gl");
      await import("mapbox-gl/dist/mapbox-gl.css");
      const mapboxgl = mod.default;
      mapboxgl.accessToken = MAPBOX_TOKEN;
      mapboxglRef.current = mapboxgl;

      map = new mapboxgl.Map({
        container: mapContainerRef.current!,
        style: "mapbox://styles/mapbox/dark-v11",
        center: [144.9631, -37.8136],
        zoom: 13,
        preserveDrawingBuffer: true,
        pitch: 0,
        bearing: 0,
      });
      map.addControl(new mapboxgl.NavigationControl(), "top-right");

      map.on("load", () => {
        map.addSource("boundary", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        map.addSource("zones",    { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        map.addSource("drawing",  { type: "geojson", data: { type: "FeatureCollection", features: [] } });

        // Layer order: boundary-fill → boundary-line → zones-fill → zones-outline → zones-label → drawing-preview-line → drawing-preview-points
        map.addLayer({ id: "boundary-fill",    type: "fill",   source: "boundary", paint: { "fill-color": "#ffffff", "fill-opacity": 0.05 } });
        map.addLayer({ id: "boundary-line",    type: "line",   source: "boundary", paint: { "line-color": "#ffffff", "line-width": 2, "line-dasharray": [4, 3], "line-opacity": 0.6 } });
        map.addLayer({ id: "zones-fill",       type: "fill",   source: "zones",    paint: { "fill-color": ZONE_COLOR_MATCH, "fill-opacity": 0.4 } });
        map.addLayer({ id: "zones-outline",    type: "line",   source: "zones",    paint: { "line-color": ZONE_COLOR_MATCH, "line-width": 1 } });
        map.addLayer({
          id: "zones-label", type: "symbol", source: "zones",
          layout: { "text-field": ["get", "label_display"], "text-size": 12, "text-font": ["Open Sans Semibold", "Arial Unicode MS Bold"], "text-anchor": "center", "text-max-width": 10 },
          paint: { "text-color": "#ffffff", "text-halo-color": "rgba(0,0,0,0.8)", "text-halo-width": 1.5 },
        });
        map.addLayer({ id: "drawing-preview-line",   type: "line",   source: "drawing", filter: ["in", ["geometry-type"], ["literal", ["LineString"]]], paint: { "line-color": "#ffffff", "line-width": 2, "line-dasharray": [2, 2] } });
        map.addLayer({ id: "drawing-preview-points", type: "circle", source: "drawing", filter: ["==", ["geometry-type"], "Point"], paint: { "circle-radius": 5, "circle-color": "#ffffff", "circle-stroke-width": 2, "circle-stroke-color": "#000000" } });

        map.on("click", "zones-fill", (e: any) => {
          if (modeRef.current !== "view") return;
          e.originalEvent.stopPropagation();
          const props = e.features?.[0]?.properties;
          if (props?.id) { setSelectedMkrId(null); setSelectedZoneId(props.id); }
        });

        map.on("click", (e: any) => {
          const m = modeRef.current;
          if (m === "drawing_boundary" || m === "drawing_zone") {
            const pt: [number, number] = [e.lngLat.lng, e.lngLat.lat];
            const newPts = [...drawPointsRef.current, pt];
            drawPointsRef.current = newPts;
            setDrawPoints([...newPts]);
            (map.getSource("drawing") as any).setData(drawingToGeoJSON(newPts));
          } else if (m === "placing_marker") {
            setPendingMarker([e.lngLat.lng, e.lngLat.lat]);
            setSaveMarkerLabel("");
            exitDrawMode(map);
          } else if (m === "quick_zone") {
            const coords = buildQuickCoords(e.lngLat.lng, e.lngLat.lat, quickShapeRef.current, quickDimsRef.current);
            const area = calcAreaSqm(coords);
            setPendingSpot({ coords, area, isBoundary: false });
            setSaveZoneLabel("");
            setSaveZoneType(drawZoneType);
            setSelectedVendorIds([]);
            exitDrawMode(map);
          } else {
            setSelectedZoneId(null);
            setSelectedMkrId(null);
          }
        });

        map.on("dblclick", (e: any) => {
          const m = modeRef.current;
          if (m !== "drawing_boundary" && m !== "drawing_zone") return;
          e.preventDefault();
          const pts = drawPointsRef.current.slice(0, -1);
          if (pts.length < 3) return;
          const area = calcAreaSqm(pts);
          const isBoundary = m === "drawing_boundary";
          setPendingSpot({ coords: pts, area, isBoundary });
          if (!isBoundary) { setSaveZoneLabel(""); setSaveZoneType(drawZoneType); setSelectedVendorIds([]); }
          (map.getSource("drawing") as any).setData({ type: "FeatureCollection", features: [] });
          drawPointsRef.current = [];
          setDrawPoints([]);
          exitDrawMode(map);
        });

        map.on("mouseenter", "zones-fill", () => { if (modeRef.current === "view") map.getCanvas().style.cursor = "pointer"; });
        map.on("mouseleave", "zones-fill", () => { if (modeRef.current === "view") map.getCanvas().style.cursor = ""; });

        map.dragRotate.disable();
        map.touchZoomRotate.disableRotation();

        mapRef.current = map;
        setMapLoaded(true);
      });
    };

    const timer = setTimeout(() => { if (mapContainerRef.current) initMap(); }, 100);
    return () => {
      clearTimeout(timer);
      mkrInstancesRef.current.forEach((m: any) => m.remove());
      mkrInstancesRef.current.clear();
      if (map) map.remove();
      mapRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Escape key ────────────────────────────────────────────────────────────

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && modeRef.current !== "view") cancelMode(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Data loading ──────────────────────────────────────────────────────────

  useEffect(() => {
    if (mapLoaded) loadData();
  }, [id, mapLoaded]); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadData() {
    const map = mapRef.current;
    if (!map) return;
    try {
      const supabase = createClient();

      const { data: boundaryData } = await supabase.from("event_site_boundary").select("id, event_id, coordinates").eq("event_id", id).maybeSingle();
      const { data: zonesData }    = await supabase.from("event_zones").select("id, event_id, name, coordinates, area_sqm, spot_type, color").eq("event_id", id);
      const { data: markersData }  = await supabase.from("event_site_markers").select("id, event_id, name, marker_type, latitude, longitude").eq("event_id", id);
      const { data: evVendorsData }= await supabase.from("event_vendors").select("vendor_id").eq("event_id", id);
      const { data: eventData }    = await supabase.from("events").select("name, start_date, location").eq("id", id).single();

      const loadedZones   = (zonesData   ?? []) as Zone[];
      const loadedMarkers = (markersData ?? []) as SiteMarker[];
      const vendorIds     = ((evVendorsData ?? []) as { vendor_id: string }[]).map((v) => v.vendor_id);

      let vendorList: VendorOption[] = [];
      if (vendorIds.length > 0) {
        const { data: vpData } = await supabase.from("vendor_profiles").select("user_id, business_name").in("user_id", vendorIds);
        vendorList = ((vpData ?? []) as { user_id: string; business_name: string }[]).map((v) => ({ id: v.user_id, name: v.business_name }));
      }

      let zvMap: Record<string, string[]> = {};
      const zoneIds = loadedZones.map((z) => z.id);
      if (zoneIds.length > 0) {
        const { data: zvData } = await supabase.from("event_zone_vendors").select("zone_id, vendor_id").in("zone_id", zoneIds);
        ((zvData ?? []) as { zone_id: string; vendor_id: string }[]).forEach((zv) => {
          if (!zvMap[zv.zone_id]) zvMap[zv.zone_id] = [];
          zvMap[zv.zone_id].push(zv.vendor_id);
        });
      }

      const { data: authData } = await supabase.auth.getUser();
      if (authData.user) {
        const { data: profileData } = await supabase.from("promoter_profiles").select("company_name").eq("user_id", authData.user.id).single();
        setPromoterName((profileData as any)?.company_name ?? "");
      }

      setBoundary(boundaryData as SiteBoundary ?? null);
      setZones(loadedZones);
      setZoneVendors(zvMap);
      setMarkers(loadedMarkers);
      setVendors(vendorList);
      if (eventData) { setEventName(eventData.name ?? ""); setEventDate(eventData.start_date ?? ""); setEventLocation((eventData as any).location ?? ""); }

      (map.getSource("boundary") as any).setData(boundaryToGeoJSON(boundaryData as SiteBoundary ?? null));
      (map.getSource("zones") as any).setData(zonesToGeoJSON(loadedZones));
      loadedMarkers.forEach((mk) => addMarkerToMap(map, mk));

      const fitTarget = boundaryData
        ? (boundaryData as SiteBoundary).coordinates
        : loadedZones.length > 0 ? loadedZones.flatMap((z) => z.coordinates as [number, number][])
        : null;
      if (fitTarget && fitTarget.length > 0) {
        const bounds = fitTarget.reduce(
          (b: any, c: [number, number]) => b.extend(c),
          new mapboxglRef.current.LngLatBounds(fitTarget[0], fitTarget[0])
        );
        map.fitBounds(bounds, { padding: 60, duration: 800 });
      } else if (loadedMarkers.length > 0) {
        const first = loadedMarkers[0];
        map.flyTo({ center: [first.longitude, first.latitude], zoom: 16 });
      }
    } catch (err) {
      console.error("Site map load error:", err);
    } finally {
      setDataLoading(false);
    }
  }

  // ── Marker management ─────────────────────────────────────────────────────

  function addMarkerToMap(map: any, mk: SiteMarker) {
    if (mkrInstancesRef.current.has(mk.id)) return;
    const el = document.createElement("div");
    el.style.cssText = "width:32px;height:32px;display:flex;align-items:center;justify-content:center;font-size:20px;background:#141414;border-radius:50%;border:2px solid #222;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,0.5)";
    el.textContent = markerInfo(mk.marker_type).emoji;
    el.title = mk.name || markerInfo(mk.marker_type).label;
    el.onclick = (e) => { e.stopPropagation(); setSelectedZoneId(null); setSelectedMkrId(mk.id); };
    const instance = new mapboxglRef.current.Marker({ element: el, anchor: "center" })
      .setLngLat([mk.longitude, mk.latitude])
      .addTo(map);
    mkrInstancesRef.current.set(mk.id, instance);
  }

  function removeMarkerFromMap(mkId: string) {
    const instance = mkrInstancesRef.current.get(mkId);
    if (instance) { instance.remove(); mkrInstancesRef.current.delete(mkId); }
  }

  // ── Mode management ───────────────────────────────────────────────────────

  function resetDrawing() {
    try { (mapRef.current?.getSource("drawing") as any)?.setData({ type: "FeatureCollection", features: [] }); } catch {}
    drawPointsRef.current = [];
    setDrawPoints([]);
  }

  function exitDrawMode(map: any) {
    modeRef.current = "view";
    setMode("view");
    map.getCanvas().style.cursor = "";
    map.doubleClickZoom.enable();
  }

  function cancelMode() {
    const map = mapRef.current;
    if (!map) return;
    resetDrawing();
    exitDrawMode(map);
  }

  function startDrawingBoundary() {
    const map = mapRef.current;
    if (!map) return;
    resetDrawing();
    modeRef.current = "drawing_boundary";
    setMode("drawing_boundary");
    map.getCanvas().style.cursor = "crosshair";
    map.doubleClickZoom.disable();
    setSelectedZoneId(null); setSelectedMkrId(null);
  }

  function startDrawingZone(zoneType: string) {
    const map = mapRef.current;
    if (!map) return;
    resetDrawing();
    setDrawZoneType(zoneType);
    modeRef.current = "drawing_zone";
    setMode("drawing_zone");
    map.getCanvas().style.cursor = "crosshair";
    map.doubleClickZoom.disable();
    setSelectedZoneId(null); setSelectedMkrId(null);
  }

  function startPlacingMarker(markerType: string) {
    const map = mapRef.current;
    if (!map) return;
    resetDrawing();
    setDrawMarkerType(markerType);
    modeRef.current = "placing_marker";
    setMode("placing_marker");
    map.getCanvas().style.cursor = "crosshair";
    map.doubleClickZoom.disable();
    setSelectedZoneId(null); setSelectedMkrId(null);
  }

  function startQuickZone() {
    const map = mapRef.current;
    if (!map) return;
    resetDrawing();
    modeRef.current = "quick_zone";
    setMode("quick_zone");
    map.getCanvas().style.cursor = "crosshair";
    setSelectedZoneId(null); setSelectedMkrId(null);
  }

  // ── Location search ───────────────────────────────────────────────────────

  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleSearchInput(q: string) {
    setSearchQuery(q);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    if (!q.trim()) { setSearchResults([]); setShowSearchResults(false); return; }
    searchTimeout.current = setTimeout(async () => {
      try {
        const res = await fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json?country=AU&access_token=${MAPBOX_TOKEN}`);
        const json = await res.json();
        setSearchResults((json.features ?? []).map((f: any) => ({ place_name: f.place_name, center: f.center as [number, number] })));
        setShowSearchResults(true);
      } catch {}
    }, 300);
  }

  function selectSearchResult(center: [number, number]) {
    mapRef.current?.flyTo({ center, zoom: 15, duration: 800 });
    setSearchQuery(""); setSearchResults([]); setShowSearchResults(false);
  }

  // ── Save boundary ─────────────────────────────────────────────────────────

  async function saveBoundary() {
    if (!pendingSpot?.isBoundary) return;
    setSaving(true);
    const supabase = createClient();
    await supabase.from("event_site_boundary").delete().eq("event_id", id);
    const { data, error } = await supabase
      .from("event_site_boundary")
      .insert({ event_id: id, coordinates: pendingSpot.coords })
      .select("id, event_id, coordinates")
      .single();
    if (!error && data) {
      const nb = data as SiteBoundary;
      setBoundary(nb);
      (mapRef.current?.getSource("boundary") as any)?.setData(boundaryToGeoJSON(nb));
    } else if (error) console.error("saveBoundary error:", error.message);
    setPendingSpot(null);
    setSaving(false);
  }

  // ── Save zone ─────────────────────────────────────────────────────────────

  async function saveZone() {
    if (!pendingSpot || pendingSpot.isBoundary) return;
    setSaving(true);
    const supabase = createClient();
    const { data, error } = await supabase
      .from("event_zones")
      .insert({ event_id: id, spot_type: saveZoneType, name: saveZoneLabel.trim() || null, coordinates: pendingSpot.coords, area_sqm: Math.round(pendingSpot.area), color: zoneInfo(saveZoneType).color })
      .select("id, event_id, name, coordinates, area_sqm, spot_type, color")
      .single();
    if (error || !data) { console.error("saveZone error:", error?.message); setSaving(false); return; }
    const newZone = data as Zone;
    if (selectedVendorIds.length > 0) {
      await supabase.from("event_zone_vendors").insert(selectedVendorIds.map((vid) => ({ zone_id: newZone.id, vendor_id: vid })));
      setZoneVendors((prev) => ({ ...prev, [newZone.id]: selectedVendorIds }));
    }
    const updated = [...zones, newZone];
    setZones(updated);
    (mapRef.current?.getSource("zones") as any)?.setData(zonesToGeoJSON(updated));
    setPendingSpot(null);
    setSaving(false);
  }

  // ── Save marker ───────────────────────────────────────────────────────────

  async function saveMarker() {
    if (!pendingMarker) return;
    setSaving(true);
    const { data, error } = await createClient()
      .from("event_site_markers")
      .insert({ event_id: id, name: saveMarkerLabel.trim() || drawMarkerType, marker_type: drawMarkerType, latitude: pendingMarker[1], longitude: pendingMarker[0] })
      .select("id, event_id, name, marker_type, latitude, longitude")
      .single();
    if (!error && data) {
      const newMk = data as SiteMarker;
      setMarkers((prev) => [...prev, newMk]);
      const map = mapRef.current;
      if (map) addMarkerToMap(map, newMk);
    } else if (error) console.error("saveMarker error:", error.message);
    setPendingMarker(null);
    setSaving(false);
  }

  // ── Delete / clear operations ─────────────────────────────────────────────

  async function deleteZone(zoneId: string) {
    const supabase = createClient();
    await supabase.from("event_zone_vendors").delete().eq("zone_id", zoneId);
    await supabase.from("event_zones").delete().eq("id", zoneId);
    const updated = zones.filter((z) => z.id !== zoneId);
    setZones(updated);
    setZoneVendors((prev) => { const n = { ...prev }; delete n[zoneId]; return n; });
    (mapRef.current?.getSource("zones") as any)?.setData(zonesToGeoJSON(updated));
    setSelectedZoneId(null);
  }

  async function clearBoundary() {
    const supabase = createClient();
    await supabase.from("event_site_boundary").delete().eq("event_id", id);
    await supabase.from("event_zones").delete().eq("event_id", id);
    await supabase.from("event_site_markers").delete().eq("event_id", id);
    setBoundary(null);
    setZones([]);
    setZoneVendors({});
    markers.forEach((mk) => removeMarkerFromMap(mk.id));
    setMarkers([]);
    (mapRef.current?.getSource("boundary") as any)?.setData({ type: "FeatureCollection", features: [] });
    (mapRef.current?.getSource("zones") as any)?.setData({ type: "FeatureCollection", features: [] });
  }

  async function deleteMarker(mkId: string) {
    await createClient().from("event_site_markers").delete().eq("id", mkId);
    setMarkers((prev) => prev.filter((m) => m.id !== mkId));
    removeMarkerFromMap(mkId);
    setSelectedMkrId(null);
  }

  async function handleReset() {
    const supabase = createClient();
    await supabase.from("event_site_boundary").delete().eq("event_id", id);
    await supabase.from("event_zones").delete().eq("event_id", id);
    await supabase.from("event_site_markers").delete().eq("event_id", id);
    setBoundary(null);
    setZones([]);
    setZoneVendors({});
    markers.forEach((mk) => removeMarkerFromMap(mk.id));
    setMarkers([]);
    (mapRef.current?.getSource("boundary") as any)?.setData({ type: "FeatureCollection", features: [] });
    (mapRef.current?.getSource("zones") as any)?.setData({ type: "FeatureCollection", features: [] });
    setShowResetConfirm(false);
  }

  // ── Zone vendor management ────────────────────────────────────────────────

  async function removeZoneVendor(zoneId: string, vendorId: string) {
    await createClient().from("event_zone_vendors").delete().eq("zone_id", zoneId).eq("vendor_id", vendorId);
    setZoneVendors((prev) => ({ ...prev, [zoneId]: (prev[zoneId] ?? []).filter((v) => v !== vendorId) }));
  }

  async function addZoneVendor(zoneId: string, vendorId: string) {
    await createClient().from("event_zone_vendors").insert({ zone_id: zoneId, vendor_id: vendorId });
    setZoneVendors((prev) => ({ ...prev, [zoneId]: [...(prev[zoneId] ?? []), vendorId] }));
    setAddVendorZoneId(null);
  }

  async function editZone(zone: Zone) {
    const savedVendors = zoneVendors[zone.id] ?? [];
    await deleteZone(zone.id);
    setDrawZoneType(zone.spot_type);
    const pts = zone.coordinates as [number, number][];
    drawPointsRef.current = pts;
    setDrawPoints([...pts]);
    setSaveZoneType(zone.spot_type);
    setSaveZoneLabel(zone.name ?? "");
    setSelectedVendorIds(savedVendors);
    (mapRef.current?.getSource("drawing") as any)?.setData(drawingToGeoJSON(pts));
    const map = mapRef.current;
    if (!map) return;
    modeRef.current = "drawing_zone";
    setMode("drawing_zone");
    map.getCanvas().style.cursor = "crosshair";
    map.doubleClickZoom.disable();
  }

  // ── Fly to ────────────────────────────────────────────────────────────────

  function flyToZone(zone: Zone) {
    const [lng, lat] = centroid(zone.coordinates as [number, number][]);
    mapRef.current?.flyTo({ center: [lng, lat], zoom: 17, duration: 800 });
  }

  function flyToMarker(mk: SiteMarker) {
    mapRef.current?.flyTo({ center: [mk.longitude, mk.latitude], zoom: 17, duration: 800 });
  }

  // ── Generate Site Plan PDF ────────────────────────────────────────────────

  async function generateSitePlanPDF() {
    const map = mapRef.current;
    if (!map) return;
    setExporting(true);
    try {
      // 1. Fetch flat top-down map from Mapbox Static Images API (always perfectly flat)
      const STATIC_W = 1200;
      const STATIC_H = 800;
      const token = MAPBOX_TOKEN;

      // Determine center and zoom to tightly fit boundary (or zones, or current view)
      const fitCoords: number[][] = boundary
        ? (boundary.coordinates as number[][])
        : zones.length > 0
        ? zones.flatMap((z) => z.coordinates as number[][])
        : [];

      let center: { lng: number; lat: number };
      let zoom: number;

      if (fitCoords.length > 0) {
        const lngs = fitCoords.map((c) => c[0]);
        const lats  = fitCoords.map((c) => c[1]);
        const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
        const minLat = Math.min(...lats), maxLat = Math.max(...lats);
        const lngPad = (maxLng - minLng) * 0.02;
        const latPad = (maxLat - minLat) * 0.02;
        const pMinLng = minLng - lngPad, pMaxLng = maxLng + lngPad;
        const pMinLat = minLat - latPad, pMaxLat = maxLat + latPad;
        center = { lng: (pMinLng + pMaxLng) / 2, lat: (pMinLat + pMaxLat) / 2 };
        const lngSpan = pMaxLng - pMinLng || 0.001;
        const latSpan = pMaxLat - pMinLat || 0.001;
        const zoomForLng = Math.log2((STATIC_W * 360) / (lngSpan * 512));
        const zoomForLat = Math.log2((STATIC_H * 170) / (latSpan * 512));
        zoom = Math.max(13, Math.min(18, Math.floor(Math.min(zoomForLng, zoomForLat)) + 2));

        // If zones are much smaller than boundary, zoom to zones instead
        if (zones.length > 0) {
          const zLngs = zones.flatMap((z) => (z.coordinates as number[][]).map((c) => c[0]));
          const zLats = zones.flatMap((z) => (z.coordinates as number[][]).map((c) => c[1]));
          const zMinLng = Math.min(...zLngs), zMaxLng = Math.max(...zLngs);
          const zMinLat = Math.min(...zLats), zMaxLat = Math.max(...zLats);
          const boundaryArea = lngSpan * latSpan;
          const zonesArea = (zMaxLng - zMinLng) * (zMaxLat - zMinLat);
          if (zonesArea < boundaryArea * 0.3) {
            const zLngPad = (zMaxLng - zMinLng) * 0.3;
            const zLatPad = (zMaxLat - zMinLat) * 0.3;
            center = { lng: (zMinLng + zMaxLng) / 2, lat: (zMinLat + zMaxLat) / 2 };
            const zLngSpan = (zMaxLng - zMinLng) + zLngPad * 2;
            const zLatSpan = (zMaxLat - zMinLat) + zLatPad * 2;
            const zZoomLng = Math.log2((STATIC_W * 360) / (zLngSpan * 512));
            const zZoomLat = Math.log2((STATIC_H * 170) / (zLatSpan * 512));
            zoom = Math.max(13, Math.min(18, Math.floor(Math.min(zZoomLng, zZoomLat))));
          }
        }
      } else {
        const c = map.getCenter();
        center = { lng: c.lng, lat: c.lat };
        zoom = Math.floor(map.getZoom());
      }

      // Build GeoJSON overlay of boundary + zones
      const features: object[] = [];
      if (boundary) {
        const coords = boundary.coordinates as number[][];
        features.push({
          type: "Feature",
          properties: { stroke: "#ffffff", "stroke-width": 3, "stroke-opacity": 1, fill: "#ffffff", "fill-opacity": 0.05 },
          geometry: { type: "Polygon", coordinates: [[...coords, coords[0]]] },
        });
      }
      zones.forEach((z) => {
        const coords = z.coordinates as number[][];
        const color = (ZONE_TYPES.find((t) => t.id === z.spot_type) ?? ZONE_TYPES[5]).color;
        features.push({
          type: "Feature",
          properties: { stroke: color, "stroke-width": 2, "stroke-opacity": 1, fill: color, "fill-opacity": 0.5 },
          geometry: { type: "Polygon", coordinates: [[...coords, coords[0]]] },
        });
      });
      const geojsonStr = encodeURIComponent(JSON.stringify({ type: "FeatureCollection", features }));
      const overlaySegment = features.length > 0 ? `geojson(${geojsonStr})/` : "";

      const staticUrl = `https://api.mapbox.com/styles/v1/mapbox/dark-v11/static/${overlaySegment}${center.lng},${center.lat},${zoom},0,0/${STATIC_W}x${STATIC_H}@2x?access_token=${token}`;

      const response = await fetch(staticUrl);
      const blob = await response.blob();
      const mapImage = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.readAsDataURL(blob);
      });

      // 2. Composite markers onto the static image using Mercator math
      const TILE_SIZE = 512;
      const scale = Math.pow(2, zoom);
      const mercatorY = (lat: number) =>
        (1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2;
      const centerMX = ((center.lng + 180) / 360) * TILE_SIZE * scale;
      const centerMY = mercatorY(center.lat) * TILE_SIZE * scale;

      // @2x image is 2400×1600 physical pixels
      const physW = STATIC_W * 2;
      const physH = STATIC_H * 2;
      const halfW = STATIC_W; // half of physical width (= CSS width)
      const halfH = STATIC_H; // half of physical height (= CSS height)

      const overlayCanvas = document.createElement("canvas");
      overlayCanvas.width  = physW;
      overlayCanvas.height = physH;
      const ctx = overlayCanvas.getContext("2d")!;

      const img = new Image();
      await new Promise<void>((resolve) => { img.onload = () => resolve(); img.src = mapImage; });
      ctx.drawImage(img, 0, 0);

      const emojiFontSize = Math.round(physW / 40);
      const labelFontSize = Math.round(physW / 70);
      ctx.textAlign    = "center";
      ctx.textBaseline = "middle";

      markers.forEach((mk) => {
        const mkMX = ((mk.longitude + 180) / 360) * TILE_SIZE * scale;
        const mkMY = mercatorY(mk.latitude) * TILE_SIZE * scale;
        const px = (mkMX - centerMX) * 2 + halfW; // ×2 for @2x
        const py = (mkMY - centerMY) * 2 + halfH;

        ctx.font = `${emojiFontSize}px serif`;
        ctx.fillText(markerInfo(mk.marker_type).emoji, px, py);

        const label = mk.name || markerInfo(mk.marker_type).label;
        ctx.font = `bold ${labelFontSize}px sans-serif`;
        ctx.lineWidth = 3;
        ctx.strokeStyle = "rgba(0,0,0,0.8)";
        ctx.strokeText(label, px, py + emojiFontSize * 0.8);
        ctx.fillStyle = "#ffffff";
        ctx.fillText(label, px, py + emojiFontSize * 0.8);
      });

      // Zone name + area labels drawn at polygon centroid
      const zoneLabelFont   = Math.round(physW / 65);
      const zoneAreaFont    = Math.round(physW / 85);
      ctx.textAlign    = "center";
      ctx.textBaseline = "middle";
      zones.forEach((z) => {
        const coords = z.coordinates as number[][];
        // Centroid of polygon vertices
        const cx = coords.reduce((s, c) => s + c[0], 0) / coords.length;
        const cy = coords.reduce((s, c) => s + c[1], 0) / coords.length;
        const cxMX = ((cx + 180) / 360) * TILE_SIZE * scale;
        const cxMY = mercatorY(cy) * TILE_SIZE * scale;
        const px = (cxMX - centerMX) * 2 + halfW;
        const py = (cxMY - centerMY) * 2 + halfH;

        const name = z.name || z.spot_type;
        const areaText = z.area_sqm != null
          ? z.area_sqm >= 10000
            ? `${(z.area_sqm / 10000).toFixed(2)} ha`
            : `${Math.round(z.area_sqm)} m²`
          : "";

        // Measure pill size
        ctx.font = `bold ${zoneLabelFont}px sans-serif`;
        const nameW = ctx.measureText(name).width;
        ctx.font = `${zoneAreaFont}px sans-serif`;
        const areaW = ctx.measureText(areaText).width;
        const pillW = Math.max(nameW, areaW) + 24;
        const lineH = zoneLabelFont + 4;
        const pillH = areaText ? lineH * 2 + 12 : lineH + 12;

        // Dark pill background
        const pillX = px - pillW / 2;
        const pillY = py - pillH / 2;
        const r = 10;
        ctx.fillStyle = "rgba(0,0,0,0.65)";
        ctx.beginPath();
        ctx.moveTo(pillX + r, pillY);
        ctx.lineTo(pillX + pillW - r, pillY);
        ctx.quadraticCurveTo(pillX + pillW, pillY, pillX + pillW, pillY + r);
        ctx.lineTo(pillX + pillW, pillY + pillH - r);
        ctx.quadraticCurveTo(pillX + pillW, pillY + pillH, pillX + pillW - r, pillY + pillH);
        ctx.lineTo(pillX + r, pillY + pillH);
        ctx.quadraticCurveTo(pillX, pillY + pillH, pillX, pillY + pillH - r);
        ctx.lineTo(pillX, pillY + r);
        ctx.quadraticCurveTo(pillX, pillY, pillX + r, pillY);
        ctx.closePath();
        ctx.fill();

        // Zone name (white bold)
        const nameY = areaText ? py - lineH / 2 : py;
        ctx.font = `bold ${zoneLabelFont}px sans-serif`;
        ctx.fillStyle = "#ffffff";
        ctx.fillText(name, px, nameY);

        // Area (grey, smaller)
        if (areaText) {
          ctx.font = `${zoneAreaFont}px sans-serif`;
          ctx.fillStyle = "rgba(180,180,180,0.9)";
          ctx.fillText(areaText, px, nameY + lineH);
        }
      });

      const imgData = overlayCanvas.toDataURL("image/png");

      // ── 3. Build PDF ──────────────────────────────────────────────────────
      const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
      const pw = pdf.internal.pageSize.getWidth();   // 297
      const ph = pdf.internal.pageSize.getHeight();  // 210

      // Shared constants
      const PURPLE: [number, number, number] = [91, 74, 232];
      const DARK:   [number, number, number] = [26, 26, 26];
      const GREY:   [number, number, number] = [102, 102, 102];
      const LGREY:  [number, number, number] = [136, 136, 136];
      const STRIP:  [number, number, number] = [245, 245, 245];
      const ROW_ALT:[number, number, number] = [249, 249, 249];
      const BORDER: [number, number, number] = [221, 221, 221];

      const HEADER_H = 20;
      const STRIP_H  = 8;
      const FOOTER_H = 15;
      const MARGIN   = 10;

      // ── Shared helpers ────────────────────────────────────────────────────
      const drawPageHeader = (title: string) => {
        pdf.setFillColor(...PURPLE);
        pdf.rect(0, 0, pw, HEADER_H, "F");
        pdf.setFont("helvetica", "bold"); pdf.setFontSize(18); pdf.setTextColor(255, 255, 255);
        pdf.text(title, MARGIN, 13);
        pdf.setFont("helvetica", "normal"); pdf.setFontSize(14);
        pdf.text(eventName || "Unnamed Event", pw / 2, 13, { align: "center" });
        pdf.setFontSize(11);
        pdf.text("CREWBASE", pw - MARGIN, 13, { align: "right" });
      };

      const drawPageFooter = (pageNum: number, total: number) => {
        const fy = ph - FOOTER_H;
        pdf.setDrawColor(...BORDER);
        pdf.setLineWidth(0.3);
        pdf.line(0, fy, pw, fy);
        pdf.setFont("helvetica", "normal"); pdf.setFontSize(8); pdf.setTextColor(...LGREY);
        pdf.text("Generated by Crewbase · trycrewbase.com", MARGIN, fy + 9);
        pdf.text(`${pageNum} / ${total}`, pw - MARGIN, fy + 9, { align: "right" });
      };

      const drawSectionHeading = (x: number, y: number, text: string, colW: number) => {
        pdf.setFont("helvetica", "bold"); pdf.setFontSize(8); pdf.setTextColor(...LGREY);
        pdf.text(text.toUpperCase(), x, y);
        pdf.setDrawColor(...PURPLE); pdf.setLineWidth(0.3);
        pdf.line(x, y + 1.5, x + colW, y + 1.5);
        pdf.setFont("helvetica", "normal"); pdf.setLineWidth(0.1); pdf.setDrawColor(...BORDER);
      };

      const drawTableRow = (x: number, y: number, colW: number, label: string, value: string, alt: boolean, purple = false) => {
        const ROW_H = 6.5;
        if (alt) { pdf.setFillColor(...ROW_ALT); pdf.rect(x, y - 4.5, colW, ROW_H, "F"); }
        pdf.setFontSize(9); pdf.setTextColor(...GREY);
        pdf.setFont("helvetica", "normal");
        pdf.text(label, x + 2, y);
        if (purple) { pdf.setFont("helvetica", "bold"); pdf.setTextColor(...PURPLE); }
        else { pdf.setFont("helvetica", "bold"); pdf.setTextColor(...DARK); }
        pdf.text(value, x + colW - 2, y, { align: "right", maxWidth: colW * 0.55 });
        pdf.setFont("helvetica", "normal");
      };

      // ── PAGE 1: Site Map ──────────────────────────────────────────────────
      pdf.setFillColor(255, 255, 255);
      pdf.rect(0, 0, pw, ph, "F");

      drawPageHeader("SITE PLAN");

      // Info strip
      const stripY = HEADER_H;
      pdf.setFillColor(...STRIP);
      pdf.rect(0, stripY, pw, STRIP_H, "F");
      const pdfDate = eventDate
        ? new Date(eventDate + "T00:00:00").toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" })
        : "";
      const siteAreaStr = boundary
        ? `${(calcAreaSqm(boundary.coordinates) / 10000).toFixed(2)} ha`
        : "";
      const stripParts = [
        pdfDate     ? `Date: ${pdfDate}`             : "",
        eventLocation ? `Location: ${eventLocation}` : "",
        promoterName  ? `Organiser: ${promoterName}` : "",
        siteAreaStr   ? `Site Area: ${siteAreaStr}`  : "",
      ].filter(Boolean);
      pdf.setFont("helvetica", "normal"); pdf.setFontSize(9); pdf.setTextColor(...GREY);
      pdf.text(stripParts.join("   |   "), pw / 2, stripY + 5.3, { align: "center" });

      // Map image — fills between strip and footer
      const mapImgY = HEADER_H + STRIP_H;
      const mapImgH = ph - mapImgY - FOOTER_H;
      pdf.addImage(imgData, "PNG", 0, mapImgY, pw, mapImgH);

      // Footer with legend
      const footerY = ph - FOOTER_H;
      pdf.setFillColor(255, 255, 255);
      pdf.rect(0, footerY, pw, FOOTER_H, "F");
      pdf.setDrawColor(...BORDER); pdf.setLineWidth(0.3);
      pdf.line(0, footerY, pw, footerY);

      // Branding + page num
      pdf.setFont("helvetica", "normal"); pdf.setFontSize(8); pdf.setTextColor(...LGREY);
      pdf.text("Generated by Crewbase · trycrewbase.com", MARGIN, footerY + 9);
      pdf.text("1 / 2", pw - MARGIN, footerY + 9, { align: "right" });

      // Legend — centered
      const lgTextY = footerY + 9;
      const legendItems: { label: string; color?: [number,number,number]; emoji?: string }[] = [];
      const presentSpotTypes = new Set(zones.map((z) => z.spot_type));
      ZONE_TYPES.filter((z) => presentSpotTypes.has(z.id)).forEach((z) => {
        legendItems.push({ label: z.label, color: hexToRgb(z.color) });
      });
      [...new Set(markers.map((m) => m.marker_type))].forEach((mt) => {
        legendItems.push({ label: markerInfo(mt).label, emoji: markerInfo(mt).emoji });
      });

      if (legendItems.length > 0) {
        // Estimate total width and center
        const itemWidths = legendItems.map((li) => (li.label.length * 1.9) + (li.color ? 8 : 6) + 4);
        const totalW = itemWidths.reduce((s, w) => s + w, 0);
        let lx = pw / 2 - totalW / 2;
        pdf.setFontSize(7.5);
        legendItems.forEach((li, i) => {
          if (li.color) {
            pdf.setFillColor(...li.color);
            pdf.rect(lx, lgTextY - 3.2, 4, 3.5, "F");
            pdf.setTextColor(...DARK); pdf.text(li.label, lx + 5.5, lgTextY);
          } else {
            pdf.setTextColor(...DARK); pdf.text(`${li.emoji} ${li.label}`, lx, lgTextY);
          }
          lx += itemWidths[i];
        });
      }

      // ── PAGE 2: Details ───────────────────────────────────────────────────
      pdf.addPage();
      pdf.setFillColor(255, 255, 255);
      pdf.rect(0, 0, pw, ph, "F");

      drawPageHeader("EVENT DETAILS");

      const colW  = (pw - MARGIN * 3) / 2;   // each column width
      const lColX = MARGIN;
      const rColX = MARGIN * 2 + colW;
      const contentY = HEADER_H + 8;
      let ly = contentY;
      let ry = contentY;
      const ROW_H = 6.5;

      // Left: EVENT SUMMARY
      drawSectionHeading(lColX, ly, "Event Summary", colW); ly += 6;
      const totalVendorAssign = Object.values(zoneVendors).reduce((s, a) => s + a.length, 0);
      [
        ["Event Name", eventName || "—", false],
        ["Date",       pdfDate   || "—", false],
        ["Location",   eventLocation || "—", false],
        ["Organiser",  promoterName  || "—", false],
        ["Site Area",  siteAreaStr   || "—", true],
      ].forEach(([lbl, val, purple], i) => {
        drawTableRow(lColX, ly, colW, lbl as string, val as string, i % 2 === 1, purple as boolean);
        ly += ROW_H;
      });
      ly += 4;

      // Left: DOCUMENT CONTENTS
      drawSectionHeading(lColX, ly, "Document Contents", colW); ly += 6;
      [
        ["Zones",              String(zones.length)],
        ["Markers",            String(markers.length)],
        ["Vendor Assignments", String(totalVendorAssign)],
      ].forEach(([lbl, val], i) => {
        drawTableRow(lColX, ly, colW, lbl, val, i % 2 === 1);
        ly += ROW_H;
      });
      ly += 4;

      // Left: ZONE LEGEND
      const presentZones = ZONE_TYPES.filter((zt) => presentSpotTypes.has(zt.id));
      if (presentZones.length > 0) {
        drawSectionHeading(lColX, ly, "Zone Legend", colW); ly += 6;
        presentZones.forEach((zt, i) => {
          const [r, g, b] = hexToRgb(zt.color);
          if (i % 2 === 1) { pdf.setFillColor(...ROW_ALT); pdf.rect(lColX, ly - 4.5, colW, ROW_H, "F"); }
          pdf.setFillColor(r, g, b);
          pdf.rect(lColX + 2, ly - 3, 4, 3.5, "F");
          pdf.setFont("helvetica", "normal"); pdf.setFontSize(9); pdf.setTextColor(...GREY);
          pdf.text(zt.label, lColX + 9, ly);
          // area total for this zone type
          const typeArea = zones
            .filter((z) => z.spot_type === zt.id && z.area_sqm != null)
            .reduce((s, z) => s + (z.area_sqm ?? 0), 0);
          if (typeArea > 0) {
            const areaLabel = typeArea >= 10000
              ? `${(typeArea / 10000).toFixed(2)} ha`
              : `${Math.round(typeArea)} m²`;
            pdf.setFont("helvetica", "bold"); pdf.setTextColor(...DARK);
            pdf.text(areaLabel, lColX + colW - 2, ly, { align: "right" });
            pdf.setFont("helvetica", "normal");
          }
          ly += ROW_H;
        });
        ly += 4;
      }

      // Left: CUSTOM FIELDS
      const filteredCustom = customFields.filter((f) => f.label.trim());
      if (filteredCustom.length > 0) {
        drawSectionHeading(lColX, ly, "Additional Fields", colW); ly += 6;
        filteredCustom.forEach(({ label, value }, i) => {
          drawTableRow(lColX, ly, colW, label, value || "—", i % 2 === 1);
          ly += ROW_H;
        });
      }

      // Right: EVENT OPERATIONS
      drawSectionHeading(rColX, ry, "Event Operations", colW); ry += 6;
      const OPS_ALL: [keyof OpsFields, string][] = [
        ["councilName","Council Name"],["expectedAttendance","Expected Attendance"],
        ["securityPersonnel","Security Personnel"],["firstAidStaff","First Aid Staff"],
        ["eventManagerName","Event Manager"],["eventManagerPhone","Manager Phone"],
        ["eventStartTime","Start Time"],["eventEndTime","End Time"],
        ["bumpInTime","Bump In"],["bumpOutTime","Bump Out"],
        ["toiletsTotal","Toilets Total"],["accessibleToilets","Accessible Toilets"],
        ["binsTotal","Bins Total"],["recyclingBins","Recycling Bins"],["generalBins","General Bins"],
        ["liveMusic","Live Music"],["alcohol","Alcohol"],
      ];
      const filledOps = OPS_ALL.filter(([key]) => {
        const v = ops[key];
        return v !== null && v !== "";
      });
      if (filledOps.length === 0) {
        pdf.setFont("helvetica", "normal"); pdf.setFontSize(9); pdf.setTextColor(...LGREY);
        pdf.text("No operational details provided.", rColX + 2, ry);
        ry += ROW_H;
      } else {
        filledOps.forEach(([key, lbl], i) => {
          const raw = ops[key];
          const val = typeof raw === "boolean" ? (raw ? "Yes" : "No") : String(raw);
          drawTableRow(rColX, ry, colW, lbl, val, i % 2 === 1);
          ry += ROW_H;
        });
      }

      // Footer page 2 with disclaimer
      const p2FooterY = ph - FOOTER_H;
      pdf.setDrawColor(...BORDER); pdf.setLineWidth(0.3);
      pdf.line(0, p2FooterY, pw, p2FooterY);
      pdf.setFont("helvetica", "normal"); pdf.setFontSize(7.5); pdf.setTextColor(...LGREY);
      pdf.text(
        "This document is generated by Crewbase. Please verify all requirements with your local council before submission.",
        MARGIN, p2FooterY + 6,
        { maxWidth: pw - MARGIN * 2 - 20 },
      );
      pdf.setFontSize(8);
      pdf.text("2 / 2", pw - MARGIN, p2FooterY + 9, { align: "right" });

      const safeName = (eventName || "event").replace(/[^a-zA-Z0-9\s]/g, "").replace(/\s+/g, "-").toLowerCase().slice(0, 30);
      pdf.save(`site-plan-${safeName}-${eventDate || "undated"}.pdf`);
    } finally {
      setExporting(false);
    }
  }

  // ── Derived ───────────────────────────────────────────────────────────────

  const selectedZone = zones.find((z) => z.id === selectedZoneId) ?? null;
  const selectedMkr  = markers.find((m) => m.id === selectedMkrId) ?? null;
  const isDrawing    = mode !== "view";

  const instructionText = () => {
    if (mode === "drawing_boundary" || mode === "drawing_zone")
      return "Click to add points • Double-click to complete • Press Escape to cancel";
    if (mode === "placing_marker")
      return `Click on map to place ${markerInfo(drawMarkerType).label} • Escape to cancel`;
    if (mode === "quick_zone")
      return "Click on map to place shape • Escape to cancel";
    return "";
  };

  if (authLoading) {
    return <div className="flex items-center justify-center h-screen" style={{ background: "#0a0a0a" }}><span className="text-zinc-500 text-sm">Loading…</span></div>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", background: "#0a0a0a" }}>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className="flex items-center justify-between px-4 h-12 shrink-0" style={{ background: "#141414", borderBottom: "1px solid #222" }}>
        <div className="flex items-center gap-3">
          <Link href={`/dashboard/events/${id}`} className="flex items-center gap-1.5 text-sm text-zinc-400 hover:text-white transition-colors">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="15 18 9 12 15 6"/></svg>
            Back to Event
          </Link>
          <span className="text-zinc-700">·</span>
          <span className="text-sm font-semibold text-white">{eventName || "Site Map"}</span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setSidebarOpen((v) => !v)} className="h-8 px-3 rounded-lg text-xs font-medium transition-colors" style={{ background: "#222", color: "#888" }}>
            {sidebarOpen ? "Hide Panel" : "Show Panel"}
          </button>
          <button onClick={() => setShowSitePlan(true)} className="h-8 px-3 rounded-lg text-xs font-semibold text-white transition-colors flex items-center gap-1.5" style={{ background: "#5B4AE8" }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
            Generate Site Plan
          </button>
        </div>
      </header>

      {/* ── Body ───────────────────────────────────────────────────────────── */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden", minHeight: 0 }}>

        {/* ── Sidebar ──────────────────────────────────────────────────────── */}
        {sidebarOpen && (
          <aside style={{ width: 280, background: "#141414", borderRight: "1px solid #222", display: "flex", flexDirection: "column", overflowY: "auto", flexShrink: 0 }}>

            {/* Site Boundary */}
            <div className="px-4 py-4" style={{ borderBottom: "1px solid #222" }}>
              <p className="text-[10px] font-semibold uppercase tracking-widest mb-3" style={{ color: "#888" }}>Site Boundary</p>
              {boundary ? (
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs" style={{ background: "#ffffff0a", border: "1px dashed #ffffff33" }}>
                    <span style={{ color: "#aaa" }}>⬡</span>
                    <span style={{ color: "#aaa" }}>Boundary set</span>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={mode === "drawing_boundary" ? cancelMode : startDrawingBoundary}
                      className="flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors"
                      style={mode === "drawing_boundary" ? { background: "#5B4AE833", color: "#5B4AE8", border: "1px solid #5B4AE8" } : { background: "transparent", color: "#aaa", border: "1px solid #2a2a2a" }}>
                      {mode === "drawing_boundary" ? "Cancel" : "Edit Boundary"}
                    </button>
                    <button onClick={clearBoundary} disabled={isDrawing}
                      className="flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-40"
                      style={{ background: "transparent", color: "#E91E8C", border: "1px solid #E91E8C44" }}>
                      Clear Boundary
                    </button>
                  </div>
                </div>
              ) : (
                <button onClick={mode === "drawing_boundary" ? cancelMode : startDrawingBoundary}
                  className="w-full py-2 rounded-lg text-xs font-semibold transition-colors"
                  style={mode === "drawing_boundary" ? { background: "#5B4AE833", color: "#5B4AE8", border: "1px solid #5B4AE8" } : { background: "transparent", color: "#5B4AE8", border: "1px solid #5B4AE8" }}>
                  {mode === "drawing_boundary" ? "Cancel Boundary" : "Draw Boundary"}
                </button>
              )}
            </div>

            {/* Draw Zone */}
            <div className="px-4 py-4" style={{ borderBottom: "1px solid #222" }}>
              <p className="text-[10px] font-semibold uppercase tracking-widest mb-2" style={{ color: "#888" }}>Draw Zone</p>
              <div className="flex flex-col gap-1.5">
                {ZONE_TYPES.map((z) => {
                  const isActive = mode === "drawing_zone" && drawZoneType === z.id;
                  return (
                    <button key={z.id} onClick={() => isActive ? cancelMode() : startDrawingZone(z.id)}
                      className="flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs font-medium text-left transition-colors"
                      style={isActive ? { background: "#5B4AE822", color: "#5B4AE8", borderTop: "1px solid #5B4AE844", borderRight: "1px solid #5B4AE844", borderBottom: "1px solid #5B4AE844", borderLeft: "3px solid #5B4AE8" }
                               : { background: "transparent", color: "#aaa", border: "1px solid #2a2a2a" }}>
                      <span className="shrink-0">{z.emoji}</span>
                      <span className="flex-1">{z.label}</span>
                      {isActive && <span style={{ color: "#5B4AE8", opacity: 0.7, fontSize: 10 }}>Cancel</span>}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Quick Zone */}
            <div style={{ borderBottom: "1px solid #222" }}>
              <button onClick={() => setQuickZoneOpen((v) => !v)} className="w-full flex items-center justify-between px-4 py-3 text-xs font-semibold uppercase tracking-widest transition-colors" style={{ color: "#888" }}>
                Quick Zone
                <span style={{ fontSize: 10 }}>{quickZoneOpen ? "▲" : "▼"}</span>
              </button>
              {quickZoneOpen && (
                <div className="px-4 pb-4 flex flex-col gap-3">
                  <div className="flex flex-col gap-1.5">
                    {QUICK_SHAPES.map((s) => (
                      <button key={s} onClick={() => setQuickShape(s)}
                        className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-medium text-left transition-colors"
                        style={quickShape === s ? { background: "#5B4AE822", color: "#5B4AE8", border: "1px solid #5B4AE855" } : { background: "transparent", color: "#aaa", border: "1px solid #2a2a2a" }}>
                        {s}
                      </button>
                    ))}
                  </div>
                  <div className="flex flex-col gap-2">
                    {quickShape === "Rectangle" && (
                      <>
                        <QuickDimInput label="Length (m)" value={quickDims.length} onChange={(v) => setQuickDims((d) => ({ ...d, length: v }))} />
                        <QuickDimInput label="Width (m)"  value={quickDims.width}  onChange={(v) => setQuickDims((d) => ({ ...d, width: v }))} />
                      </>
                    )}
                    {quickShape === "Triangle" && (
                      <>
                        <QuickDimInput label="Base (m)"   value={quickDims.base}   onChange={(v) => setQuickDims((d) => ({ ...d, base: v }))} />
                        <QuickDimInput label="Height (m)" value={quickDims.height} onChange={(v) => setQuickDims((d) => ({ ...d, height: v }))} />
                      </>
                    )}
                    {(quickShape === "Hexagon" || quickShape === "Circle") && (
                      <QuickDimInput label="Diameter (m)" value={quickDims.diameter} onChange={(v) => setQuickDims((d) => ({ ...d, diameter: v }))} />
                    )}
                  </div>
                  <button onClick={mode === "quick_zone" ? cancelMode : startQuickZone}
                    className="w-full py-2 rounded-lg text-xs font-semibold transition-colors"
                    style={mode === "quick_zone" ? { background: "#5B4AE833", color: "#5B4AE8", border: "1px solid #5B4AE8" } : { background: "#5B4AE8", color: "#fff" }}>
                    {mode === "quick_zone" ? "Cancel" : "Place Shape"}
                  </button>
                </div>
              )}
            </div>

            {/* Add Marker */}
            <div className="px-4 py-4" style={{ borderBottom: "1px solid #222" }}>
              <p className="text-[10px] font-semibold uppercase tracking-widest mb-2" style={{ color: "#888" }}>Add Marker</p>
              <div className="flex flex-col gap-1.5">
                {MARKER_TYPES.map((m) => {
                  const isActive = mode === "placing_marker" && drawMarkerType === m.id;
                  return (
                    <button key={m.id} onClick={() => isActive ? cancelMode() : startPlacingMarker(m.id)}
                      className="flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs font-medium text-left transition-colors"
                      style={isActive ? { background: "#5B4AE822", color: "#5B4AE8", borderTop: "1px solid #5B4AE844", borderRight: "1px solid #5B4AE844", borderBottom: "1px solid #5B4AE844", borderLeft: "3px solid #5B4AE8" }
                               : { background: "transparent", color: "#aaa", border: "1px solid #2a2a2a" }}>
                      <span className="shrink-0">{m.emoji}</span>
                      <span className="flex-1">{m.label}</span>
                      {isActive && <span style={{ color: "#5B4AE8", opacity: 0.7, fontSize: 10 }}>Cancel</span>}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Zones list */}
            <div className="px-4 py-3" style={{ borderBottom: "1px solid #222" }}>
              <p className="text-[10px] font-semibold uppercase tracking-widest mb-2" style={{ color: "#888" }}>
                Zones <span className="ml-1" style={{ color: "#5B4AE8" }}>{zones.length}</span>
              </p>
              {zones.length === 0 ? (
                <p className="text-xs" style={{ color: "#555" }}>No zones yet.</p>
              ) : (
                <div className="flex flex-col gap-1">
                  {zones.map((z) => {
                    const info = zoneInfo(z.spot_type);
                    return (
                      <button key={z.id} onClick={() => { flyToZone(z); setSelectedZoneId(z.id); setSelectedMkrId(null); }}
                        className="flex items-start gap-2 px-2 py-2 rounded-lg text-left w-full transition-colors"
                        style={{ background: selectedZoneId === z.id ? "#222" : "transparent" }}>
                        <span className="text-base shrink-0 mt-0.5">{info.emoji}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium truncate" style={{ color: "#fff" }}>{z.name || info.label}</p>
                          {z.area_sqm && <p className="text-[10px] mt-0.5" style={{ color: "#555" }}>{fmtArea(z.area_sqm)}</p>}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Markers list */}
            <div className="px-4 py-3" style={{ borderBottom: "1px solid #222" }}>
              <p className="text-[10px] font-semibold uppercase tracking-widest mb-2" style={{ color: "#888" }}>
                Markers <span className="ml-1" style={{ color: "#5B4AE8" }}>{markers.length}</span>
              </p>
              {markers.length === 0 ? (
                <p className="text-xs" style={{ color: "#555" }}>No markers yet.</p>
              ) : (
                <div className="flex flex-col gap-1">
                  {markers.map((mk) => {
                    const info = markerInfo(mk.marker_type);
                    return (
                      <button key={mk.id} onClick={() => { flyToMarker(mk); setSelectedMkrId(mk.id); setSelectedZoneId(null); }}
                        className="flex items-center gap-2 px-2 py-2 rounded-lg text-left w-full transition-colors"
                        style={{ background: selectedMkrId === mk.id ? "#222" : "transparent" }}>
                        <span className="text-base shrink-0">{info.emoji}</span>
                        <p className="text-xs font-medium truncate" style={{ color: "#fff" }}>{mk.name || info.label}</p>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Reset */}
            <div className="px-4 py-4 mt-auto">
              <button onClick={() => setShowResetConfirm(true)} className="w-full py-2 rounded-lg text-xs font-semibold transition-colors" style={{ background: "#E91E8C22", color: "#E91E8C", border: "1px solid #E91E8C44" }}>
                Reset All
              </button>
            </div>
          </aside>
        )}

        {/* ── Map ──────────────────────────────────────────────────────────── */}
        <div style={{ flex: 1, position: "relative", minHeight: 0 }}>
          <div ref={mapContainerRef} style={{ position: "absolute", inset: 0 }} />

          {/* Location search */}
          <div className="absolute z-10" style={{ top: 12, left: 12, width: 260 }}>
            <div className="relative">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#888" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              <input
                value={searchQuery}
                onChange={(e) => handleSearchInput(e.target.value)}
                onFocus={() => { if (searchResults.length > 0) setShowSearchResults(true); }}
                onBlur={() => setTimeout(() => setShowSearchResults(false), 150)}
                placeholder="Search location…"
                className="w-full pl-9 pr-3 py-2 rounded-xl text-xs text-white outline-none"
                style={{ background: "#141414cc", border: "1px solid #333", backdropFilter: "blur(8px)" }}
              />
            </div>
            {showSearchResults && searchResults.length > 0 && (
              <div className="mt-1 rounded-xl overflow-hidden shadow-xl" style={{ background: "#141414", border: "1px solid #333" }}>
                {searchResults.slice(0, 5).map((r, i) => (
                  <button key={i} onMouseDown={() => selectSearchResult(r.center)}
                    className="w-full text-left px-3 py-2 text-xs transition-colors hover:bg-white/5"
                    style={{ color: "#ccc", borderBottom: i < searchResults.length - 1 ? "1px solid #222" : "none" }}>
                    {r.place_name}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Instruction banner */}
          {isDrawing && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium" style={{ background: "#141414cc", border: "1px solid #333", color: "#fff", backdropFilter: "blur(8px)" }}>
              <span style={{ color: mode === "drawing_zone" ? zoneInfo(drawZoneType).color : "#ffffff88" }}>●</span>
              {instructionText()}
              <button onClick={cancelMode} className="ml-2 text-xs px-2 py-1 rounded-lg" style={{ background: "#E91E8C22", color: "#E91E8C", border: "1px solid #E91E8C44" }}>
                Cancel
              </button>
            </div>
          )}

          {/* Loading overlay */}
          {dataLoading && (
            <div className="absolute inset-0 z-20 flex items-center justify-center" style={{ background: "#0a0a0a99" }}>
              <span className="text-sm" style={{ color: "#888" }}>Loading map…</span>
            </div>
          )}

          {/* Zone detail sheet */}
          {selectedZone && (
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 rounded-xl p-5 shadow-2xl" style={{ background: "#141414", border: "1px solid #333", minWidth: 300, maxWidth: 400, width: "90%" }}>
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="text-2xl">{zoneInfo(selectedZone.spot_type).emoji}</span>
                  <div>
                    <p className="font-semibold text-sm" style={{ color: "#fff" }}>{selectedZone.name || zoneInfo(selectedZone.spot_type).label}</p>
                    <p className="text-xs" style={{ color: "#888" }}>
                      {zoneInfo(selectedZone.spot_type).label}{selectedZone.area_sqm ? ` · ${fmtArea(selectedZone.area_sqm)}` : ""}
                    </p>
                  </div>
                </div>
                <button onClick={() => setSelectedZoneId(null)} className="text-zinc-600 hover:text-zinc-400 mt-0.5">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              </div>

              {/* Vendor list */}
              <div className="mb-3">
                <p className="text-[10px] font-semibold uppercase tracking-widest mb-1.5" style={{ color: "#555" }}>Vendors</p>
                {(zoneVendors[selectedZone.id] ?? []).length === 0 ? (
                  <p className="text-xs" style={{ color: "#444" }}>None assigned</p>
                ) : (
                  <div className="flex flex-col gap-1">
                    {(zoneVendors[selectedZone.id] ?? []).map((vid) => {
                      const v = vendors.find((v) => v.id === vid);
                      if (!v) return null;
                      return (
                        <div key={vid} className="flex items-center justify-between px-2.5 py-1.5 rounded-lg" style={{ background: "#0a0a0a", border: "1px solid #222" }}>
                          <span className="text-xs" style={{ color: "#ccc" }}>{v.name}</span>
                          <button onClick={() => removeZoneVendor(selectedZone.id, vid)} className="text-xs ml-2" style={{ color: "#E91E8C" }}>✕</button>
                        </div>
                      );
                    })}
                  </div>
                )}
                {/* Add vendor */}
                {vendors.filter((v) => !(zoneVendors[selectedZone.id] ?? []).includes(v.id)).length > 0 && (
                  <div className="mt-1.5">
                    {addVendorZoneId === selectedZone.id ? (
                      <select onChange={(e) => { if (e.target.value) addZoneVendor(selectedZone.id, e.target.value); }}
                        defaultValue=""
                        className="w-full px-2.5 py-1.5 rounded-lg text-xs outline-none"
                        style={{ background: "#0a0a0a", border: "1px solid #5B4AE8", color: "#ccc" }}>
                        <option value="" disabled>Select vendor…</option>
                        {vendors.filter((v) => !(zoneVendors[selectedZone.id] ?? []).includes(v.id)).map((v) => (
                          <option key={v.id} value={v.id}>{v.name}</option>
                        ))}
                      </select>
                    ) : (
                      <button onClick={() => setAddVendorZoneId(selectedZone.id)} className="text-xs mt-1" style={{ color: "#5B4AE8" }}>+ Add Vendor</button>
                    )}
                  </div>
                )}
              </div>

              <div className="flex gap-2">
                <button onClick={() => editZone(selectedZone)} className="flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors" style={{ background: "transparent", color: "#aaa", border: "1px solid #2a2a2a" }}>Edit Zone</button>
                <button onClick={() => deleteZone(selectedZone.id)} className="flex-1 py-1.5 rounded-lg text-xs font-semibold transition-colors" style={{ background: "#E91E8C22", color: "#E91E8C", border: "1px solid #E91E8C44" }}>Delete Zone</button>
              </div>
            </div>
          )}

          {/* Marker detail sheet */}
          {selectedMkr && (
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 rounded-xl px-5 py-4 flex items-center gap-4 shadow-2xl" style={{ background: "#141414", border: "1px solid #333", minWidth: 260 }}>
              <span className="text-2xl shrink-0">{markerInfo(selectedMkr.marker_type).emoji}</span>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm" style={{ color: "#fff" }}>{selectedMkr.name || markerInfo(selectedMkr.marker_type).label}</p>
                <p className="text-xs mt-0.5" style={{ color: "#888" }}>{markerInfo(selectedMkr.marker_type).label}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button onClick={() => deleteMarker(selectedMkr.id)} className="text-xs px-3 py-1.5 rounded-lg font-semibold" style={{ background: "#E91E8C22", color: "#E91E8C", border: "1px solid #E91E8C44" }}>Delete</button>
                <button onClick={() => setSelectedMkrId(null)} className="text-zinc-600 hover:text-zinc-400">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Save Zone Modal ────────────────────────────────────────────────── */}
      {pendingSpot && !pendingSpot.isBoundary && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4" style={{ background: "rgba(0,0,0,0.8)" }}>
          <div className="w-full max-w-sm rounded-2xl p-6" style={{ background: "#141414", border: "1px solid #222" }}>
            <div className="flex items-center gap-2 mb-4">
              <span className="text-xl">{zoneInfo(saveZoneType).emoji}</span>
              <h3 className="font-semibold text-white">Save Zone</h3>
            </div>
            <div className="flex flex-col gap-3 mb-5">
              {/* Zone type selector */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium uppercase tracking-wider" style={{ color: "#888" }}>Zone Type</label>
                <select value={saveZoneType} onChange={(e) => setSaveZoneType(e.target.value)}
                  className="rounded-lg px-3.5 py-2.5 text-sm outline-none"
                  style={{ background: "#0a0a0a", border: "1px solid #2a2a2a", color: "#fff" }}>
                  {ZONE_TYPES.map((z) => <option key={z.id} value={z.id}>{z.emoji} {z.label}</option>)}
                </select>
              </div>
              <div className="flex items-center justify-between px-3.5 py-2.5 rounded-lg text-sm" style={{ background: "#0a0a0a", border: "1px solid #2a2a2a" }}>
                <span style={{ color: "#888" }}>Area</span>
                <span className="font-medium text-white">{fmtArea(pendingSpot.area)}</span>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium uppercase tracking-wider" style={{ color: "#888" }}>Label (required)</label>
                <input value={saveZoneLabel} onChange={(e) => setSaveZoneLabel(e.target.value)}
                  placeholder={`e.g. ${zoneInfo(saveZoneType).label} A`}
                  className="rounded-lg px-3.5 py-2.5 text-sm text-white outline-none"
                  style={{ background: "#0a0a0a", border: "1px solid #2a2a2a" }}
                  onFocus={(e) => (e.target.style.borderColor = "#5B4AE8")}
                  onBlur={(e) => (e.target.style.borderColor = "#2a2a2a")} />
              </div>
              {vendors.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium uppercase tracking-wider" style={{ color: "#888" }}>Assign Vendors</label>
                  <div className="flex flex-col gap-1 max-h-32 overflow-y-auto">
                    {vendors.map((v) => (
                      <label key={v.id} className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg cursor-pointer" style={{ border: "1px solid #2a2a2a" }}>
                        <input type="checkbox" checked={selectedVendorIds.includes(v.id)}
                          onChange={(e) => setSelectedVendorIds((prev) => e.target.checked ? [...prev, v.id] : prev.filter((x) => x !== v.id))}
                          className="accent-purple-500" />
                        <span className="text-xs" style={{ color: "#ccc" }}>{v.name}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="flex gap-3">
              <button onClick={() => setPendingSpot(null)} className="flex-1 h-10 rounded-lg text-sm font-medium" style={{ border: "1px solid #2a2a2a", color: "#888" }}>Discard</button>
              <button onClick={saveZone} disabled={saving || !saveZoneLabel.trim()} className="flex-1 h-10 rounded-lg text-sm font-semibold text-white disabled:opacity-50" style={{ background: "#5B4AE8" }}>
                {saving ? "Saving…" : "Save Zone"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Save Boundary Modal ────────────────────────────────────────────── */}
      {pendingSpot?.isBoundary && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4" style={{ background: "rgba(0,0,0,0.8)" }}>
          <div className="w-full max-w-xs rounded-2xl p-6" style={{ background: "#141414", border: "1px solid #222" }}>
            <div className="flex items-center gap-2 mb-4">
              <span className="text-xl">⬡</span>
              <h3 className="font-semibold text-white">Save Site Boundary</h3>
            </div>
            <p className="text-xs mb-5" style={{ color: "#888" }}>
              Area: <span className="text-white font-medium">{fmtArea(pendingSpot.area)}</span>
              {boundary && <span className="ml-2" style={{ color: "#FFD60A" }}>Replaces existing boundary.</span>}
            </p>
            <div className="flex gap-3">
              <button onClick={() => setPendingSpot(null)} className="flex-1 h-10 rounded-lg text-sm font-medium" style={{ border: "1px solid #2a2a2a", color: "#888" }}>Discard</button>
              <button onClick={saveBoundary} disabled={saving} className="flex-1 h-10 rounded-lg text-sm font-semibold text-white disabled:opacity-50" style={{ background: "#5B4AE8" }}>
                {saving ? "Saving…" : "Save Boundary"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Save Marker Modal ──────────────────────────────────────────────── */}
      {pendingMarker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4" style={{ background: "rgba(0,0,0,0.8)" }}>
          <div className="w-full max-w-xs rounded-2xl p-6" style={{ background: "#141414", border: "1px solid #222" }}>
            <div className="flex items-center gap-2 mb-4">
              <span className="text-xl">{markerInfo(drawMarkerType).emoji}</span>
              <h3 className="font-semibold text-white">Save Marker</h3>
            </div>
            <div className="flex flex-col gap-3 mb-5">
              <div className="flex items-center justify-between px-3.5 py-2.5 rounded-lg text-sm" style={{ background: "#0a0a0a", border: "1px solid #2a2a2a" }}>
                <span style={{ color: "#888" }}>Type</span>
                <span className="font-medium text-white">{markerInfo(drawMarkerType).label}</span>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium uppercase tracking-wider" style={{ color: "#888" }}>Label (optional)</label>
                <input value={saveMarkerLabel} onChange={(e) => setSaveMarkerLabel(e.target.value)}
                  placeholder={`e.g. Main ${markerInfo(drawMarkerType).label}`}
                  className="rounded-lg px-3.5 py-2.5 text-sm text-white outline-none"
                  style={{ background: "#0a0a0a", border: "1px solid #2a2a2a" }}
                  onFocus={(e) => (e.target.style.borderColor = "#5B4AE8")}
                  onBlur={(e) => (e.target.style.borderColor = "#2a2a2a")} />
              </div>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setPendingMarker(null)} className="flex-1 h-10 rounded-lg text-sm font-medium" style={{ border: "1px solid #2a2a2a", color: "#888" }}>Discard</button>
              <button onClick={saveMarker} disabled={saving} className="flex-1 h-10 rounded-lg text-sm font-semibold text-white disabled:opacity-50" style={{ background: "#5B4AE8" }}>
                {saving ? "Saving…" : "Save Marker"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Site Plan Modal ───────────────────────────────────────────────── */}
      {showSitePlan && (
        <div className="fixed inset-0 z-[60] flex flex-col" style={{ background: "#0a0a0a" }}>
          {/* Header */}
          <div className="flex items-center justify-between px-6 h-14 shrink-0" style={{ background: "#141414", borderBottom: "1px solid #222" }}>
            <div className="flex items-center gap-3">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#5B4AE8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
              <span className="font-semibold text-white text-sm">Site Plan PDF</span>
            </div>
            <button onClick={() => setShowSitePlan(false)} className="text-zinc-600 hover:text-zinc-400 transition-colors">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>

          {/* Scrollable body */}
          <div className="flex-1 overflow-y-auto py-6">
            <div className="max-w-xl mx-auto px-4 flex flex-col gap-4">

              {/* EVENT SUMMARY */}
              <div className="rounded-xl p-5" style={{ background: "#141414", border: "1px solid #222" }}>
                <p className="text-[10px] font-semibold uppercase tracking-widest mb-4" style={{ color: "#888" }}>Event Summary</p>
                <div className="flex flex-col gap-3">
                  {([
                    ["Event",     eventName || "—"],
                    ["Date",      eventDate ? new Date(eventDate + "T00:00:00").toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" }) : "—"],
                    ["Location",  eventLocation || "—"],
                    ["Organiser", promoterName || "—"],
                  ] as [string, string][]).map(([lbl, val]) => (
                    <div key={lbl} className="flex items-center justify-between gap-4">
                      <span className="text-sm shrink-0" style={{ color: "#888" }}>{lbl}</span>
                      <span className="text-sm text-right" style={{ color: "#fff" }}>{val}</span>
                    </div>
                  ))}
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-sm shrink-0" style={{ color: "#888" }}>Site Area</span>
                    <span className="text-sm font-bold" style={{ color: boundary ? "#5B4AE8" : "#555" }}>
                      {boundary ? `${(calcAreaSqm(boundary.coordinates) / 10000).toFixed(2)} ha` : "—"}
                    </span>
                  </div>
                </div>
              </div>

              {/* DOCUMENT CONTENTS */}
              <div className="rounded-xl p-5" style={{ background: "#141414", border: "1px solid #222" }}>
                <p className="text-[10px] font-semibold uppercase tracking-widest mb-4" style={{ color: "#888" }}>Document Contents</p>
                <div className="flex flex-col gap-3">
                  {([
                    ["🗂", "Zones",               zones.length],
                    ["📍", "Markers",              markers.length],
                    ["🏪", "Vendor Assignments",   Object.values(zoneVendors).reduce((s, a) => s + a.length, 0)],
                  ] as [string, string, number][]).map(([emoji, lbl, count]) => (
                    <div key={lbl} className="flex items-center justify-between">
                      <span className="text-sm flex items-center gap-2">
                        <span>{emoji}</span>
                        <span style={{ color: "#888" }}>{lbl}</span>
                      </span>
                      <span className="inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-semibold text-white" style={{ background: "#222" }}>{count}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* EVENT OPERATIONS */}
              <div className="rounded-xl p-5" style={{ background: "#141414", border: "1px solid #222" }}>
                <p className="text-[10px] font-semibold uppercase tracking-widest mb-4" style={{ color: "#888" }}>Event Operations</p>
                <div className="flex flex-col gap-3">
                  {OPS_TEXT_FIELDS.map(([key, label, type]) => (
                    <OpsInputRow
                      key={key}
                      label={label}
                      value={(ops[key as keyof OpsFields] as string) ?? ""}
                      onChange={(v) => setOps((p) => ({ ...p, [key]: v }))}
                      type={type}
                    />
                  ))}
                  {/* Live Music toggle */}
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm shrink-0" style={{ color: "#888", minWidth: 150 }}>Live Music</span>
                    <div className="flex gap-2">
                      {([true, false] as const).map((v) => (
                        <button key={String(v)} onClick={() => setOps((p) => ({ ...p, liveMusic: v }))}
                          className="px-4 py-1.5 rounded-lg text-xs font-semibold transition-colors"
                          style={ops.liveMusic === v ? { background: "#5B4AE8", color: "#fff" } : { background: "#1a1a1a", color: "#888", border: "1px solid #222" }}>
                          {v ? "Yes" : "No"}
                        </button>
                      ))}
                    </div>
                  </div>
                  {/* Alcohol toggle */}
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm shrink-0" style={{ color: "#888", minWidth: 150 }}>Alcohol</span>
                    <div className="flex gap-2">
                      {([true, false] as const).map((v) => (
                        <button key={String(v)} onClick={() => setOps((p) => ({ ...p, alcohol: v }))}
                          className="px-4 py-1.5 rounded-lg text-xs font-semibold transition-colors"
                          style={ops.alcohol === v ? { background: "#5B4AE8", color: "#fff" } : { background: "#1a1a1a", color: "#888", border: "1px solid #222" }}>
                          {v ? "Yes" : "No"}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* Custom fields */}
              {customFields.map((f, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input value={f.label} onChange={(e) => setCustomFields((prev) => prev.map((x, j) => j === i ? { ...x, label: e.target.value } : x))}
                    placeholder="Field name"
                    className="flex-1 px-3 py-2 rounded-lg text-sm text-white outline-none"
                    style={{ background: "#1a1a1a", border: "1px solid #222" }} />
                  <input value={f.value} onChange={(e) => setCustomFields((prev) => prev.map((x, j) => j === i ? { ...x, value: e.target.value } : x))}
                    placeholder="Value"
                    className="flex-1 px-3 py-2 rounded-lg text-sm text-white outline-none"
                    style={{ background: "#1a1a1a", border: "1px solid #222" }} />
                  <button onClick={() => setCustomFields((prev) => prev.filter((_, j) => j !== i))} className="text-zinc-600 hover:text-zinc-400 shrink-0 transition-colors">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                  </button>
                </div>
              ))}

              {/* Add Custom Field */}
              <button onClick={() => setCustomFields((prev) => [...prev, { label: "", value: "" }])}
                className="w-full py-2.5 rounded-xl text-sm font-medium transition-colors"
                style={{ border: "1px dashed #5B4AE8", color: "#5B4AE8", background: "transparent" }}>
                + Add Custom Field
              </button>

              {/* Disclaimer */}
              <div className="rounded-xl px-4 py-3 flex items-start gap-3" style={{ border: "1px solid #222", background: "#ffffff05" }}>
                <span className="text-base shrink-0 mt-0.5">ℹ</span>
                <p className="text-xs leading-relaxed" style={{ color: "#555" }}>
                  This document is generated by Crewbase. Please verify all requirements with your local council before submission.
                </p>
              </div>

              {/* Generate PDF */}
              <button onClick={generateSitePlanPDF} disabled={exporting}
                className="w-full py-4 rounded-xl text-sm font-bold text-white transition-colors disabled:opacity-50"
                style={{ background: "#5B4AE8" }}>
                {exporting ? "Generating PDF…" : "Generate PDF"}
              </button>

              <div className="h-4" />
            </div>
          </div>
        </div>
      )}

      {/* ── Reset Confirm Modal ────────────────────────────────────────────── */}
      {showResetConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4" style={{ background: "rgba(0,0,0,0.8)" }}>
          <div className="w-full max-w-xs rounded-2xl p-6" style={{ background: "#141414", border: "1px solid #222" }}>
            <h3 className="font-semibold text-white mb-2">Reset Site Map?</h3>
            <p className="text-xs mb-5" style={{ color: "#888" }}>This will delete the boundary, all zones, and all markers. Cannot be undone.</p>
            <div className="flex gap-3">
              <button onClick={() => setShowResetConfirm(false)} className="flex-1 h-10 rounded-lg text-sm font-medium" style={{ border: "1px solid #2a2a2a", color: "#888" }}>Cancel</button>
              <button onClick={handleReset} className="flex-1 h-10 rounded-lg text-sm font-semibold" style={{ background: "#E91E8C22", color: "#E91E8C", border: "1px solid #E91E8C44" }}>
                Delete All
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Small helper component ─────────────────────────────────────────────────

function QuickDimInput({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <label className="text-xs shrink-0" style={{ color: "#888" }}>{label}</label>
      <input type="number" min="1" value={value}
        onChange={(e) => onChange(Math.max(1, Number(e.target.value)))}
        className="w-20 px-2.5 py-1.5 rounded-lg text-xs text-white outline-none text-right"
        style={{ background: "#0a0a0a", border: "1px solid #2a2a2a" }} />
    </div>
  );
}

function OpsInputRow({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (v: string) => void; type?: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm shrink-0" style={{ color: "#888", minWidth: 150 }}>{label}</span>
      <input type={type} value={value}
        onChange={(e) => onChange(e.target.value)}
        className="flex-1 px-3 py-1.5 rounded-lg text-sm text-white outline-none min-w-0 text-right"
        style={{ background: "#1a1a1a", border: "1px solid #222" }}
        onFocus={(e) => (e.target.style.borderColor = "#5B4AE8")}
        onBlur={(e) => (e.target.style.borderColor = "#222")} />
    </div>
  );
}
