
import asyncio
import random
import uuid
import os
import time
from typing import Optional, List, Dict, Any
from typing import Literal
import json

import requests
from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
try:  # Support running as a package (uvicorn backend.main:app) or within folder (uvicorn main:app)
    from .road_network import get_road_network  # type: ignore
except ImportError:  # pragma: no cover
    from road_network import get_road_network  # type: ignore

app = FastAPI()

# Allow all origins for simplicity in this hackathon project
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

USE_LOCAL_ROAD_NETWORK = os.getenv('USE_LOCAL_ROAD_NETWORK', '1').lower() in {'1', 'true', 'yes'}
ORS_API_KEY = os.getenv('ORS_API_KEY', '').strip()
if USE_LOCAL_ROAD_NETWORK:
    print('[INFO] Using local cached road network for routing (Ujjain).')
elif not ORS_API_KEY:
    print('[WARN] ORS_API_KEY not set and USE_LOCAL_ROAD_NETWORK disabled; routes may fail.')

simulation_state = {}
route_cache = {}
variant_cache = {}
route_future_limit = 50  # max unresolved route futures
ROUTE_BANK_TARGET = 600
SPEED_MULTIPLIER = 1.0  # Global runtime speed scale for all agents

class CrowdRequest(BaseModel):
    number: int

class CrowdRouteRequest(BaseModel):
    number: int = 1
    source_lat: float
    source_lon: float
    dest_lat: float
    dest_lon: float

class EventConfig(BaseModel):
    source_lat: float
    source_lon: float
    dest_lat: float
    dest_lon: float
    wave_size: int = 100
    wave_interval_seconds: float = 10.0
    dwell_min_seconds: float = 30.0
    dwell_max_seconds: float = 90.0
    exit_after_dwell: bool = True
    max_waves: Optional[int] = None  # None = infinite

class RandomTrafficConfig(BaseModel):
    target_agents: int = 200          # Aim to keep at least this many random agents alive
    max_agents: int = 400             # Cap to avoid runaway growth
    spawn_interval_seconds: float = 2.0
    batch_min: int = 5
    batch_max: int = 15
    min_speed: float = 0.0003         # Per-agent speed range
    max_speed: float = 0.0008

class SpeedConfig(BaseModel):
    multiplier: float

# --- Infrastructure / Static Points Models ---

class GatewayCreate(BaseModel):
    lon: float
    lat: float
    name: Optional[str] = None

class MobileTowerCreate(BaseModel):
    lon: float
    lat: float
    radius: float  # coverage radius (same coordinate units)
    name: Optional[str] = None

class TollGateCreate(BaseModel):
    lon: float
    lat: float
    name: Optional[str] = None
    fee: Optional[float] = None


event_state: Dict[str, Any] = {
    'active': False,
    'config': None,
    'next_wave_time': None,
    'waves_launched': 0,
    'event_id': None,
}

random_traffic_state: Dict[str, Any] = {
    'active': False,
    'config': None,
    'next_spawn_time': None,
}

# In-memory registries for requested entities
gateways: Dict[str, Dict[str, Any]] = {}
mobile_towers: Dict[str, Dict[str, Any]] = {}
toll_gates: Dict[str, Dict[str, Any]] = {}

# Persistence configuration
BASE_DIR = os.path.dirname(__file__)
INFRA_STATE_FILE = os.path.join(BASE_DIR, 'infra_state.json')
_infra_lock = asyncio.Lock()

async def save_infra_state():
    """Persist gateways, mobile towers, and toll gates to a JSON file (atomic write)."""
    data = {
        'gateways': list(gateways.values()),
        'mobile_towers': list(mobile_towers.values()),
        'toll_gates': list(toll_gates.values()),
        'version': 1,
        'updated': time.time()
    }
    tmp_path = INFRA_STATE_FILE + '.tmp'
    async with _infra_lock:
        try:
            with open(tmp_path, 'w') as f:
                json.dump(data, f, indent=2)
            os.replace(tmp_path, INFRA_STATE_FILE)
        except Exception as e:  # pragma: no cover
            print(f"[ERROR] Failed saving infra state: {e}")

async def load_infra_state():
    """Load infrastructure state from JSON file if present."""
    if not os.path.exists(INFRA_STATE_FILE):
        return False
    async with _infra_lock:
        try:
            with open(INFRA_STATE_FILE, 'r') as f:
                data = json.load(f)
            # Clear current
            gateways.clear(); mobile_towers.clear(); toll_gates.clear()
            for item in data.get('gateways', []):
                gid = item.get('id') or str(uuid.uuid4())
                gateways[gid] = {**item, 'id': gid}
            for item in data.get('mobile_towers', []):
                tid = item.get('id') or str(uuid.uuid4())
                mobile_towers[tid] = {**item, 'id': tid}
            for item in data.get('toll_gates', []):
                tg_id = item.get('id') or str(uuid.uuid4())
                toll_gates[tg_id] = {**item, 'id': tg_id}
            print(f"[INFO] Loaded infra state: {len(gateways)} gateways, {len(mobile_towers)} towers, {len(toll_gates)} tolls")
            return True
        except Exception as e:  # pragma: no cover
            print(f"[ERROR] Failed loading infra state: {e}")
            return False

class Agent(BaseModel):
    id: str
    lat: float
    lon: float
    route: Optional[List[List[float]]] = None  # list of [lon, lat]
    route_step: int = 0

def get_route(start_lon: float, start_lat: float, end_lon: float, end_lat: float):
    """Return a road-constrained route.

    Local network: snap (start_lon,start_lat) to nearest node and pick a random destination path.
    Legacy (ORS): keep external service routing when local network disabled.
    """
    if USE_LOCAL_ROAD_NETWORK:
        try:
            rn = get_road_network()
            # If an explicit destination different from zeros is passed, attempt direct routing
            if any([end_lon, end_lat]):
                # Prefer a single shortest; variant logic for diversity handled elsewhere
                route = rn.build_route_between(start_lon, start_lat, end_lon, end_lat)
                if route:
                    return route
            return rn.build_route_from(start_lon, start_lat)
        except Exception as e:  # pragma: no cover
            print(f"[ERROR] Local road network routing failed: {e}")
            return None
    cache_key = (start_lon, start_lat, end_lon, end_lat)
    if cache_key in route_cache:
        return route_cache[cache_key]
    if not ORS_API_KEY:
        return None
    headers = {'Authorization': ORS_API_KEY,'Content-Type': 'application/json'}
    params = {'start': f'{start_lon},{start_lat}','end': f'{end_lon},{end_lat}'}
    try:
        response = requests.get('https://api.openrouteservice.org/v2/directions/driving-car', params=params, headers=headers)
        response.raise_for_status()
        data = response.json()
        route = [pt for pt in data['features'][0]['geometry']['coordinates']]
        route_cache[cache_key] = route
        return route
    except Exception as e:  # pragma: no cover
        print(f"[ERROR] ORS routing failed: {e}")
        return None

def move_towards(lon1: float, lat1: float, lon2: float, lat2: float, speed: float = 0.0005):
    """Move from (lon1, lat1) towards (lon2, lat2) by a small step. Returns (lon, lat)."""
    lon_diff = lon2 - lon1
    lat_diff = lat2 - lat1
    distance = (lat_diff ** 2 + lon_diff ** 2) ** 0.5
    if distance < speed:
        return lon2, lat2
    new_lon = lon1 + (lon_diff / distance) * speed
    new_lat = lat1 + (lat_diff / distance) * speed
    return new_lon, new_lat

async def async_get_route(start_lon: float, start_lat: float, end_lon: float, end_lat: float):
    return await asyncio.to_thread(get_route, start_lon, start_lat, end_lon, end_lat)

async def movement_loop():
    while True:
        unresolved = 0
        for agent_id, agent in list(simulation_state.items()):
            # Resolve pending futures
            fut = agent.get('route_future')
            if fut and fut.done():
                try:
                    r = fut.result()
                    if r and len(r) > 1:
                        agent['lon'], agent['lat'] = r[0]
                        agent['route'] = r[1:]
                        agent['route_step'] = 0
                except Exception:
                    pass
                agent.pop('route_future', None)
            elif fut:
                unresolved += 1
                continue  # skip movement until route ready

            if not agent.get('route'):
                # Event lifecycle management
                if agent.get('type') == 'event':
                    phase = agent.get('phase')
                    now = time.time()
                    if phase == 'to_dest':
                        dwell_duration = agent['dwell_min'] + random.random() * (agent['dwell_max'] - agent['dwell_min'])
                        agent['dwell_until'] = now + dwell_duration
                        agent['phase'] = 'dwelling'
                        continue
                    if phase == 'dwelling':
                        if now >= agent.get('dwell_until', 0):
                            if agent.get('exit_after_dwell'):
                                if 'route_future' not in agent:
                                    exit_lon, exit_lat = pick_exit_coordinate()
                                    agent['route_future'] = asyncio.create_task(async_get_route(agent['lon'], agent['lat'], exit_lon, exit_lat))
                                continue
                            else:
                                agent['phase'] = 'settled'
                                continue
                        continue
                    if phase == 'exiting':
                        # Completed exit: if route empty they'll be removed
                        continue
                    if phase == 'settled':
                        continue
                # Non-event route refresh
                if agent.get('stop_at_end'):
                    continue
                if USE_LOCAL_ROAD_NETWORK:
                    # Instant assignment from precomputed bank
                    rn = get_road_network()
                    route = rn.get_precomputed_route_from(agent['lon'], agent['lat'])
                    if route and len(route) > 1:
                        agent['lon'], agent['lat'] = route[0]
                        agent['route'] = route[1:]
                        agent['route_step'] = 0
                    continue
                else:
                    if 'route_future' not in agent and unresolved < route_future_limit:
                        start_lon, start_lat = agent['lon'], agent['lat']
                        end_lon = random.uniform(75.7264, 75.8264)
                        end_lat = random.uniform(23.1324, 23.2324)
                        agent['route_future'] = asyncio.create_task(async_get_route(start_lon, start_lat, end_lon, end_lat))
                continue

            # Move along route
            if agent.get('route'):
                try:
                    current_target_lon, current_target_lat = agent['route'][agent['route_step']]
                except (IndexError, TypeError):
                    agent['route'] = None
                    continue
                step_speed = agent.get('speed', 0.0005) * float(SPEED_MULTIPLIER)
                new_lon, new_lat = move_towards(agent['lon'], agent['lat'], current_target_lon, current_target_lat, speed=step_speed)
                agent['lon'], agent['lat'] = new_lon, new_lat
                if new_lon == current_target_lon and new_lat == current_target_lat:
                    agent['route_step'] += 1
                    if agent['route_step'] >= len(agent['route']):
                        # Route done
                        if agent.get('type') == 'event' and agent.get('phase') == 'exiting':
                            del simulation_state[agent_id]
                            continue
                        agent['route'] = None
        await asyncio.sleep(0.05)

async def broadcast_loop():
    while True:
        if connected_clients:
            payload = [
                {
                    'id': agent_id,
                    'lat': a['lat'],
                    'lon': a['lon'],
                    'type': a.get('type', 'generic'),
                    'phase': a.get('phase'),
                    'speed': a.get('speed'),
                    'stop': a.get('stop_at_end', False)
                }
                for agent_id, a in simulation_state.items()
            ]
            # Fire and forget; if slow client, exception ignored
            await asyncio.gather(*(c.send_json(payload) for c in connected_clients), return_exceptions=True)
        await asyncio.sleep(0.1)  # broadcast at 10Hz to reduce pressure

connected_clients = set()

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """Handle WebSocket connections."""
    await websocket.accept()
    connected_clients.add(websocket)
    try:
        while True:
            await websocket.receive_text()
    except Exception:
        connected_clients.remove(websocket)

@app.post("/add-crowd")
async def add_crowd(request: CrowdRequest):
    """Add a number of new agents to the simulation."""
    added = 0
    for _ in range(request.number):
        agent_id = str(uuid.uuid4())
        if USE_LOCAL_ROAD_NETWORK:
            seed_lon = random.uniform(75.7264, 75.8264) + random.uniform(-1e-5, 1e-5)
            seed_lat = random.uniform(23.1324, 23.2324) + random.uniform(-1e-5, 1e-5)
            route = get_route(seed_lon, seed_lat, 0, 0)
            if not route or len(route) < 2:
                continue
            start_lon, start_lat = route[0]
        else:
            start_lon = random.uniform(75.7264, 75.8264)
            start_lat = random.uniform(23.1324, 23.2324)
            end_lon = random.uniform(75.7264, 75.8264)
            end_lat = random.uniform(23.1324, 23.2324)
            route = get_route(start_lon, start_lat, end_lon, end_lat) or [[end_lon, end_lat]]

        simulation_state[agent_id] = {
            "id": agent_id,
            "lat": start_lat,
            "lon": start_lon,
            "route": route,
            "route_step": 0,
            "speed": random.uniform(0.0003, 0.0008)
        }
        added += 1
    print(f"[INFO] Added {added} agents. Total now: {len(simulation_state)}")
    return {"message": f"Added {added} agents.", "total": len(simulation_state)}

@app.post("/add-crowd-route")
async def add_crowd_route(request: CrowdRouteRequest):
    """Add agents that follow the shortest road route between a specified source and destination."""
    if request.number < 1:
        return {"message": "No agents added (number < 1)", "total": len(simulation_state)}

    rn = get_road_network()
    # Heavy k-shortest path computation offloaded + cached to avoid blocking event loop
    key = (round(request.source_lon,5), round(request.source_lat,5), round(request.dest_lon,5), round(request.dest_lat,5), 5)
    if key in variant_cache:
        variants = variant_cache[key]
    else:
        variants = await asyncio.to_thread(rn.build_route_between_variants, request.source_lon, request.source_lat, request.dest_lon, request.dest_lat, 5)
        if variants:
            variant_cache[key] = variants
    if not variants:
        return {"message": "Failed to compute route", "total": len(simulation_state)}
    added = 0
    for _ in range(request.number):
        variant = random.choice(variants)
        if len(variant) < 2:
            continue
        # Possible detour: 25% chance extend with a random midpoint detour
        if random.random() < 0.25:
            try:
                rn = get_road_network()
                mid_idx = random.randint(1, max(1, len(variant)//2))
                mid_lon, mid_lat = variant[mid_idx]
                # choose random other node and build detour to destination
                end_lon, end_lat = variant[-1]
                detour_node_lon = mid_lon + random.uniform(-0.003, 0.003)
                detour_node_lat = mid_lat + random.uniform(-0.003, 0.003)
                detour_part = rn.build_route_between(mid_lon, mid_lat, detour_node_lon, detour_node_lat)
                back_part = rn.build_route_between(detour_node_lon, detour_node_lat, end_lon, end_lat)
                if detour_part and back_part:
                    variant = variant[:mid_idx] + detour_part[1:] + back_part[1:]
            except Exception:
                pass
        source_lon, source_lat = variant[0]
        travel_path = variant[1:]
        agent_id = str(uuid.uuid4())
        simulation_state[agent_id] = {
            'id': agent_id,
            'lat': source_lat,
            'lon': source_lon,
            'route': list(travel_path),
            'route_step': 0,
            'stop_at_end': True,
            'speed': random.uniform(0.0003, 0.0008)
        }
        added += 1
    print(f"[INFO] Added {added} routed agents from single source to destination. Total now: {len(simulation_state)}")
    return {"message": f"Added {added} routed agents (variants).", "variants_used": len(variants), "total": len(simulation_state)}

@app.post("/route-preview")
async def route_preview(request: CrowdRouteRequest):
    """Return a prospective route (without spawning agents) for UI preview."""
    route = get_route(request.source_lon, request.source_lat, request.dest_lon, request.dest_lat)
    if not route or len(route) < 2:
        return {"ok": False, "message": "No route"}
    return {"ok": True, "points": route, "count": len(route)}

# --- Event Crowd Logic ---

def pick_exit_coordinate():
    # Expand bounding box to choose an exit target beyond city region
    min_lon, max_lon = 75.7264, 75.8264
    min_lat, max_lat = 23.1324, 23.2324
    margin = 0.02
    side = random.choice(['N', 'S', 'E', 'W'])
    if side == 'N':
        return random.uniform(min_lon, max_lon), max_lat + margin
    if side == 'S':
        return random.uniform(min_lon, max_lon), min_lat - margin
    if side == 'E':
        return max_lon + margin, random.uniform(min_lat, max_lat)
    return min_lon - margin, random.uniform(min_lat, max_lat)

async def event_wave_loop():
    while True:
        await asyncio.sleep(0.5)
        if not event_state['active']:
            continue
        cfg: EventConfig = event_state['config']
        now = time.time()
        if event_state['next_wave_time'] and now >= event_state['next_wave_time']:
            # Launch a wave
            rn = get_road_network()
            key = (round(cfg.source_lon,5), round(cfg.source_lat,5), round(cfg.dest_lon,5), round(cfg.dest_lat,5), 6)
            if key in variant_cache:
                variants = variant_cache[key]
            else:
                variants = await asyncio.to_thread(rn.build_route_between_variants, cfg.source_lon, cfg.source_lat, cfg.dest_lon, cfg.dest_lat, 6)
                if variants:
                    variant_cache[key] = variants
            if not variants:
                print('[WARN] Event wave route computation failed.')
                event_state['next_wave_time'] = now + cfg.wave_interval_seconds
                continue
            for _ in range(cfg.wave_size):
                route = random.choice(variants)
                if len(route) < 2:
                    continue
                # With probability 0.3, add a detour to vary length
                if random.random() < 0.3:
                    try:
                        mid_idx = random.randint(1, max(1, len(route)//2))
                        mid_lon, mid_lat = route[mid_idx]
                        end_lon, end_lat = route[-1]
                        detour_lon = mid_lon + random.uniform(-0.004, 0.004)
                        detour_lat = mid_lat + random.uniform(-0.004, 0.004)
                        detour_part = rn.build_route_between(mid_lon, mid_lat, detour_lon, detour_lat)
                        back_part = rn.build_route_between(detour_lon, detour_lat, end_lon, end_lat)
                        if detour_part and back_part:
                            route = route[:mid_idx] + detour_part[1:] + back_part[1:]
                    except Exception:
                        pass
                source_lon, source_lat = route[0]
                travel_path = route[1:]
                agent_id = str(uuid.uuid4())
                simulation_state[agent_id] = {
                    'id': agent_id,
                    'lat': source_lat,
                    'lon': source_lon,
                    'route': list(travel_path),
                    'route_step': 0,
                    'type': 'event',
                    'phase': 'to_dest',
                    'dwell_min': cfg.dwell_min_seconds,
                    'dwell_max': cfg.dwell_max_seconds,
                    'exit_after_dwell': cfg.exit_after_dwell,
                    'event_id': event_state['event_id'],
                    'speed': random.uniform(0.0003, 0.0008)
                }
            event_state['waves_launched'] += 1
            print(f"[INFO] Event wave spawned ({event_state['waves_launched']}); total agents: {len(simulation_state)}")
            # Schedule next wave
            if cfg.max_waves is not None and event_state['waves_launched'] >= cfg.max_waves:
                event_state['active'] = False
                print('[INFO] Event completed (max_waves reached).')
            else:
                event_state['next_wave_time'] = now + cfg.wave_interval_seconds

@app.post('/start-event')
async def start_event(cfg: EventConfig):
    event_state['active'] = True
    event_state['config'] = cfg
    event_state['waves_launched'] = 0
    event_state['event_id'] = str(uuid.uuid4())
    event_state['next_wave_time'] = time.time()  # immediate first wave
    return {'message': 'Event started', 'event_id': event_state['event_id']}

@app.post('/stop-event')
async def stop_event():
    event_state['active'] = False
    return {'message': 'Event stopped'}

@app.get('/event-status')
async def event_status():
    cfg = event_state['config']
    return {
        'active': event_state['active'],
        'waves_launched': event_state['waves_launched'],
        'next_wave_time': event_state['next_wave_time'],
        'config': cfg.dict() if cfg else None,
        'event_id': event_state['event_id']
    }

# --- Random Background Traffic ---

async def random_traffic_loop():
    while True:
        await asyncio.sleep(0.5)
        if not random_traffic_state['active']:
            continue
        cfg: RandomTrafficConfig = random_traffic_state['config']
        now = time.time()
        if random_traffic_state['next_spawn_time'] and now >= random_traffic_state['next_spawn_time']:
            current_random_agents = sum(1 for a in simulation_state.values() if a.get('type') == 'random')
            total_agents = len(simulation_state)
            if total_agents >= cfg.max_agents:
                # Skip spawn this cycle, schedule next
                random_traffic_state['next_spawn_time'] = now + cfg.spawn_interval_seconds
                continue
            if current_random_agents < cfg.target_agents:
                batch = random.randint(cfg.batch_min, cfg.batch_max)
                batch = min(batch, cfg.max_agents - total_agents)
                spawned = 0
                spawn_tasks = []
                rn = get_road_network() if USE_LOCAL_ROAD_NETWORK else None
                for _ in range(batch):
                    agent_id = str(uuid.uuid4())
                    if USE_LOCAL_ROAD_NETWORK and rn:
                        route = rn.get_precomputed_route()
                        if not route or len(route) < 2:
                            continue
                        start_lon, start_lat = route[0]
                        simulation_state[agent_id] = {
                            'id': agent_id,
                            'lat': start_lat,
                            'lon': start_lon,
                            'route': route[1:],
                            'route_step': 0,
                            'type': 'random',
                            'speed': random.uniform(cfg.min_speed, cfg.max_speed)
                        }
                    else:
                        seed_lon = random.uniform(75.7264, 75.8264)
                        seed_lat = random.uniform(23.1324, 23.2324)
                        simulation_state[agent_id] = {
                            'id': agent_id,
                            'lat': seed_lat,
                            'lon': seed_lon,
                            'route': None,
                            'route_step': 0,
                            'type': 'random',
                            'speed': random.uniform(cfg.min_speed, cfg.max_speed)
                        }
                        simulation_state[agent_id]['route_future'] = asyncio.create_task(async_get_route(seed_lon, seed_lat, 0, 0))
                    spawned += 1
                if spawned:
                    print(f"[INFO] Random spawn batch={spawned} total_random={current_random_agents + spawned} total_agents={len(simulation_state)}")
            random_traffic_state['next_spawn_time'] = now + cfg.spawn_interval_seconds

@app.post('/start-random-traffic')
async def start_random_traffic(cfg: RandomTrafficConfig):
    random_traffic_state['active'] = True
    random_traffic_state['config'] = cfg
    random_traffic_state['next_spawn_time'] = time.time()  # immediate
    print(f"[INFO] Random traffic started target={cfg.target_agents} max={cfg.max_agents} interval={cfg.spawn_interval_seconds}")
    return {'message': 'Random traffic started'}

@app.post('/stop-random-traffic')
async def stop_random_traffic():
    random_traffic_state['active'] = False
    return {'message': 'Random traffic stopped'}

@app.get('/random-traffic-status')
async def random_traffic_status():
    cfg = random_traffic_state['config']
    return {
        'active': random_traffic_state['active'],
        'next_spawn_time': random_traffic_state['next_spawn_time'],
        'config': cfg.dict() if cfg else None,
        'random_agent_count': sum(1 for a in simulation_state.values() if a.get('type') == 'random')
    }

@app.get('/random-debug')
async def random_debug():
    cfg = random_traffic_state.get('config')
    now = time.time()
    return {
        'active': random_traffic_state['active'],
        'now': now,
        'next_spawn_time': random_traffic_state['next_spawn_time'],
        'time_until_spawn': None if not random_traffic_state['next_spawn_time'] else random_traffic_state['next_spawn_time'] - now,
        'random_agent_count': sum(1 for a in simulation_state.values() if a.get('type') == 'random'),
        'config': cfg.dict() if cfg else None
    }

@app.get("/health")
def health():
    return {"status": "ok", "agents": len(simulation_state)}

@app.on_event("startup")
async def startup_event():
    """Start the simulation loop on server startup."""
    asyncio.create_task(movement_loop())
    asyncio.create_task(broadcast_loop())
    asyncio.create_task(event_wave_loop())
    asyncio.create_task(random_traffic_loop())
    if USE_LOCAL_ROAD_NETWORK:
        # Warm route bank in background
        rn = get_road_network()
        asyncio.create_task(asyncio.to_thread(rn.precompute_route_bank, ROUTE_BANK_TARGET))
    # Load infra state if exists
    await load_infra_state()

@app.get('/perf-status')
async def perf_status():
    rn = get_road_network() if USE_LOCAL_ROAD_NETWORK else None
    return {
        'agents': len(simulation_state),
        'route_bank_size': len(rn.route_bank) if rn else None,
        'routes_by_start_nodes': len(rn.routes_by_start) if rn else None,
        'variant_cache_keys': len(variant_cache),
        'using_local_network': USE_LOCAL_ROAD_NETWORK,
        'speed_multiplier': SPEED_MULTIPLIER
    }

# --- Global Speed Multiplier API ---

@app.get('/speed-multiplier')
async def get_speed_multiplier():
    return {'multiplier': SPEED_MULTIPLIER}

@app.post('/speed-multiplier')
async def set_speed_multiplier(cfg: SpeedConfig):
    global SPEED_MULTIPLIER
    val = float(cfg.multiplier)
    if not (0.01 <= val <= 10.0):
        # Clamp to safe bounds
        val = max(0.01, min(10.0, val))
    SPEED_MULTIPLIER = val
    return {'ok': True, 'multiplier': SPEED_MULTIPLIER}

# --- Gateways (Fully Unified) API ---

@app.post('/add-gateway')
async def add_gateway(payload: GatewayCreate):
    """Create a gateway (acts as both entry+exit implicitly; no separate flags)."""
    gid = str(uuid.uuid4())
    name = payload.name or f"GW-{len(gateways)+1}"
    gateways[gid] = {
        'id': gid,
        'lon': payload.lon,
        'lat': payload.lat,
        'name': name
    }
    # 'both' retained in response for backward UI compatibility; can be removed later.
    await save_infra_state()
    return {'ok': True, 'id': gid, 'both': True, 'name': name}

# Backwards compatibility for earlier UI (treat as gateway with entry+exit)
@app.post('/add-entry-exit')
async def add_entry_exit_compat(payload: Dict[str, Any]):  # pragma: no cover (legacy path)
    """Legacy endpoint; now identical to /add-gateway without entry/exit flags."""
    lon = float(payload.get('lon'))
    lat = float(payload.get('lat'))
    name = payload.get('name') or f"GW-{len(gateways)+1}"
    gid = str(uuid.uuid4())
    gateways[gid] = {
        'id': gid,
        'lon': lon,
        'lat': lat,
        'name': name
    }
    await save_infra_state()
    return {'ok': True, 'id': gid, 'legacy': True, 'both': True, 'name': name}

@app.get('/gateways')
async def list_gateways():
    return {'items': list(gateways.values()), 'count': len(gateways)}

def _collect_gateway_stats(radius: float = 0.003):
    """Return list of gateway stats (no entry/exit distinction)."""
    rsq = radius * radius
    items = []
    for g in gateways.values():
        count = 0
        for a in simulation_state.values():
            dx = g['lon'] - a['lon']
            dy = g['lat'] - a['lat']
            if dx*dx + dy*dy <= rsq:
                count += 1
        items.append({
            'id': g['id'],
            'lon': g['lon'],
            'lat': g['lat'],
            'name': g.get('name'),
            'nearby_agents': count,
            'radius': radius
        })
    return items

@app.get('/gateway-stats')
async def gateway_stats(radius: float = 0.003):
    items = _collect_gateway_stats(radius)
    return {'items': items, 'count': len(items), 'radius': radius}

def _collect_infra_snapshot(radius: float = 0.003):
    gw = _collect_gateway_stats(radius)
    # Per tower counts using its own radius
    tower_items = []
    for t in mobile_towers.values():
        r = float(t.get('radius') or 0.01)
        rsq = r * r
        count = 0
        for a in simulation_state.values():
            dx = t['lon'] - a['lon']
            dy = t['lat'] - a['lat']
            if dx*dx + dy*dy <= rsq:
                count += 1
        tower_items.append({**t, 'nearby_agents': count})
    # Toll gate counts (fixed radius 0.001 ~110m)
    toll_items = []
    tr = 0.001
    trsq = tr * tr
    for tg in toll_gates.values():
        cnt = 0
        for a in simulation_state.values():
            dx = tg['lon'] - a['lon']
            dy = tg['lat'] - a['lat']
            if dx*dx + dy*dy <= trsq:
                cnt += 1
        toll_items.append({**tg, 'nearby_agents': cnt, 'radius': tr})
    return {
        'gateways': gw,
        'mobile_towers': tower_items,
        'toll_gates': toll_items,
        'agent_count': len(simulation_state)
    }

@app.get('/infra-stats')
async def infra_stats(radius: float = 0.003):
    snap = _collect_infra_snapshot(radius)
    snap['radius'] = radius
    return snap

@app.websocket('/infra-ws')
async def infra_ws(ws: WebSocket):
    await ws.accept()
    try:
        while True:
            snap = _collect_infra_snapshot()
            await ws.send_json(snap)
            await asyncio.sleep(2.0)
    except Exception:
        try:
            await ws.close()
        except Exception:
            pass

# --- Mobile Towers API ---

@app.post('/add-mobile-tower')
async def add_mobile_tower(payload: MobileTowerCreate):
    tid = str(uuid.uuid4())
    name = payload.name or f"TWR-{len(mobile_towers)+1}"
    mobile_towers[tid] = {
        'id': tid,
        'lon': payload.lon,
        'lat': payload.lat,
        'radius': payload.radius,
        'name': name
    }
    await save_infra_state()
    return {'ok': True, 'id': tid, 'name': name}

@app.get('/mobile-towers')
async def list_mobile_towers():
    return {'items': list(mobile_towers.values()), 'count': len(mobile_towers)}

# --- Toll Gates API ---

@app.post('/add-toll-gate')
async def add_toll_gate(payload: TollGateCreate):
    gid = str(uuid.uuid4())
    name = payload.name or f"TOLL-{len(toll_gates)+1}"
    toll_gates[gid] = {
        'id': gid,
        'lon': payload.lon,
        'lat': payload.lat,
        'name': name,
        'fee': payload.fee
    }
    await save_infra_state()
    return {'ok': True, 'id': gid, 'name': name}

@app.get('/toll-gates')
async def list_toll_gates():
    return {'items': list(toll_gates.values()), 'count': len(toll_gates)}

# --- Delete / Clear Endpoints ---

@app.delete('/gateways/{gid}')
async def delete_gateway(gid: str):
    removed = gateways.pop(gid, None)
    await save_infra_state()
    return {'ok': bool(removed), 'id': gid}

@app.delete('/mobile-towers/{tid}')
async def delete_mobile_tower(tid: str):
    removed = mobile_towers.pop(tid, None)
    await save_infra_state()
    return {'ok': bool(removed), 'id': tid}

@app.delete('/toll-gates/{tgid}')
async def delete_toll_gate(tgid: str):
    removed = toll_gates.pop(tgid, None)
    await save_infra_state()
    return {'ok': bool(removed), 'id': tgid}

@app.delete('/infra')
async def clear_infrastructure():
    gwc, twc, tlc = len(gateways), len(mobile_towers), len(toll_gates)
    gateways.clear(); mobile_towers.clear(); toll_gates.clear()
    await save_infra_state()
    return {'ok': True, 'cleared': {'gateways': gwc, 'mobile_towers': twc, 'toll_gates': tlc}}

@app.delete('/agents')
async def clear_agents(agent_type: Optional[str] = None):
    """Delete agents. agent_type can be one of: random, event, routed, all/None for everything."""
    to_del = []
    for aid, a in simulation_state.items():
        t = a.get('type')
        if agent_type in (None, '', 'all'):
            to_del.append(aid)
        elif agent_type == 'random' and t == 'random':
            to_del.append(aid)
        elif agent_type == 'event' and t == 'event':
            to_del.append(aid)
        elif agent_type == 'routed' and a.get('stop_at_end'):
            to_del.append(aid)
    for aid in to_del:
        simulation_state.pop(aid, None)
    return {'ok': True, 'deleted': len(to_del), 'remaining': len(simulation_state)}

# --- Infra Persistence Endpoints ---

@app.get('/infra-state')
async def infra_state_dump():
    return {
        'gateways': list(gateways.values()),
        'mobile_towers': list(mobile_towers.values()),
        'toll_gates': list(toll_gates.values()),
        'file': INFRA_STATE_FILE,
        'counts': {
            'gateways': len(gateways),
            'mobile_towers': len(mobile_towers),
            'toll_gates': len(toll_gates)
        }
    }

@app.post('/infra-save')
async def infra_save():
    await save_infra_state()
    return {'ok': True, 'file': INFRA_STATE_FILE}

@app.post('/infra-load')
async def infra_load():
    ok = await load_infra_state()
    return {'ok': ok, 'file': INFRA_STATE_FILE, 'counts': {'gateways': len(gateways), 'mobile_towers': len(mobile_towers), 'toll_gates': len(toll_gates)}}
