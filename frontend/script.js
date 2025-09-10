document.addEventListener('DOMContentLoaded', () => {
    const map = L.map('map').setView([23.1824, 75.7764], 14);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);

    const agentMarkers = {};

    // Routing selection state
    let selecting = null; // 'source' | 'dest' | null
    let sourceLatLng = null;
    let destLatLng = null;
    let sourceMarker = null;
    let destMarker = null;
    let routeLine = null;

    const selectSourceBtn = document.getElementById('select-source-btn');
    const selectDestBtn = document.getElementById('select-dest-btn');
    const addRoutedBtn = document.getElementById('add-routed-crowd-btn');
    const clearRouteBtn = document.getElementById('clear-route-btn');
    const routeStatusEl = document.getElementById('route-status');

    function updateRouteStatus() {
        const srcTxt = sourceLatLng ? `${sourceLatLng.lat.toFixed(5)},${sourceLatLng.lng.toFixed(5)}` : '—';
        const dstTxt = destLatLng ? `${destLatLng.lat.toFixed(5)},${destLatLng.lng.toFixed(5)}` : '—';
        routeStatusEl.textContent = `Source: ${srcTxt} | Destination: ${dstTxt}`;
        const ready = !!(sourceLatLng && destLatLng);
        addRoutedBtn.disabled = !ready;
        clearRouteBtn.disabled = !ready && !sourceLatLng && !destLatLng;
    }

    function clearRouteSelection() {
        if (sourceMarker) { map.removeLayer(sourceMarker); sourceMarker = null; }
        if (destMarker) { map.removeLayer(destMarker); destMarker = null; }
        if (routeLine) { map.removeLayer(routeLine); routeLine = null; }
        sourceLatLng = null;
        destLatLng = null;
        selecting = null;
        updateRouteStatus();
    }

    selectSourceBtn.addEventListener('click', () => {
        selecting = 'source';
        selectSourceBtn.classList.add('active');
        selectDestBtn.classList.remove('active');
    });
    selectDestBtn.addEventListener('click', () => {
        selecting = 'dest';
        selectDestBtn.classList.add('active');
        selectSourceBtn.classList.remove('active');
    });

    clearRouteBtn.addEventListener('click', () => clearRouteSelection());

    // Infrastructure placement mode
    let infraMode = null; // 'gateway' | 'tower' | 'toll' | null
    const infraStatusEl = document.getElementById('infra-status');
    const gatewayBtn = document.getElementById('mode-gateway-btn');
    const towerBtn = document.getElementById('mode-tower-btn');
    const tollBtn = document.getElementById('mode-toll-btn');
    const cancelModeBtn = document.getElementById('cancel-mode-btn');
    const gatewayStatsBtn = document.getElementById('gateway-stats-btn');
    const infraSaveBtn = document.getElementById('infra-save-btn');
    const infraLoadBtn = document.getElementById('infra-load-btn');
    const infraClearBtn = document.getElementById('infra-clear-btn');
    const agentsClearBtn = document.getElementById('agents-clear-btn');
    const towerRadiusInput = document.getElementById('tower-radius');
    const tollFeeInput = document.getElementById('toll-fee');

    const infraButtons = [gatewayBtn, towerBtn, tollBtn];

    function setInfraMode(mode) {
        infraMode = mode;
        infraButtons.forEach(b => b.classList.remove('active'));
        if (mode === 'gateway') gatewayBtn.classList.add('active');
        if (mode === 'tower') towerBtn.classList.add('active');
        if (mode === 'toll') tollBtn.classList.add('active');
        cancelModeBtn.disabled = !mode;
        infraStatusEl.textContent = 'Mode: ' + (mode || 'none');
    }
    gatewayBtn?.addEventListener('click', ()=> setInfraMode('gateway'));
    towerBtn?.addEventListener('click', ()=> setInfraMode('tower'));
    tollBtn?.addEventListener('click', ()=> setInfraMode('toll'));
    cancelModeBtn?.addEventListener('click', ()=> setInfraMode(null));
    gatewayStatsBtn?.addEventListener('click', () => loadInfrastructure());
    infraSaveBtn?.addEventListener('click', ()=> {
        fetch('http://localhost:8000/infra-save', {method:'POST'}).then(()=>{
            infraStatusEl.textContent = 'Infra saved';
            setTimeout(()=> infraStatusEl.textContent = 'Mode: ' + (infraMode||'none'), 1500);
        });
    });
    infraLoadBtn?.addEventListener('click', ()=> {
        fetch('http://localhost:8000/infra-load', {method:'POST'}).then(()=>{
            loadInfrastructure();
            infraStatusEl.textContent = 'Infra loaded';
            setTimeout(()=> infraStatusEl.textContent = 'Mode: ' + (infraMode||'none'), 1500);
        });
    });
    infraClearBtn?.addEventListener('click', ()=> {
        fetch('http://localhost:8000/infra', {method:'DELETE'})
            .then(()=> loadInfrastructure());
    });
    agentsClearBtn?.addEventListener('click', ()=> {
        fetch('http://localhost:8000/agents', {method:'DELETE'})
            .then(()=> {
                // Clear all agent markers immediately; WS will keep it in sync
                for (const id in agentMarkers) {
                    map.removeLayer(agentMarkers[id]);
                    delete agentMarkers[id];
                }
            });
    });

    // Layer groups for infrastructure
    const infraLayers = {
        gateways: L.layerGroup().addTo(map),
        tower: L.layerGroup().addTo(map),
        toll: L.layerGroup().addTo(map)
    };

    function clearInfraLayers() {
    Object.values(infraLayers).forEach(lg => lg.clearLayers());
    }

    function degreesToMetersLat(deg) { return deg * 111000; }

    async function loadInfrastructure() {
        try {
            // Use aggregated infra stats endpoint for richer data
            const snap = await fetch('http://localhost:8000/infra-stats').then(r=>r.json()).catch(()=>null);
            clearInfraLayers();
            if (snap) {
                (snap.gateways||[]).forEach(g => {
                    const color = '#16a085';
                    const marker = L.circleMarker([g.lat, g.lon], {radius:7, color, fillColor: color, weight:1, fillOpacity:0.85}).addTo(infraLayers.gateways);
                    let tip = (g.name || 'Gateway') + `\nAgents:${g.nearby_agents}\n(right-click to delete)`;
                    marker.bindTooltip(tip, {sticky:true});
                    marker.on('contextmenu', () => {
                        if (!confirm(`Delete gateway ${g.name||g.id}?`)) return;
                        fetch(`http://localhost:8000/gateways/${g.id}`, {method:'DELETE'})
                            .then(()=> loadInfrastructure());
                    });
                });
                (snap.mobile_towers||[]).forEach(t => {
                    const m = L.circleMarker([t.lat, t.lon], {radius:5, color:'#8e44ad', fillColor:'#8e44ad', weight:1, fillOpacity:0.9}).addTo(infraLayers.tower);
                    if (t.radius) {
                        const rMeters = degreesToMetersLat(t.radius);
                        L.circle([t.lat, t.lon], {radius: rMeters, color:'#8e44ad', weight:1, fill:false, opacity:0.45}).addTo(infraLayers.tower);
                    }
                    m.bindTooltip(`${t.name||'Tower'}\nAgents:${t.nearby_agents} r:${t.radius}\n(right-click to delete)`, {sticky:true});
                    m.on('contextmenu', () => {
                        if (!confirm(`Delete tower ${t.name||t.id}?`)) return;
                        fetch(`http://localhost:8000/mobile-towers/${t.id}`, {method:'DELETE'})
                            .then(()=> loadInfrastructure());
                    });
                });
                (snap.toll_gates||[]).forEach(tg => {
                    const tol = L.circleMarker([tg.lat, tg.lon], {radius:6, color:'#f1c40f', fillColor:'#f1c40f', weight:1, fillOpacity:0.9}).addTo(infraLayers.toll);
                    tol.bindTooltip(`${tg.name||'Toll'}\nAgents:${tg.nearby_agents} fee:${tg.fee??'-'}\n(right-click to delete)`, {sticky:true});
                    tol.on('contextmenu', () => {
                        if (!confirm(`Delete toll ${tg.name||tg.id}?`)) return;
                        fetch(`http://localhost:8000/toll-gates/${tg.id}`, {method:'DELETE'})
                            .then(()=> loadInfrastructure());
                    });
                });
            }
        } catch(e) {
            console.warn('Infra load failed', e);
        }
    }

    // Initial load + periodic refresh
    loadInfrastructure();
    setInterval(loadInfrastructure, 15000);

    map.on('click', (e) => {
        // If in infrastructure placement mode, handle and exit early
        if (infraMode) {
            const { lat, lng } = e.latlng;
            if (infraMode === 'gateway') {
                // Unified gateway placement
                fetch('http://localhost:8000/add-gateway', {
                    method:'POST', headers:{'Content-Type':'application/json'},
                    body: JSON.stringify({ lon: lng, lat: lat })
                }).then(()=> loadInfrastructure());
            } else if (infraMode === 'tower') {
                const radiusVal = parseFloat(towerRadiusInput.value) || 0.01;
                fetch('http://localhost:8000/add-mobile-tower', {
                    method:'POST', headers:{'Content-Type':'application/json'},
                    body: JSON.stringify({ lon: lng, lat: lat, radius: radiusVal })
                }).then(()=> loadInfrastructure());
            } else if (infraMode === 'toll') {
                const feeVal = parseFloat(tollFeeInput.value) || null;
                fetch('http://localhost:8000/add-toll-gate', {
                    method:'POST', headers:{'Content-Type':'application/json'},
                    body: JSON.stringify({ lon: lng, lat: lat, fee: feeVal })
                }).then(()=> loadInfrastructure());
            }
            // remain in mode for multiple placements; user can cancel
            return; // prevent route selection logic
        }
        if (selecting === 'source' || (!sourceLatLng && !selecting)) {
            sourceLatLng = e.latlng;
            if (sourceMarker) sourceMarker.setLatLng(e.latlng); else {
                sourceMarker = L.marker(e.latlng, { icon: L.divIcon({className: 'src-marker', html: '<div style="background:#2ecc71;width:14px;height:14px;border-radius:50%;border:2px solid #1e8449"></div>'}) }).addTo(map);
            }
            // Reset destination and route if we re-pick source while dest exists
            if (destLatLng) {
                destLatLng = null;
                if (destMarker) { map.removeLayer(destMarker); destMarker = null; }
                if (routeLine) { map.removeLayer(routeLine); routeLine = null; }
            }
        } else if (selecting === 'dest' || (!destLatLng && sourceLatLng)) {
            destLatLng = e.latlng;
            if (destMarker) destMarker.setLatLng(e.latlng); else {
                destMarker = L.marker(e.latlng, { icon: L.divIcon({className: 'dst-marker', html: '<div style="background:#e74c3c;width:14px;height:14px;border-radius:50%;border:2px solid #922b21"></div>'}) }).addTo(map);
            }
            // Fetch preview route
            fetch('http://localhost:8000/route-preview', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    number: 1,
                    source_lat: sourceLatLng.lat,
                    source_lon: sourceLatLng.lng,
                    dest_lat: destLatLng.lat,
                    dest_lon: destLatLng.lng
                })
            }).then(r=>r.json()).then(data => {
                if (data.ok) {
                    if (routeLine) { map.removeLayer(routeLine); routeLine = null; }
                    const latlngs = data.points.map(p => [p[1], p[0]]);
                    routeLine = L.polyline(latlngs, { color:'#bbbbbb', weight:2, opacity:0.4, dashArray:'4,6' }).addTo(map);
                }
            }).catch(()=>{});
        } else {
            // Third arbitrary click resets everything and starts new source
            sourceLatLng = e.latlng;
            if (sourceMarker) sourceMarker.setLatLng(e.latlng); else {
                sourceMarker = L.marker(e.latlng, { icon: L.divIcon({className: 'src-marker', html: '<div style="background:#2ecc71;width:14px;height:14px;border-radius:50%;border:2px solid #1e8449"></div>'}) }).addTo(map);
            }
            destLatLng = null;
            if (destMarker) { map.removeLayer(destMarker); destMarker = null; }
            if (routeLine) { map.removeLayer(routeLine); routeLine = null; }
        }
        selecting = null;
        selectSourceBtn.classList.remove('active');
        selectDestBtn.classList.remove('active');
        updateRouteStatus();
    });

    const ws = new WebSocket('ws://localhost:8000/ws');

    function markerStyleFor(agent) {
        const base = { radius: 6, weight: 1, opacity: 0.9, fillOpacity: 0.7 };
        if (agent.type === 'event') {
            switch(agent.phase) {
                case 'to_dest': return { ...base, color:'#ff9800', fillColor:'#ff9800' };
                case 'dwelling': return { ...base, color:'#e53935', fillColor:'#e53935' };
                case 'exiting': return { ...base, color:'#6a1b9a', fillColor:'#6a1b9a' };
                case 'settled': return { ...base, color:'#2e7d32', fillColor:'#2e7d32' };
                default: return { ...base, color:'#ffb74d', fillColor:'#ffb74d' };
            }
        }
        if (agent.stop) {
            return { ...base, color:'#0d47a1', fillColor:'#0d47a1' };
        }
        if (agent.type === 'random') {
            return { ...base, color:'#2d6cdf', fillColor:'#2d6cdf' };
        }
        return { ...base, color:'#1976d2', fillColor:'#1976d2' };
    }

    ws.onmessage = (event) => {
        const agents = JSON.parse(event.data);
        const currentAgentIds = new Set();
        agents.forEach(agent => {
            currentAgentIds.add(agent.id);
            const style = markerStyleFor(agent);
            if (agentMarkers[agent.id]) {
                agentMarkers[agent.id].setLatLng([agent.lat, agent.lon]);
                agentMarkers[agent.id].setStyle(style);
            } else {
                agentMarkers[agent.id] = L.circle([agent.lat, agent.lon], style).addTo(map);
            }
        });
        for (const agentId in agentMarkers) {
            if (!currentAgentIds.has(agentId)) {
                map.removeLayer(agentMarkers[agentId]);
                delete agentMarkers[agentId];
            }
        }
    };
    // ---------- Event & Random Traffic Controls ----------
    const startEventBtn = document.getElementById('start-event-btn');
    const stopEventBtn = document.getElementById('stop-event-btn');
    const eventStatusEl = document.getElementById('event-status');
    const startRandomBtn = document.getElementById('start-random-btn');
    const stopRandomBtn = document.getElementById('stop-random-btn');
    const randomStatusEl = document.getElementById('random-status');
    const vminEl = document.getElementById('rt-vmin');
    const vmaxEl = document.getElementById('rt-vmax');
    const spdMultEl = document.getElementById('spd-mult');
    const applySpeedBtn = document.getElementById('apply-speed-btn');
    const speedStatusEl = document.getElementById('speed-status');

    function refreshEventStatus() {
        fetch('http://localhost:8000/event-status')
            .then(r=>r.json())
            .then(d => {
                eventStatusEl.textContent = d.active ? `Event: active waves=${d.waves_launched}` : 'Event: inactive';
            })
            .catch(()=>{});
    }
    function refreshRandomStatus() {
        fetch('http://localhost:8000/random-traffic-status')
            .then(r=>r.json())
            .then(d => {
                randomStatusEl.textContent = d.active ? `Random: active count=${d.random_agent_count}` : 'Random: inactive';
            })
            .catch(()=>{});
    }

    startEventBtn.addEventListener('click', () => {
        if (!(sourceLatLng && destLatLng)) return;
        const body = {
            source_lat: sourceLatLng.lat,
            source_lon: sourceLatLng.lng,
            dest_lat: destLatLng.lat,
            dest_lon: destLatLng.lng,
            wave_size: parseInt(document.getElementById('ev-wave-size').value,10)||100,
            wave_interval_seconds: parseFloat(document.getElementById('ev-interval').value)||10,
            dwell_min_seconds: parseFloat(document.getElementById('ev-dwell-min').value)||30,
            dwell_max_seconds: parseFloat(document.getElementById('ev-dwell-max').value)||90,
            exit_after_dwell: document.getElementById('ev-exit').checked,
            max_waves: parseInt(document.getElementById('ev-max-waves').value,10)||5
        };
        fetch('http://localhost:8000/start-event', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body)})
            .then(r=>r.json()).then(()=>{refreshEventStatus();});
    });
    stopEventBtn.addEventListener('click', () => {
        fetch('http://localhost:8000/stop-event', {method:'POST'})
            .then(()=>refreshEventStatus());
    });

    startRandomBtn.addEventListener('click', () => {
        const body = {
            target_agents: parseInt(document.getElementById('rt-target').value,10)||200,
            max_agents: parseInt(document.getElementById('rt-max').value,10)||400,
            spawn_interval_seconds: parseFloat(document.getElementById('rt-interval').value)||2,
            batch_min: parseInt(document.getElementById('rt-bmin').value,10)||5,
            batch_max: parseInt(document.getElementById('rt-bmax').value,10)||15,
            min_speed: parseFloat(vminEl.value)||0.0003,
            max_speed: parseFloat(vmaxEl.value)||0.0008
        };
        fetch('http://localhost:8000/start-random-traffic', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body)})
            .then(()=>refreshRandomStatus());
    });
    // Global speed apply
    applySpeedBtn.addEventListener('click', () => {
        const m = parseFloat(spdMultEl.value)||1.0;
        fetch('http://localhost:8000/speed-multiplier', {
            method:'POST', headers:{'Content-Type':'application/json'},
            body: JSON.stringify({ multiplier: m })
        }).then(r=>r.json()).then(d => {
            speedStatusEl.textContent = `Speed: ×${(d.multiplier||m).toFixed(2)}`;
        }).catch(()=>{
            speedStatusEl.textContent = 'Speed: error';
        });
    });
    stopRandomBtn.addEventListener('click', () => {
        fetch('http://localhost:8000/stop-random-traffic', {method:'POST'})
            .then(()=>refreshRandomStatus());
    });

    // Enable event start once S & D chosen
    function updateEventButtonEnable() {
        startEventBtn.disabled = !(sourceLatLng && destLatLng);
    }
    const origUpdateRouteStatus = updateRouteStatus;
    updateRouteStatus = function() { origUpdateRouteStatus(); updateEventButtonEnable(); };
    // Help panel
    const helpToggle = document.getElementById('help-toggle');
    const helpPanel = document.getElementById('help-panel');
    const closeHelp = document.getElementById('close-help');
    helpToggle.addEventListener('click', ()=> helpPanel.classList.toggle('hidden'));
    closeHelp.addEventListener('click', ()=> helpPanel.classList.add('hidden'));

    // Periodic status refresh
    setInterval(()=>{refreshEventStatus(); refreshRandomStatus();}, 5000);


    ws.onopen = () => {
        console.log('WebSocket connection established');
    };

    ws.onerror = (error) => {
        console.error('WebSocket error:', error);
    };

    document.getElementById('add-crowd-btn').addEventListener('click', () => {
        console.log('"Add Crowd" button clicked');
        const numberInput = document.getElementById('crowd-size');
        const number = parseInt(numberInput.value, 10);
        console.log(`Sending request to add ${number} agents.`);

        fetch('http://localhost:8000/add-crowd', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ number: number })
        })
        .then(response => {
            console.log('Received response from server:', response);
            return response.json();
        })
        .then(data => {
            console.log('Server message:', data.message);
        })
        .catch(error => {
            console.error('Error adding crowd:', error);
        });
    });

    addRoutedBtn.addEventListener('click', () => {
        if (!(sourceLatLng && destLatLng)) return;
        const numberInput = document.getElementById('crowd-size');
        const number = parseInt(numberInput.value, 10) || 1;
        fetch('http://localhost:8000/add-crowd-route', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                number,
                source_lat: sourceLatLng.lat,
                source_lon: sourceLatLng.lng,
                dest_lat: destLatLng.lat,
                dest_lon: destLatLng.lng
            })
        })
        .then(r => r.json())
        .then(data => {
            console.log('Routed crowd added:', data);
        })
        .catch(err => console.error('Error adding routed crowd:', err));
    });

    updateRouteStatus();
});