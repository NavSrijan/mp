import math
import time
from typing import List, Dict, Any, Optional, Tuple
from collections import deque, defaultdict
import warnings
import asyncio

from fastapi import FastAPI, HTTPException, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import numpy as np
import h3
import httpx

app = FastAPI(title="Crowd Direction Predictor")

# Allow cross-origin requests for local dev
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ----------------------------- Models -----------------------------
class GatewayObs(BaseModel):
    id: str
    lon: float
    lat: float
    nearby_agents: int

class TowerObs(BaseModel):
    id: str
    lon: float
    lat: float
    radius: float
    nearby_agents: int

class TollObs(BaseModel):
    id: str
    lon: float
    lat: float
    nearby_agents: int
    fee: Optional[float] = None

class InfraSnapshot(BaseModel):
    timestamp: float
    agent_count: int
    gateways: List[GatewayObs]
    mobile_towers: List[TowerObs]
    toll_gates: List[TollObs] = []

class PredictRequest(BaseModel):
    snapshot: InfraSnapshot
    h3_resolution: int = 8  # moderate resolution
    top_k: int = 10
    simulation_backend: Optional[str] = None  # ignored when snapshot provided explicitly
    # When true, predict weight for all cells covering bbox/region using smoothing
    full_cover: bool = False
    # Optional bbox [min_lon, min_lat, max_lon, max_lat]; inferred from points if missing
    cover_bbox: Optional[List[float]] = None
    # Gaussian kernel sigma in km; 0 disables smoothing
    sigma_km: float = 1.0
    # Base prior weight added to each cell
    base_weight: float = 0.0

class TilePrediction(BaseModel):
    h3_index: str
    lon: float
    lat: float
    weight: float
    norm_weight: float

class PredictResponse(BaseModel):
    generated_at: float
    total_weight: float
    tiles: List[TilePrediction]

# ----------------------------- Helper Logic -----------------------------

def score_gateways(gateways: List[GatewayObs]) -> List[float]:
    # Weight based on local density (nearby_agents) + small base to keep presence
    densities = np.array([g.nearby_agents for g in gateways], dtype=float)
    return (densities + 1.0).tolist()

def score_towers(towers: List[TowerObs]) -> List[float]:
    # Coverage influence: nearby_agents scaled by radius (assuming larger radius implies broader draw)
    scores = []
    for t in towers:
        scores.append((t.nearby_agents + 1.0) * (t.radius ** 0.5))
    return scores

def score_tolls(tolls: List[TollObs]) -> List[float]:
    # Tolls might repel if fee present; invert fee effect
    scores = []
    for tg in tolls:
        base = tg.nearby_agents + 1.0
        if tg.fee is not None:
            base /= (1.0 + tg.fee/100.0)
        scores.append(base)
    return scores

def combine_points(snapshot: InfraSnapshot) -> List[Dict[str, Any]]:
    pts = []
    gw_scores = score_gateways(snapshot.gateways)
    tw_scores = score_towers(snapshot.mobile_towers)
    tl_scores = score_tolls(snapshot.toll_gates)
    for g, s in zip(snapshot.gateways, gw_scores):
        pts.append({'lon': g.lon, 'lat': g.lat, 'weight': s})
    for t, s in zip(snapshot.mobile_towers, tw_scores):
        pts.append({'lon': t.lon, 'lat': t.lat, 'weight': s})
    for tl, s in zip(snapshot.toll_gates, tl_scores):
        pts.append({'lon': tl.lon, 'lat': tl.lat, 'weight': s})
    return pts

def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 6371.0
    p1 = math.radians(lat1)
    p2 = math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dphi/2)**2 + math.cos(p1)*math.cos(p2)*math.sin(dl/2)**2
    c = 2*math.atan2(math.sqrt(a), math.sqrt(1-a))
    return R*c

def _deg_for_km_at_lat(km: float, lat: float) -> Tuple[float, float]:
    dlat = km / 111.0
    dlon = km / (111.0 * max(0.1, math.cos(math.radians(lat))))
    return dlat, dlon

def cover_hexes(res: int, bbox: Tuple[float, float, float, float]) -> List[str]:
    """Return all hex cells covering the bbox using H3 polygon fill when available."""
    min_lon, min_lat, max_lon, max_lat = bbox
    # Polygon rings: lon,lat for v3 polyfill; lat,lon for v4 polygon_to_cells.
    exterior_lonlat = [
        [min_lon, min_lat],
        [max_lon, min_lat],
        [max_lon, max_lat],
        [min_lon, max_lat],
        [min_lon, min_lat],
    ]
    try:
        if hasattr(h3, 'polygon_to_cells'):
            # Convert to lat,lon for v4
            exterior_latlon = [[lat, lon] for lon, lat in exterior_lonlat]
            cells = h3.polygon_to_cells(exterior_latlon, res)  # type: ignore[attr-defined]
            return list(cells)
        if hasattr(h3, 'polyfill'):
            geojson = {"type": "Polygon", "coordinates": [exterior_lonlat]}
            cells = h3.polyfill(geojson, res)  # type: ignore[attr-defined]
            return list(cells)
    except Exception:
        pass
    # Fallback to grid sampling if polygon fill not available
    mid_lat = (min_lat + max_lat) / 2.0
    step_lat_deg, step_lon_deg = _deg_for_km_at_lat(0.4, mid_lat)
    seen = set()
    lat = min_lat
    while lat <= max_lat + 1e-9:
        lon = min_lon
        while lon <= max_lon + 1e-9:
            try:
                seen.add(_cell_index(lat, lon, res))
            except Exception:
                pass
            lon += step_lon_deg
        lat += step_lat_deg
    return list(seen)

def _cell_index(lat: float, lon: float, res: int) -> str:
    # h3 v4: latlng_to_cell; h3 v3: geo_to_h3
    if hasattr(h3, 'latlng_to_cell'):
        return h3.latlng_to_cell(lat, lon, res)  # type: ignore[attr-defined]
    return h3.geo_to_h3(lat, lon, res)  # type: ignore[attr-defined]

def _cell_boundary(hidx: str):
    # h3 v4: cell_to_boundary; h3 v3: h3_to_geo_boundary
    if hasattr(h3, 'cell_to_boundary'):
        return h3.cell_to_boundary(hidx)  # type: ignore[attr-defined]
    return h3.h3_to_geo_boundary(hidx)  # type: ignore[attr-defined]

def distribute_to_hex(pts: List[Dict[str, Any]], res: int) -> Dict[str, float]:
    acc: Dict[str, float] = {}
    for p in pts:
        h = _cell_index(p['lat'], p['lon'], res)
        acc[h] = acc.get(h, 0.0) + p['weight']
    return acc

def hex_centroid(hidx: str) -> Tuple[float, float]:
    boundary = _cell_boundary(hidx)
    lats = [b[0] for b in boundary]
    lons = [b[1] for b in boundary]
    return (sum(lons)/len(lons), sum(lats)/len(lats))

def distribute_full_cover(pts: List[Dict[str, Any]], res: int, bbox: Tuple[float, float, float, float], sigma_km: float, base_weight: float) -> Dict[str, float]:
    cells = cover_hexes(res, bbox)
    acc: Dict[str, float] = {}
    sig2 = max(1e-9, sigma_km*sigma_km)
    for h in cells:
        lon, lat = hex_centroid(h)
        w = base_weight
        if sigma_km > 0 and pts:
            for p in pts:
                d = haversine_km(lat, lon, p['lat'], p['lon'])
                w += p['weight'] * math.exp(-(d*d)/(2*sig2))
        else:
            # no smoothing: count only points in the same cell
            w += 0.0
        acc[h] = w
    return acc

# ------------- Hotspot detection & ARIMA forecasting utils -------------

def _neighbors(hidx: str) -> List[str]:
    try:
        if hasattr(h3, 'grid_disk'):
            raw = h3.grid_disk(hidx, 1)  # type: ignore[attr-defined]
            flat = []
            if isinstance(raw, (list, tuple, set)):
                for r in raw:
                    if isinstance(r, (list, tuple, set)):
                        flat.extend(list(r))
                    else:
                        flat.append(r)
            else:
                flat = [raw]
            return [n for n in flat if n != hidx]
        if hasattr(h3, 'k_ring'):
            flat = list(h3.k_ring(hidx, 1))  # type: ignore[attr-defined]
            return [n for n in flat if n != hidx]
    except Exception:
        pass
    return []

def _local_maxima(weights: Dict[str, float]) -> List[str]:
    peaks = []
    for h, w in weights.items():
        is_peak = True
        for n in _neighbors(h):
            if weights.get(n, -float('inf')) > w:
                is_peak = False
                break
        if is_peak:
            peaks.append(h)
    return peaks

# In-memory history for ARIMA per tile per scenario
HISTORY_MAXLEN = 60
HISTORY: Dict[str, Dict[str, deque]] = defaultdict(lambda: defaultdict(lambda: deque(maxlen=HISTORY_MAXLEN)))

def _history_key(res: int, full_cover: bool, bbox: Optional[Tuple[float, float, float, float]], backend_url: str) -> str:
    bbox_key = (
        f"{bbox[0]:.5f},{bbox[1]:.5f},{bbox[2]:.5f},{bbox[3]:.5f}" if bbox else 'pts'
    )
    return f"res={res}|cover={int(full_cover)}|bbox={bbox_key}|backend={backend_url}"

def _update_history(key: str, hex_weights: Dict[str, float], cap_cells: int = 200):
    # Track only top N cells to keep memory/compute bounded
    top_items = sorted(hex_weights.items(), key=lambda x: x[1], reverse=True)[:max(1, cap_cells)]
    series_map = HISTORY[key]
    for h, w in top_items:
        series_map[h].append(float(w))

def _forecast_arima_for_cells(key: str, candidates: List[str], order: Tuple[int, int, int], min_points: int) -> Dict[str, float]:
    forecasts: Dict[str, float] = {}
    # Lazy import to avoid heavy dep if unused
    try:
        from statsmodels.tsa.arima.model import ARIMA  # type: ignore
        try:
            from statsmodels.tools.sm_exceptions import ConvergenceWarning as SMConvergenceWarning  # type: ignore
        except Exception:
            SMConvergenceWarning = Warning  # type: ignore
    except Exception:
        # Fall back: simple last value
        for h in candidates:
            series = HISTORY[key].get(h)
            forecasts[h] = float(series[-1]) if series and len(series) > 0 else 0.0
        return forecasts
    for h in candidates:
        series = HISTORY[key].get(h)
        if not series or len(series) < max(3, min_points):
            forecasts[h] = float(series[-1]) if series and len(series) > 0 else 0.0
            continue
        arr = np.asarray(series, dtype=float)
        try:
            model = ARIMA(arr, order=order, trend='n', enforce_stationarity=False, enforce_invertibility=False)
            with warnings.catch_warnings():
                warnings.simplefilter("ignore")
                warnings.simplefilter("ignore", category=SMConvergenceWarning)
                fitted = model.fit()
            f = float(fitted.forecast(steps=1)[0])
            if not np.isfinite(f):
                raise ValueError("non-finite forecast")
            forecasts[h] = max(0.0, f)
        except Exception:
            # EWMA fallback for robustness
            alpha = 0.6
            ema = float(arr[0])
            for v in arr[1:]:
                ema = alpha*float(v) + (1.0-alpha)*ema
            forecasts[h] = max(0.0, float(ema))
    return forecasts

# ----------------------------- API -----------------------------

@app.post('/predict', response_model=PredictResponse)
def predict(req: PredictRequest):
    start = time.time()
    pts = combine_points(req.snapshot)
    # Determine bbox for full-cover if needed
    if req.full_cover:
        if req.cover_bbox and len(req.cover_bbox) == 4:
            bbox = (float(req.cover_bbox[0]), float(req.cover_bbox[1]), float(req.cover_bbox[2]), float(req.cover_bbox[3]))
        else:
            if pts:
                lons = [p['lon'] for p in pts]
                lats = [p['lat'] for p in pts]
                min_lon, max_lon = min(lons), max(lons)
                min_lat, max_lat = min(lats), max(lats)
            else:
                min_lon, max_lon = 75.7264, 75.8264
                min_lat, max_lat = 23.1324, 23.2324
            dlat, dlon = _deg_for_km_at_lat(2.0, (min_lat+max_lat)/2)
            bbox = (min_lon - dlon, min_lat - dlat, max_lon + dlon, max_lat + dlat)
        hex_weights = distribute_full_cover(pts, req.h3_resolution, bbox, req.sigma_km, req.base_weight)
    else:
        hex_weights = distribute_to_hex(pts, req.h3_resolution)
    # Normalize weights
    total_weight = float(sum(hex_weights.values())) or 1.0
    items = []
    for hidx, w in hex_weights.items():
        lon, lat = hex_centroid(hidx)
        items.append(TilePrediction(
            h3_index=hidx,
            lon=lon,
            lat=lat,
            weight=w,
            norm_weight=w/total_weight
        ))
    # Sort and take top_k
    items.sort(key=lambda x: x.weight, reverse=True)
    if req.top_k and req.top_k > 0:
        items = items[:req.top_k]
    return PredictResponse(
        generated_at=time.time(),
        total_weight=total_weight,
        tiles=items
    )

@app.get('/predict-live', response_model=PredictResponse)
async def predict_live(
    h3_resolution: int = 8,
    top_k: int = 20,
    backend_url: str = "http://localhost:8000",
    full_cover: bool = False,
    sigma_km: float = 1.0,
    base_weight: float = 0.0,
    cover_bbox: Optional[str] = None,
    use_arima: bool = False,
    arima_order: str = "1,1,0",
    arima_min_points: int = 8,
    arima_max_cells: int = 150,
    hotspots_only: bool = False,
    min_percentile: float = 0.0,
):
    """Fetch current infrastructure snapshot from simulation backend and produce prediction."""
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            r = await client.get(f"{backend_url.rstrip('/')}/infra-stats")
            r.raise_for_status()
            snap = r.json()
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Failed to fetch snapshot: {e}")
    # Adapt snapshot JSON into InfraSnapshot model
    try:
        isnap = InfraSnapshot(
            timestamp=time.time(),
            agent_count=snap.get('agent_count', 0),
            gateways=[GatewayObs(id=g['id'], lon=g['lon'], lat=g['lat'], nearby_agents=g.get('nearby_agents',0)) for g in snap.get('gateways', [])],
            mobile_towers=[TowerObs(id=t['id'], lon=t['lon'], lat=t['lat'], radius=t.get('radius', 0.01), nearby_agents=t.get('nearby_agents',0)) for t in snap.get('mobile_towers', [])],
            toll_gates=[TollObs(id=tl['id'], lon=tl['lon'], lat=tl['lat'], nearby_agents=tl.get('nearby_agents',0), fee=tl.get('fee')) for tl in snap.get('toll_gates', [])]
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Malformed snapshot: {e}")
    bbox_list = None
    if cover_bbox:
        try:
            parts = [float(x) for x in cover_bbox.split(',')]
            if len(parts) == 4:
                bbox_list = parts
        except Exception:
            bbox_list = None
    req = PredictRequest(
        snapshot=isnap,
        h3_resolution=h3_resolution,
        top_k=top_k,
        full_cover=full_cover,
        sigma_km=sigma_km,
        base_weight=base_weight,
        cover_bbox=bbox_list,
    )
    # Compute weights as in predict(), but keep full map for ARIMA/hotspots
    pts = combine_points(req.snapshot)
    # Establish bbox if full_cover for history key and consistency
    bbox_tuple: Optional[Tuple[float, float, float, float]] = None
    if req.full_cover:
        if req.cover_bbox and len(req.cover_bbox) == 4:
            bbox_tuple = (float(req.cover_bbox[0]), float(req.cover_bbox[1]), float(req.cover_bbox[2]), float(req.cover_bbox[3]))
        else:
            if pts:
                lons = [p['lon'] for p in pts]
                lats = [p['lat'] for p in pts]
                min_lon, max_lon = min(lons), max(lons)
                min_lat, max_lat = min(lats), max(lats)
            else:
                min_lon, max_lon = 75.7264, 75.8264
                min_lat, max_lat = 23.1324, 23.2324
            dlat, dlon = _deg_for_km_at_lat(2.0, (min_lat+max_lat)/2)
            bbox_tuple = (min_lon - dlon, min_lat - dlat, max_lon + dlon, max_lat + dlat)
        hex_weights = distribute_full_cover(pts, req.h3_resolution, bbox_tuple, req.sigma_km, req.base_weight)
    else:
        hex_weights = distribute_to_hex(pts, req.h3_resolution)

    # Update history and optionally forecast with ARIMA
    key = _history_key(req.h3_resolution, req.full_cover, bbox_tuple, backend_url)
    _update_history(key, hex_weights, cap_cells=max(10, arima_max_cells))

    if use_arima:
        try:
            order_parts = tuple(int(x.strip()) for x in arima_order.split(','))  # type: ignore
            if len(order_parts) != 3:
                order_parts = (1, 1, 0)
        except Exception:
            order_parts = (1, 1, 0)
        # Forecast only top cells for compute budget
        candidate_cells = [h for h, _ in sorted(hex_weights.items(), key=lambda x: x[1], reverse=True)[:max(1, arima_max_cells)]]
        forecasts = _forecast_arima_for_cells(key, candidate_cells, order_parts, arima_min_points)
        # Merge back: use forecast where available
        for h, f in forecasts.items():
            hex_weights[h] = f

    # Hotspot post-processing
    if hotspots_only:
        # Optional percentile threshold
        vals = np.array(list(hex_weights.values()), dtype=float)
        thr = np.percentile(vals, min(100.0, max(0.0, float(min_percentile)))) if len(vals) and min_percentile > 0 else -float('inf')
        peaks = _local_maxima(hex_weights)
        hex_weights = {h: w for h, w in hex_weights.items() if h in peaks and w >= thr}

    # Build response
    total_weight = float(sum(hex_weights.values())) or 1.0
    items: List[TilePrediction] = []
    for hidx, w in hex_weights.items():
        lon, lat = hex_centroid(hidx)
        items.append(TilePrediction(
            h3_index=hidx,
            lon=lon,
            lat=lat,
            weight=w,
            norm_weight=w/total_weight
        ))
    items.sort(key=lambda x: x.weight, reverse=True)
    if req.top_k and req.top_k > 0:
        items = items[:req.top_k]
    return PredictResponse(
        generated_at=time.time(),
        total_weight=total_weight,
        tiles=items
    )

@app.get('/predict-ujjain', response_model=PredictResponse)
async def predict_ujjain(
    h3_resolution: int = 9,
    sigma_km: float = 0.8,
    base_weight: float = 0.0,
    backend_url: str = "http://localhost:8000",
    use_arima: bool = False,
    hotspots_only: bool = False,
    min_percentile: float = 0.0,
    top_k: int = 0,
):
    """Full-cover prediction over an approximate Ujjain city bbox."""
    # Approx city bbox (expand slightly)
    bbox = [75.70, 23.12, 75.86, 23.26]
    resp = await predict_live(
        h3_resolution=h3_resolution,
        top_k=top_k,
        backend_url=backend_url,
        full_cover=True,
        sigma_km=sigma_km,
        base_weight=base_weight,
        cover_bbox=','.join(str(x) for x in bbox),
        use_arima=use_arima,
        hotspots_only=hotspots_only,
        min_percentile=min_percentile,
    )
    return resp

@app.get('/health')
def health():
    return {'status': 'ok'}

# ----------------------------- WebSocket Streaming -----------------------------

@app.websocket('/ws-predict')
async def ws_predict(ws: WebSocket):
    """Stream predictions to clients. Parameters are provided via query string.

    Supported query params (strings):
      - backend_url (default: http://localhost:8000)
      - h3_resolution (int, default 9)
      - full_cover (bool, default true)
      - sigma_km (float, default 0.8)
      - base_weight (float, default 0.0)
      - use_arima (bool, default false)
      - hotspots_only (bool, default false)
      - min_percentile (float, default 0)
      - top_k (int, default 0)
      - cover_bbox (string "minLon,minLat,maxLon,maxLat") optional
      - interval_ms (int, default 2000)
    """
    await ws.accept()
    try:
        # Parse query string
        from urllib.parse import parse_qs
        qs = parse_qs((ws.url.query or ''), keep_blank_values=True)
        def get_str(name, default=None):
            v = qs.get(name, [default])[0]
            return v if v is not None else default
        def get_int(name, default):
            try:
                return int(get_str(name, default))
            except Exception:
                return default
        def get_float(name, default):
            try:
                return float(get_str(name, default))
            except Exception:
                return default
        def get_bool(name, default):
            v = get_str(name, None)
            if v is None:
                return default
            return str(v).lower() in {'1','true','yes','on'}

        backend_url = get_str('backend_url', 'http://localhost:8000')
        res = get_int('h3_resolution', 9)
        full_cover = get_bool('full_cover', True)
        sigma_km = get_float('sigma_km', 0.8)
        base_weight = get_float('base_weight', 0.0)
        use_arima = get_bool('use_arima', False)
        hotspots_only = get_bool('hotspots_only', False)
        min_percentile = get_float('min_percentile', 0.0)
        top_k = get_int('top_k', 0)
        cover_bbox = get_str('cover_bbox', None)
        interval_ms = max(250, get_int('interval_ms', 2000))

        while True:
            try:
                resp = await predict_live(
                    h3_resolution=res,
                    top_k=top_k,
                    backend_url=backend_url,
                    full_cover=full_cover,
                    sigma_km=sigma_km,
                    base_weight=base_weight,
                    cover_bbox=cover_bbox,
                    use_arima=use_arima,
                    hotspots_only=hotspots_only,
                    min_percentile=min_percentile,
                )
                await ws.send_json(resp.dict())
            except Exception as e:
                await ws.send_json({'error': str(e)})
            await asyncio.sleep(interval_ms/1000.0)
    except Exception:
        try:
            await ws.close()
        except Exception:
            pass
