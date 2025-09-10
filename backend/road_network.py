"""Clean road network module with precomputed route bank for fast simulation.

Provides:
 - Loading (or downloading) a cached OSMnx drive network for Ujjain; synthetic grid fallback.
 - Shortest path routing returning list of [lon, lat] points (edge geometry expanded when present).
 - Optional k-shortest simple path variants (networkx.shortest_simple_paths) for diversity.
 - Nearest-node snapping with small quantized cache.
 - In‑memory precomputed route bank for instant assignment (no persistence here for simplicity).

Public methods used by the app:
 - build_route_from(lon, lat)
 - build_route_between(slon, slat, elon, elat)
 - build_route_between_variants(..., k)
 - precompute_route_bank(count)
 - get_precomputed_route()
 - get_precomputed_route_from(lon, lat)
 - nearest_node(), shortest_path_coords()
 - get_road_network() (module-level singleton)
"""
from __future__ import annotations

import math
import random
import threading
from pathlib import Path
from typing import Any, Dict, List, Tuple

try:  # Core dependency
    import networkx as nx  # type: ignore
except ImportError:  # pragma: no cover
    nx = None  # type: ignore
try:  # Optional heavy dependency
    import osmnx as ox  # type: ignore
except ImportError:  # pragma: no cover
    ox = None  # type: ignore

DATA_DIR = Path(__file__).parent / "data"
DATA_DIR.mkdir(exist_ok=True)
GRAPH_PATH = DATA_DIR / "ujjain_drive.graphml"

BOUNDING_BOX = {
    "min_lon": 75.7264,
    "max_lon": 75.8264,
    "min_lat": 23.1324,
    "max_lat": 23.2324,
}


class RoadNetwork:
    def __init__(self) -> None:
        if nx is None:
            raise RuntimeError("networkx is required")
        self.graph = None
        self.synthetic = False
        self._nearest_cache: Dict[Tuple[int, int], Any] = {}
        self.route_bank: List[List[List[float]]] = []
        self.routes_by_start: Dict[Any, List[List[List[float]]]] = {}
        self._load()

    # ---- Loading -------------------------------------------------------
    def _log(self, msg: str) -> None:
        print(f"[RoadNetwork] {msg}")

    def _load(self) -> None:
        if ox and nx:
            if GRAPH_PATH.exists():
                try:
                    self.graph = ox.load_graphml(GRAPH_PATH)
                    self._log("Loaded cached graphml")
                    return
                except Exception:  # pragma: no cover
                    self._log("Cached graph load failed; re-downloading")
            try:
                self._log("Downloading Ujjain drive network (one-time)...")
                self.graph = ox.graph_from_place("Ujjain, Madhya Pradesh, India", network_type="drive")
                ox.save_graphml(self.graph, GRAPH_PATH)
                self._log("Saved graphml cache")
                return
            except Exception as e:  # pragma: no cover
                self._log(f"Download failed ({e}); using synthetic grid")
        self._build_synthetic_grid()

    def _build_synthetic_grid(self, steps: int = 12) -> None:
        G = nx.Graph()
        lon_span = BOUNDING_BOX["max_lon"] - BOUNDING_BOX["min_lon"]
        lat_span = BOUNDING_BOX["max_lat"] - BOUNDING_BOX["min_lat"]
        for i in range(steps + 1):
            for j in range(steps + 1):
                lon = BOUNDING_BOX["min_lon"] + lon_span * (i / steps)
                lat = BOUNDING_BOX["min_lat"] + lat_span * (j / steps)
                G.add_node(f"n_{i}_{j}", x=lon, y=lat)
        for i in range(steps + 1):
            for j in range(steps + 1):
                nid = f"n_{i}_{j}"
                if i < steps:
                    right = f"n_{i+1}_{j}"
                    G.add_edge(nid, right, length=self._dist(G, nid, right))
                if j < steps:
                    up = f"n_{i}_{j+1}"
                    G.add_edge(nid, up, length=self._dist(G, nid, up))
        self.graph = G
        self.synthetic = True
        self._log(f"Synthetic grid built ({G.number_of_nodes()} nodes / {G.number_of_edges()} edges)")

    @staticmethod
    def _dist(G, u, v) -> float:
        ux, uy = G.nodes[u]["x"], G.nodes[u]["y"]
        vx, vy = G.nodes[v]["x"], G.nodes[v]["y"]
        return math.hypot(vx - ux, vy - uy)

    # ---- Core lookups --------------------------------------------------
    def node_coordinates(self, node) -> Tuple[float, float]:
        d = self.graph.nodes[node]
        return d["x"], d["y"]

    def nearest_node(self, lon: float, lat: float):
        key = (int(lon * 1e5), int(lat * 1e5))
        if key in self._nearest_cache:
            return self._nearest_cache[key]
        if ox and not self.synthetic:
            try:
                n = ox.distance.nearest_nodes(self.graph, lon, lat)  # type: ignore
                self._nearest_cache[key] = n
                return n
            except Exception:  # pragma: no cover
                pass
        best = None
        best_d = 1e30
        for n, data in self.graph.nodes(data=True):
            dx = lon - data["x"]
            dy = lat - data["y"]
            d = dx * dx + dy * dy
            if d < best_d:
                best_d = d
                best = n
        if best is not None:
            self._nearest_cache[key] = best
        return best

    # ---- Path construction --------------------------------------------
    def shortest_path_coords(self, a, b) -> List[List[float]]:
        path = nx.shortest_path(self.graph, a, b, weight="length")
        coords: List[List[float]] = []
        for i in range(len(path) - 1):
            u, v = path[i], path[i + 1]
            ed = self.graph.get_edge_data(u, v)
            edge = ed[0] if isinstance(ed, dict) and 0 in ed else ed
            if edge and edge.get("geometry") is not None:
                for lo, la in edge["geometry"].coords:
                    if not coords or coords[-1] != [lo, la]:
                        coords.append([lo, la])
            else:
                lon_u, lat_u = self.node_coordinates(u)
                lon_v, lat_v = self.node_coordinates(v)
                if not coords or coords[-1] != [lon_u, lat_u]:
                    coords.append([lon_u, lat_u])
                coords.append([lon_v, lat_v])
        # dedup consecutive
        out: List[List[float]] = []
        for pt in coords:
            if not out or out[-1] != pt:
                out.append(pt)
        return out

    # ---- Public routing helpers ---------------------------------------
    def build_route_from(self, lon: float, lat: float) -> List[List[float]]:
        s = self.nearest_node(lon, lat)
        if s is None:
            return []
        nodes = list(self.graph.nodes)
        if len(nodes) < 2:
            return []
        e = s
        for _ in range(10):
            e = random.choice(nodes)
            if e != s:
                break
        if e == s:
            return []
        return self.shortest_path_coords(s, e)

    def build_route_between(self, slon: float, slat: float, elon: float, elat: float) -> List[List[float]]:
        s = self.nearest_node(slon, slat)
        e = self.nearest_node(elon, elat)
        if s is None or e is None:
            return []
        if s == e:
            # try pick a different destination
            nodes = list(self.graph.nodes)
            for _ in range(10):
                cand = random.choice(nodes)
                if cand != s:
                    e = cand
                    break
            if s == e:
                return []
        return self.shortest_path_coords(s, e)

    def build_route_between_variants(self, slon: float, slat: float, elon: float, elat: float, k: int = 5) -> List[List[List[float]]]:
        if k <= 1:
            base = self.build_route_between(slon, slat, elon, elat)
            return [base] if base else []
        try:
            from networkx.algorithms.simple_paths import shortest_simple_paths  # type: ignore
        except Exception:
            base = self.build_route_between(slon, slat, elon, elat)
            return [base] if base else []
        s = self.nearest_node(slon, slat)
        e = self.nearest_node(elon, elat)
        if s is None or e is None or s == e:
            base = self.build_route_between(slon, slat, elon, elat)
            return [base] if base else []
        variants: List[List[List[float]]] = []
        try:
            for i, path in enumerate(shortest_simple_paths(self.graph, s, e, weight="length")):
                if i >= k:
                    break
                coords: List[List[float]] = []
                for j in range(len(path) - 1):
                    u, v = path[j], path[j + 1]
                    ed = self.graph.get_edge_data(u, v)
                    edge = ed[0] if isinstance(ed, dict) and 0 in ed else ed
                    if edge and edge.get("geometry") is not None:
                        for lo, la in edge["geometry"].coords:
                            if not coords or coords[-1] != [lo, la]:
                                coords.append([lo, la])
                    else:
                        lon_u, lat_u = self.node_coordinates(u)
                        lon_v, lat_v = self.node_coordinates(v)
                        if not coords or coords[-1] != [lon_u, lat_u]:
                            coords.append([lon_u, lat_u])
                        coords.append([lon_v, lat_v])
                if coords:
                    variants.append(coords)
        except Exception:
            pass
        if not variants:
            base = self.build_route_between(slon, slat, elon, elat)
            return [base] if base else []
        return variants

    # ---- Route bank ----------------------------------------------------
    def precompute_route_bank(self, count: int = 500, max_attempts: int = 2500) -> None:
        if not self.graph or self.route_bank:
            return
        nodes = list(self.graph.nodes)
        attempts = 0
        added = 0
        while added < count and attempts < max_attempts:
            attempts += 1
            try:
                a, b = random.sample(nodes, 2)
                coords = self.shortest_path_coords(a, b)
            except Exception:
                continue
            if not coords or len(coords) < 2:
                continue
            self.route_bank.append(coords)
            self.routes_by_start.setdefault(a, []).append(coords)
            added += 1
            if added % 100 == 0:
                self._log(f"Route bank {added}/{count}")
        self._log(f"Route bank ready: {len(self.route_bank)} routes (attempts={attempts})")

    def get_precomputed_route(self) -> List[List[float]]:
        if self.route_bank:
            return list(random.choice(self.route_bank))
        # fallback: build one quickly
        return self.build_route_from(75.7764, 23.1824)

    def get_precomputed_route_from(self, lon: float, lat: float) -> List[List[float]]:
        node = self.nearest_node(lon, lat)
        if node in self.routes_by_start and self.routes_by_start[node]:
            return list(random.choice(self.routes_by_start[node]))
        return self.get_precomputed_route()


_instance: RoadNetwork | None = None
_lock = threading.Lock()


def get_road_network() -> RoadNetwork:
    global _instance
    if _instance is None:
        with _lock:
            if _instance is None:
                _instance = RoadNetwork()
    return _instance

