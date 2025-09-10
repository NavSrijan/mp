import React, { useEffect, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { ChevronLeft, ChevronRight, Settings } from "lucide-react";

// Add CSS for custom markers
const style = document.createElement('style');
style.textContent = `
  .temple-marker {
    background: transparent !important;
    border: none !important;
    font-size: 24px;
    text-shadow: 0 0 10px rgba(255, 255, 255, 0.8);
    display: flex;
    align-items: center;
    justify-content: center;
  }
`;
document.head.appendChild(style);

const DEFAULTS = {
  res: 8,
  topK: 20,
  backendUrl: "http://localhost:8000",
  predictorUrl: "http://localhost:8100",
  fullCover: true,
};

export default function MapContainer() {
  const mapRef = useRef(null);
  const mapInstance = useRef(null);
  const hexLayerRef = useRef(null);
  const autoTimerRef = useRef(null);
  const [res, setRes] = useState(DEFAULTS.res);
  const [topK, setTopK] = useState(DEFAULTS.topK);
  const [backendUrl, setBackendUrl] = useState(DEFAULTS.backendUrl);
  const [predictorUrl, setPredictorUrl] = useState(DEFAULTS.predictorUrl);
  const [fullCover, setFullCover] = useState(DEFAULTS.fullCover);
  const [status, setStatus] = useState("Idle");
  const [arima, setArima] = useState(false);
  const [auto, setAuto] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);

  // Helper: color for weight
  function colorForWeight(norm) {
    if (norm <= 0.5) {
      const t = norm / 0.5;
      const r = Math.round(68 + (255 - 68) * t);
      const g = Math.round(68 + (235 - 68) * t);
      const b = Math.round(68 + (59 - 68) * t);
      return `rgb(${r},${g},${b})`;
    }
    const t = (norm - 0.5) / 0.5;
    const r = Math.round(255 + (244 - 255) * t);
    const g = Math.round(235 + (67 - 235) * t);
    const b = Math.round(59 + (54 - 59) * t);
    return `rgb(${r},${g},${b})`;
  }

  // Draw hexes on map (using circles if H3 is not available)
  function drawHexes(tiles) {
    if (!hexLayerRef.current) return;
    hexLayerRef.current.clearLayers();
    if (!tiles || tiles.length === 0) return;
    
    console.log('Drawing tiles:', tiles.length); // Debug log
    
    const ws = tiles.map(t => t.weight).sort((a, b) => a - b);
    const q = p => ws[Math.max(0, Math.min(ws.length - 1, Math.floor(p * (ws.length - 1))))];
    const lo = q(0.05), hi = q(0.95);
    const minW = lo, maxW = hi;
    const range = (maxW - minW) || 1;
    
    tiles.forEach(t => {
      // Check if H3 is available for proper hex rendering
      if (window.h3 && t.h3_index) {
        try {
          const polyCoords = window.h3.cellToBoundary(t.h3_index).map(([lat, lon]) => [lat, lon]);
          let norm = (t.weight - minW) / range;
          norm = Math.max(0, Math.min(1, norm));
          const color = colorForWeight(norm);
          const poly = L.polygon(polyCoords, { 
            color: '#222', 
            weight: 1, 
            fillColor: color, 
            fillOpacity: 0.55 
          }).addTo(hexLayerRef.current);
          const pct = (norm * 100).toFixed(1);
          poly.bindTooltip(`H3: ${t.h3_index}\nWeight: ${t.weight.toFixed(2)}\nPercentile: ${pct}%`, { sticky: true });
        } catch (error) {
          console.warn('H3 conversion error:', error);
        }
      } else if (t.lat && t.lon) {
        // Fallback: Use circles when H3 is not available but we have lat/lon
        let norm = (t.weight - minW) / range;
        norm = Math.max(0, Math.min(1, norm));
        const color = colorForWeight(norm);
        
        // Create circle with radius based on weight (higher weight = larger circle)
        const radius = 50 + (norm * 200); // 50-250 meter radius
        const circle = L.circle([t.lat, t.lon], {
          color: '#222',
          weight: 2,
          fillColor: color,
          fillOpacity: 0.65,
          radius: radius
        }).addTo(hexLayerRef.current);
        
        const pct = (norm * 100).toFixed(1);
        circle.bindTooltip(`📍 Lat: ${t.lat.toFixed(4)}, Lon: ${t.lon.toFixed(4)}\n⚖️ Weight: ${t.weight.toFixed(2)}\n📊 Percentile: ${pct}%\n🎯 H3 Index: ${t.h3_index || 'N/A'}`, { sticky: true });
      }
    });
    
    console.log('Tiles rendered successfully'); // Debug log
  }

  // Prediction fetch
  async function runPrediction() {
    setStatus('Predicting...');
    try {
      let url;
      if (fullCover) {
        const params = new URLSearchParams();
        params.set('h3_resolution', res);
        params.set('sigma_km', 0.8);
        params.set('base_weight', 0);
        params.set('backend_url', backendUrl);
        if (arima) params.set('use_arima', 'true');
        url = `${predictorUrl.replace(/\/$/, '')}/predict-ujjain?${params.toString()}`;
      } else {
        const params = new URLSearchParams();
        params.set('h3_resolution', res);
        params.set('top_k', topK);
        params.set('backend_url', backendUrl);
        if (arima) params.set('use_arima', 'true');
        url = `${predictorUrl.replace(/\/$/, '')}/predict-live?${params.toString()}`;
      }
      
      console.log('Fetching from URL:', url); // Debug log
      const resp = await fetch(url);
      if (!resp.ok) throw new Error('HTTP ' + resp.status + ': ' + resp.statusText);
      const data = await resp.json();
      
      console.log('API Response:', data); // Debug log
      console.log('Tiles received:', data.tiles?.length || 0); // Debug log
      
      if (data.tiles && data.tiles.length > 0) {
        drawHexes(data.tiles);
        setStatus(`✅ Rendered ${data.tiles.length} tiles (Total weight: ${data.total_weight?.toFixed(2) || 'N/A'})`);
      } else {
        setStatus('⚠️ No tiles received from API');
      }
    } catch (e) {
      console.error('Prediction error:', e);
      setStatus('❌ Error: ' + e.message);
    }
  }

  // Map initialization
  useEffect(() => {
    if (!mapRef.current) return;
    
    try {
      // Initialize map centered on Ujjain (Mahakaleshwar Temple coordinates)
      mapInstance.current = L.map(mapRef.current).setView([23.1824, 75.7764], 13);
      
      // Add OpenStreetMap tiles
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { 
        attribution: '© OpenStreetMap contributors',
        maxZoom: 18
      }).addTo(mapInstance.current);
      
      // Create layer group for hexagons/circles
      hexLayerRef.current = L.layerGroup().addTo(mapInstance.current);
      
      // Add a marker for Mahakaleshwar Temple
      const templeIcon = L.divIcon({
        html: '🕉️',
        className: 'temple-marker',
        iconSize: [30, 30],
        iconAnchor: [15, 15]
      });
      
      L.marker([23.1824, 75.7764], { icon: templeIcon })
        .addTo(mapInstance.current)
        .bindTooltip('🏛️ Mahakaleshwar Jyotirlinga Temple<br/>Sacred center of Ujjain', { permanent: false });
      
      console.log('Map initialized successfully');
    } catch (error) {
      console.error('Map initialization error:', error);
      setStatus('❌ Map initialization failed');
    }
    
    return () => {
      if (mapInstance.current) {
        mapInstance.current.remove();
        mapInstance.current = null;
      }
    };
  }, []);

  // Auto prediction effect
  useEffect(() => {
    if (auto) {
      runPrediction();
      autoTimerRef.current = setInterval(runPrediction, 5000);
    } else {
      if (autoTimerRef.current) {
        clearInterval(autoTimerRef.current);
        autoTimerRef.current = null;
      }
    }
    return () => {
      if (autoTimerRef.current) {
        clearInterval(autoTimerRef.current);
        autoTimerRef.current = null;
      }
    };
    // eslint-disable-next-line
  }, [auto, res, topK, backendUrl, predictorUrl, fullCover, arima]);

  return (
    <div className="flex h-full w-full relative">
      <div ref={mapRef} className="flex-1 h-full" />
      
      {/* Collapsible Controls Panel */}
      <div className={`bg-slate-800 text-white overflow-hidden transition-all duration-300 ease-in-out ${
        isCollapsed ? 'w-12' : 'w-80'
      }`}>
        
        {/* Toggle Button */}
        <div className="flex items-center justify-between p-3 border-b border-slate-700">
          {!isCollapsed && (
            <h3 className="text-lg font-semibold">Prediction Controls</h3>
          )}
          <button
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="p-1 rounded hover:bg-slate-700 transition-colors"
            title={isCollapsed ? "Expand Controls" : "Collapse Controls"}
          >
            {isCollapsed ? (
              <ChevronLeft className="w-5 h-5" />
            ) : (
              <ChevronRight className="w-5 h-5" />
            )}
          </button>
        </div>

        {/* Collapsed State - Show only essential buttons */}
        {isCollapsed && (
          <div className="p-2 flex flex-col gap-2">
            <button
              onClick={runPrediction}
              className="p-2 bg-blue-600 hover:bg-blue-700 rounded transition-colors"
              title="Run Prediction"
            >
              <Settings className="w-4 h-4" />
            </button>
            
            <button
              onClick={() => setArima(a => !a)}
              className={`p-2 rounded transition-colors ${
                arima ? 'bg-blue-600 hover:bg-blue-700' : 'bg-slate-600 hover:bg-slate-500'
              }`}
              title={`ARIMA: ${arima ? 'On' : 'Off'}`}
            >
              <span className="text-xs font-bold">A</span>
            </button>
            
            <button
              onClick={() => setAuto(a => !a)}
              className={`p-2 rounded transition-colors ${
                auto ? 'bg-blue-600 hover:bg-blue-700' : 'bg-slate-600 hover:bg-slate-500'
              }`}
              title={`Auto: ${auto ? 'On' : 'Off'}`}
            >
              <span className="text-xs font-bold">⟲</span>
            </button>
          </div>
        )}

        {/* Expanded State - Show all controls */}
        {!isCollapsed && (
          <div className="p-5 overflow-y-auto flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium">H3 Resolution</label>
              <input
                type="number"
                value={res}
                min={5}
                max={11}
                onChange={e => setRes(Number(e.target.value))}
                className="px-2 py-2 rounded bg-slate-700 text-white border-none focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium">Top K</label>
              <input
                type="number"
                value={topK}
                min={1}
                max={200}
                onChange={e => setTopK(Number(e.target.value))}
                className="px-2 py-2 rounded bg-slate-700 text-white border-none focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium">Backend URL</label>
              <input
                type="text"
                value={backendUrl}
                onChange={e => setBackendUrl(e.target.value)}
                className="px-2 py-2 rounded bg-slate-700 text-white border-none text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium">Predictor URL</label>
              <input
                type="text"
                value={predictorUrl}
                onChange={e => setPredictorUrl(e.target.value)}
                className="px-2 py-2 rounded bg-slate-700 text-white border-none text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={fullCover}
                onChange={e => setFullCover(e.target.checked)}
                className="w-4 h-4"
              />
              <span className="text-sm">Full Cover (auto Ujjain)</span>
            </div>
            
            <button 
              onClick={runPrediction}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded font-medium transition-colors"
            >
              Run Prediction
            </button>
            
            <button
              onClick={() => setArima(a => !a)}
              className={`w-full px-4 py-2 rounded font-medium transition-colors ${
                arima ? 'bg-blue-600 hover:bg-blue-700 text-white' : 'bg-slate-600 hover:bg-slate-500 text-white'
              }`}
            >
              ARIMA: {arima ? 'On' : 'Off'}
            </button>
            
            <button
              onClick={() => setAuto(a => !a)}
              className={`w-full px-4 py-2 rounded font-medium transition-colors ${
                auto ? 'bg-blue-600 hover:bg-blue-700 text-white' : 'bg-slate-600 hover:bg-slate-500 text-white'
              }`}
            >
              Auto: {auto ? 'On' : 'Off'}
            </button>
            
            <div className="text-xs p-2 bg-slate-700 rounded text-slate-200">
              <strong>Status:</strong> {status}
            </div>
            
            <div className="border-t border-slate-600 pt-4">
              <strong className="text-sm">Legend</strong>
              <div className="mt-2 flex items-center gap-2">
                <div className="w-10 h-3 bg-gradient-to-r from-slate-400 via-yellow-500 to-red-500 rounded"></div>
                <span className="text-xs text-slate-300">Hex weight (darker = higher)</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
