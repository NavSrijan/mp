import React, { useState, useEffect } from 'react';
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer } from 'recharts';
import { Settings, AlertTriangle, Navigation, Phone, Shield, Eye, Users, Clock, TrendingUp, Bot, ChevronRight, ChevronLeft, Send } from 'lucide-react';
import MapContainer from './components/MapContainer';

// Header Component
const Header = () => (
  <div className="bg-slate-800 px-6 py-4 flex items-center justify-between">
    <div className="flex items-center space-x-3">
      <Users className="text-blue-400 w-8 h-8" />
      <h1 className="text-white text-xl font-semibold">Ujjain Simhastha Kumbh - Smart Crowd Intelligence</h1>
    </div>
    <div className="flex items-center space-x-4">
      <div className="flex items-center space-x-2">
        <div className="w-3 h-3 bg-green-400 rounded-full animate-pulse"></div>
        <span className="text-green-400 text-sm font-medium">Live</span>
      </div>
      <Settings className="text-gray-400 w-5 h-5 cursor-pointer hover:text-white" />
    </div>
  </div>
);

// Stats Cards Component
const StatsCards = () => {
  const stats = [
    { title: 'Live Pilgrims', value: '7.2L', color: 'text-blue-400' },
    { title: 'Temple Queues', value: '8 Active', color: 'text-red-400' },
    { title: 'Ghat Access', value: '12/84 Open', color: 'text-green-400' },
    { title: 'Next Bhasma Aarti', value: '6h 45m', color: 'text-orange-400' }
  ];

  return (
    <div className="grid grid-cols-4 gap-4 mb-6">
      {stats.map((stat, index) => (
        <div key={index} className="bg-slate-800 p-4 rounded-lg">
          <div className={`text-2xl font-bold ${stat.color} mb-1`}>
            {stat.value}
          </div>
          <div className="text-gray-400 text-sm">{stat.title}</div>
        </div>
      ))}
    </div>
  );
};

// Live Alerts Component
const LiveAlerts = () => {
  const alerts = [
    { type: 'High Density - Mahakaleshwar Temple Complex', time: '2 min ago', severity: 'high' },
    { type: 'Crowd Buildup - Ram Ghat Bathing Area', time: '5 min ago', severity: 'medium' },
    { type: 'Shipra Route Optimization Active', time: '8 min ago', severity: 'low' }
  ];

  const getSeverityColor = (severity) => {
    switch(severity) {
      case 'high': return 'border-l-red-500 bg-red-900/20';
      case 'medium': return 'border-l-orange-500 bg-orange-900/20';
      case 'low': return 'border-l-blue-500 bg-blue-900/20';
      default: return 'border-l-gray-500 bg-gray-900/20';
    }
  };

  return (
    <div className="bg-slate-800 p-4 rounded-lg mb-6">
      <div className="flex items-center space-x-2 mb-4">
        <AlertTriangle className="text-orange-400 w-5 h-5" />
        <h3 className="text-white font-medium">Live Alerts</h3>
      </div>
      <div className="space-y-3">
        {alerts.map((alert, index) => (
          <div key={index} className={`border-l-4 pl-3 py-2 ${getSeverityColor(alert.severity)}`}>
            <div className="text-white text-sm font-medium">{alert.type}</div>
            <div className="text-gray-400 text-xs">{alert.time}</div>
          </div>
        ))}
      </div>
    </div>
  );
};

// Data Layers Component
const DataLayers = () => {
  const [layers, setLayers] = useState({
    mobileTower: true,
    tollBooth: true,
    entryExit: false,
    emergencyVehicles: true
  });

  const toggleLayer = (layer) => {
    setLayers(prev => ({ ...prev, [layer]: !prev[layer] }));
  };

  return (
    <div className="bg-slate-800 p-4 rounded-lg mb-6">
      <h3 className="text-white font-medium mb-4">Data Layers</h3>
      <div className="space-y-3">
        {[
          { key: 'mobileTower', label: 'Mobile Tower Density' },
          { key: 'tollBooth', label: 'Toll Booth Data' },
          { key: 'entryExit', label: 'Entry/Exit Flows' },
          { key: 'emergencyVehicles', label: 'Emergency Vehicles' }
        ].map(({ key, label }) => (
          <label key={key} className="flex items-center space-x-3 cursor-pointer">
            <input
              type="checkbox"
              checked={layers[key]}
              onChange={() => toggleLayer(key)}
              className="w-4 h-4 text-blue-600 bg-slate-700 border-slate-600 rounded focus:ring-blue-500"
            />
            <span className="text-gray-300 text-sm">{label}</span>
          </label>
        ))}
      </div>
    </div>
  );
};

// Emergency Actions Component
const EmergencyActions = () => {
  const actions = [
    { label: 'Alert Force', color: 'bg-red-600 hover:bg-red-700', icon: Shield },
    { label: 'Block Entry', color: 'bg-orange-600 hover:bg-orange-700', icon: Eye },
    { label: 'Open Route', color: 'bg-green-600 hover:bg-green-700', icon: Navigation },
    { label: 'Dispatch', color: 'bg-blue-600 hover:bg-blue-700', icon: Phone }
  ];

  return (
    <div className="bg-slate-800 p-4 rounded-lg">
      <h3 className="text-white font-medium mb-4">Emergency Actions</h3>
      <div className="grid grid-cols-2 gap-3">
        {actions.map((action, index) => (
          <button
            key={index}
            className={`${action.color} text-white px-4 py-3 rounded-lg text-sm font-medium transition-colors flex items-center justify-center space-x-2`}
          >
            <action.icon className="w-4 h-4" />
            <span>{action.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
};

// Map Component (dynamic prediction integration)
const MapView = () => {
  const [predictions, setPredictions] = useState([]);
  const [lastUpdated, setLastUpdated] = useState(null);

  useEffect(() => {
    // Simulate fetching from a test folder (local JSON). In real app replace with API call.
    import('../test/predictionData.json')
      .then(mod => {
        setPredictions(mod.default || mod);
        setLastUpdated(new Date());
      })
      .catch(() => {});
  }, []);

  const severityColor = severity => {
    switch (severity) {
      case 'high': return { dot: 'fill-red-600', area: 'fill-red-400 opacity-70' };
      case 'medium': return { dot: 'fill-yellow-500', area: 'fill-yellow-400 opacity-50' };
      default: return { dot: 'fill-green-600', area: 'fill-green-400 opacity-40' };
    }
  };

  return (
    <div className="bg-slate-800 rounded-lg p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-white font-medium">Prediction Timeline</h3>
        <div className="text-gray-400 text-xs md:text-sm">
          {lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString()}` : 'Live Map'}
        </div>
      </div>
      
      {/* Interactive Map */}
      <div className="bg-white rounded-lg overflow-hidden mb-4" style={{ height: "500px" }}>
        <MapContainer />
      </div>
      
      <div className="flex flex-wrap items-center gap-4 text-xs md:text-sm">
        <div className="flex items-center space-x-2"><div className="w-3 h-3 bg-green-400 rounded"/><span className="text-gray-300">Low (0-30%)</span></div>
        <div className="flex items-center space-x-2"><div className="w-3 h-3 bg-yellow-400 rounded"/><span className="text-gray-300">Medium (30-70%)</span></div>
        <div className="flex items-center space-x-2"><div className="w-3 h-3 bg-red-400 rounded"/><span className="text-gray-300">High (70%+)</span></div>
      </div>
    </div>
  );
};

// Area Info Component
const AreaInfo = () => (
  <div className="bg-slate-800 p-4 rounded-lg mb-4">
    <h3 className="text-white font-medium mb-2">🕉️ Ujjain - Mahakaleshwar Dham</h3>
    <p className="text-gray-400 text-sm">Sacred Jyotirlinga • Simhastha Kumbh Monitoring</p>
    <p className="text-gray-500 text-xs mt-1">84 Ghats • Shipra River • 12-Year Sacred Cycle</p>
  </div>
);

// Crowd Analytics Chart Component
const CrowdAnalytics = ({ isCollapsed, onToggle }) => {
  const data = [
    { time: '6AM', crowd: 15000 },
    { time: '9AM', crowd: 25000 },
    { time: '12PM', crowd: 42000 },
    { time: '3PM', crowd: 45000 },
    { time: '6PM', crowd: 38000 }
  ];

  return (
    <div className="bg-slate-800 rounded-lg mb-4 overflow-hidden">
      <div className="flex items-center justify-between p-4 border-b border-slate-700">
        <h3 className="text-white font-medium">Crowd Analytics</h3>
        <button
          onClick={onToggle}
          className="p-1 rounded hover:bg-slate-700 transition-colors"
          title={isCollapsed ? "Expand Analytics" : "Collapse Analytics"}
        >
          {isCollapsed ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </button>
      </div>
      
      {!isCollapsed && (
        <div className="p-4">
          <div className="h-40">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data}>
                <XAxis 
                  dataKey="time" 
                  axisLine={false} 
                  tickLine={false}
                  tick={{ fill: '#9CA3AF', fontSize: 12 }}
                />
                <YAxis hide />
                <Line 
                  type="monotone" 
                  dataKey="crowd" 
                  stroke="#60A5FA" 
                  strokeWidth={2}
                  dot={{ fill: '#60A5FA', r: 4 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="grid grid-cols-2 gap-4 mt-4">
            <div>
              <div className="flex items-center space-x-1">
                <TrendingUp className="text-blue-400 w-4 h-4" />
                <span className="text-blue-400 text-lg font-bold">15%</span>
              </div>
              <div className="text-gray-400 text-sm">Hourly Growth</div>
            </div>
            <div>
              <div className="text-green-400 text-lg font-bold">85%</div>
              <div className="text-gray-400 text-sm">Prediction Accuracy</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// AI Assistant Component with Open Source LLM
const AIAssistant = ({ isCollapsed, onToggle }) => {
  const [messages, setMessages] = useState([
    {
      type: 'assistant',
      text: '🕉️ Namaste! I am your AI assistant for Simhastha Kumbh Mela crowd management in sacred Ujjain. I can help analyze crowd patterns at Mahakaleshwar Temple, Shipra ghats, and other holy sites. Ask me about temple crowd status, ghat occupancy, route optimization, or emergency protocols. How can I assist with today\'s pilgrimage management?'
    },
    {
      type: 'user',
      text: 'What\'s the current situation at Mahakaleshwar Temple?'
    },
    {
      type: 'assistant',
      text: '🏛️ Mahakaleshwar Jyotirlinga Status: Currently 78% capacity with 3,200 devotees/hour flow. The sacred Bhasma Aarti (4 AM) created morning surge. Darshan wait time: 12 minutes. Recommend directing overflow crowds to nearby Kal Bhairav Temple (2km) where traditional alcohol offering attracts unique spiritual experience. Shipra ghat access moderate via Ram Ghat. Next peak expected during evening aarti (7 PM).'
    }
  ]);
  
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // Function to call open source LLM (using Ollama or similar local setup)
  const sendMessageToLLM = async (userMessage) => {
    setIsLoading(true);
    
    // Add user message immediately
    const newUserMessage = { type: 'user', text: userMessage };
    setMessages(prev => [...prev, newUserMessage]);
    
    try {
      // Try to call local Ollama instance first
      let response;
      try {
        response = await fetch('http://localhost:11434/api/generate', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'llama2', // or 'mistral', 'codellama', etc.
            prompt: `You are an AI assistant for crowd monitoring at Simhastha Kumbh Mela in Ujjain. Analyze this question about crowd patterns and provide helpful insights: "${userMessage}"`,
            stream: false
          })
        });
        
        if (!response.ok) throw new Error('Ollama not available');
        
        const data = await response.json();
        const aiResponse = data.response || 'I understand your question about crowd patterns. Based on current data, I recommend monitoring the specified areas closely.';
        
        setMessages(prev => [...prev, { type: 'assistant', text: aiResponse }]);
        
      } catch (ollamaError) {
        // Fallback to simulated intelligent responses
        const simulatedResponse = generateSmartResponse(userMessage);
        setMessages(prev => [...prev, { type: 'assistant', text: simulatedResponse }]);
      }
      
    } catch (error) {
      console.error('AI Assistant Error:', error);
      setMessages(prev => [...prev, { 
        type: 'assistant', 
        text: 'I apologize, but I\'m having trouble processing your request right now. Please try again later.' 
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  // Enhanced smart response generator with Ujjain-specific data and elaborate responses
  const generateSmartResponse = (userMessage) => {
    const msg = userMessage.toLowerCase();
    const currentTime = new Date().toLocaleTimeString();
    const randomCapacity = Math.floor(Math.random() * 40) + 60; // 60-100%
    const randomFlow = Math.floor(Math.random() * 2000) + 1500; // 1500-3500
    const randomWaitTime = Math.floor(Math.random() * 15) + 5; // 5-20 minutes
    
    // Famous places and temples in Ujjain for contextual responses
    const ujjainPlaces = [
      'Mahakaleshwar Temple', 'Ram Ghat', 'Shipra River banks', 'Kal Bhairav Temple', 
      'Chintaman Ganesh Temple', 'Mangalnath Temple', 'ISKCON Temple', 'Pir Matsyendranath',
      'Siddhavat', 'Vikram University area', 'Triveni Ghat', 'Gadkalika Temple',
      'Annapurna Temple', 'Sandipani Ashram', 'Ved Shala Observatory'
    ];
    
    const ujjainGhats = ['Ram Ghat', 'Triveni Ghat', 'Mangal Ghat', 'Kali Ghat', 'Chakratirth Ghat', 'Pitra Ghat'];
    
    // Generate different responses based on context with Ujjain-specific information
    if (msg.includes('crowd') || msg.includes('prediction')) {
      const scenarios = [
        `🕉️ Current crowd prediction at sacred Ujjain sites: Mahakaleshwar Temple showing ${randomCapacity}% capacity with ${randomFlow} devotees/hour. The morning Bhasma Aarti (4 AM) attracts massive crowds - recommend diverting overflow to Mangalnath Temple and Chintaman Ganesh. Peak Simhastha activity expected around ${Math.floor(Math.random() * 12) + 12}:${String(Math.floor(Math.random() * 60)).padStart(2, '0')}. Deploy additional security at Shipra River banks and establish temporary shelters near Ved Shala Observatory for elderly pilgrims.`,
        
        `📊 AI analysis of Simhastha Kumbh patterns: Sector near Ram Ghat: ${randomCapacity}%, Triveni Ghat area: ${Math.floor(Math.random() * 30) + 40}%. Historical data shows that during Simhastha, the convergence of Shipra, Saraswati, and Ganga creates spiritual magnetism attracting 7+ crore devotees over 30 days. Current trajectory suggests implementing Phase-2 crowd management with helicopter monitoring over Mahakaleshwar corridor and activating overflow routes via Sandipani Ashram road.`,
        
        `🔮 Predictive modeling for Ujjain's holy sites: Massive pilgrimage surge anticipated at ${Math.floor(Math.random() * 12) + 12}:${String(Math.floor(Math.random() * 60)).padStart(2, '0')} near the sacred Jyotirlinga. The 84 ghats of Ujjain are experiencing unprecedented footfall. Recommend immediate activation of: (1) Emergency dharamshalas near ISKCON Temple, (2) Medical camps at Kal Bhairav Temple vicinity, (3) Food distribution centers at Annapurna Temple, (4) Traffic diversion through Vikram University bypass to reduce congestion on Mahakal Road.`,
        
        `⚡ Real-time Simhastha analysis: Current flow ${randomFlow}/hour through the sacred Mahakaleshwar-Ram Ghat corridor. The spiritual significance of Ujjain as one of the four Simhastha venues (others being Haridwar, Prayagraj, Nashik) draws devotees believing that bathing in Shipra during this period grants moksha. Trend indicates ${Math.random() > 0.5 ? 'exponentially increasing' : 'stabilizing but high'} patterns. Critical monitoring required at Gadkalika Temple intersection and Pir Matsyendranath area - these are narrow passages with high spiritual significance causing bottlenecks.`
      ];
      return scenarios[Math.floor(Math.random() * scenarios.length)];
    }
    
    if (msg.includes('temple') || msg.includes('mahakal') || msg.includes('ghat') || msg.includes('shipra')) {
      const templeResponses = [
        `🏛️ Mahakaleshwar Temple Status: ${randomCapacity}% capacity - This sacred Jyotirlinga, one of 12 in India, is experiencing peak devotion. The unique south-facing Shivlinga creates immense spiritual pull. Current darshan wait: ${randomWaitTime} minutes. The famous Bhasma Aarti uses ash from cremation grounds, making it deeply sacred but also a crowd magnet. Recommend: (1) VIP darshan queue management, (2) Prasad distribution at multiple counters, (3) Crowd diversion to nearby Kal Bhairav Temple (only 2km away) where alcohol offering is traditional - another unique Ujjain experience.`,
        
        `🌊 Shipra River & Ghats Analysis: Ram Ghat showing ${randomCapacity}% occupancy with ${randomFlow} pilgrims/hour taking holy dips. The Shipra, mentioned in Puranas as emerging from Vishnu's kamandalu, holds special significance during Simhastha when Jupiter is in Leo. Current ghat status: Ram Ghat (critical), Triveni Ghat (moderate), Mangal Ghat (stable). Recommendation: Direct overflow crowds to less congested ghats like Chakratirth and Pitra Ghat. Set up temporary changing rooms and locker facilities. Deploy lifeguards as river depth varies seasonally.`,
        
        `🕯️ Kal Bhairav Temple Insights: Current crowd density ${randomCapacity}%. This unique temple where alcohol (liquor) is offered to the deity attracts curious visitors alongside devotees. Located near Mahakaleshwar, it serves as natural crowd overflow. The temple's historical significance - where Shiva appeared as Bhairav to cut Brahma's fifth head - makes it essential pilgrimage stop. Establish alcohol offering counters with proper queuing to manage the unique ritual while maintaining sanctity.`
      ];
      return templeResponses[Math.floor(Math.random() * templeResponses.length)];
    }
    
    if (msg.includes('sector') || msg.includes('gate') || msg.includes('area')) {
      const ujjainArea = ujjainPlaces[Math.floor(Math.random() * ujjainPlaces.length)];
      const status = ['moderate', 'high', 'critical', 'stable'][Math.floor(Math.random() * 4)];
      return `📍 ${ujjainArea} area status: ${status} density (${randomCapacity}%). Flow rate: ${randomFlow} pilgrims/hour. ${ujjainArea === 'Mahakaleshwar Temple' ? 'Being the primary Jyotirlinga, expect continuous high footfall. The temple\'s 5-story structure can accommodate large crowds but entry gates become bottlenecks.' : ujjainArea === 'Ram Ghat' ? 'This main bathing ghat on Shipra sees maximum activity during auspicious times. The ghat\'s wide steps can handle crowds but water access points need monitoring.' : `This sacred site has historical/spiritual significance in Ujjain's rich heritage dating back to King Vikramaditya's era.`} ${status === 'critical' ? '🚨 IMMEDIATE ACTION REQUIRED - Deploy rapid response teams and implement Phase-3 crowd control protocols' : 'Monitoring recommended with regular pilgrim guidance announcements in Hindi, English, and regional languages'}.`;
    }
    
    if (msg.includes('emergency') || msg.includes('evacuation')) {
      const responses = [
        `🚨 EMERGENCY PROTOCOL ACTIVATED for Simhastha Ujjain: Immediate evacuation estimated ${randomWaitTime} minutes via established routes: (1) Mahakal Road → Dewas Road, (2) Ram Ghat → University Road, (3) Shipra bypass via Sandipani route. Alert all 84 ghats simultaneously through PA system. Deploy helicopter surveillance for aerial crowd assessment. Medical emergency teams positioned at: Ved Shala, ISKCON Temple, Vikram University. Coordinate with Railway Station and Bus Stand for additional transport. Historical note: Ujjain's ancient city planning by King Vikramaditya includes wide roads - utilize these for emergency vehicle access.`,
        
        `⚡ CRITICAL SITUATION - Simhastha Crowd Management: Implementing immediate dispersal protocol through spiritual announcements encouraging visits to alternative temples: Chintaman Ganesh (Ganesha temple), Mangalnath (birthplace of Mars), Pir Matsyendranath (secular harmony site). Estimated clearance: ${randomWaitTime + 5} minutes. The 30-day Simhastha festival creates sustained high-density situations - activate all 15 designated relief camps across the city. Use traditional conch shell (shankh) sounds along with modern PA for cultural crowd communication.`,
        
        `🔴 EMERGENCY RESPONSE: Opening all evacuation routes through Ujjain's ancient network. Current safe capacity exceeded by ${Math.floor(Math.random() * 20) + 10}% at sacred confluence areas. Immediate actions: (1) Helicopter evacuation for medical emergencies from Triveni Ghat helipad, (2) Water distribution via tankers at all major temples, (3) Cooling stations at Annapurna Temple and ISKCON, (4) Emergency dharamshalas activation. The spiritual fervor of Simhastha requires careful balance between crowd safety and maintaining religious sanctity.`
      ];
      return responses[Math.floor(Math.random() * responses.length)];
    }
    
    if (msg.includes('weather') || msg.includes('temperature')) {
      return `🌡️ Weather Impact Analysis for Ujjain Simhastha: Current temperature ${Math.floor(Math.random() * 10) + 25}°C affecting pilgrimage patterns. Historical weather data shows April-May Simhastha faces extreme heat (up to 45°C) while winter Simhastha (Dec-Jan) brings cold waves. Current recommendations: (1) Deploy mist cooling systems at all major ghats especially Ram Ghat and Triveni Ghat, (2) Establish shade structures using traditional methods (bamboo & cloth canopies) maintaining spiritual aesthetics, (3) Free water distribution at Mahakaleshwar Temple complex, (4) Medical camps equipped for heat exhaustion near crowded areas, (5) Schedule high-impact activities like mass bathing during cooler hours (4-7 AM, 6-9 PM). The Shipra River temperature also affects bathing comfort - monitor water quality and temperature hourly.`;
    }
    
    if (msg.includes('time') || msg.includes('when') || msg.includes('schedule')) {
      const auspiciousTimes = ['Brahma Muhurta (3:30-5:30 AM)', 'Sunrise (6:00-7:00 AM)', 'Madhyanha (11:30 AM-12:30 PM)', 'Sunset (6:30-7:30 PM)', 'Pradosh Kaal (7:00-8:30 PM)'];
      const selectedTime = auspiciousTimes[Math.floor(Math.random() * auspiciousTimes.length)];
      return `⏰ Current time: ${currentTime}. Simhastha Ujjain follows traditional Hindu time cycles. Peak spiritual hours: Mahakaleshwar Bhasma Aarti (4:00 AM daily), Ram Ghat mass bathing (5:30-8:30 AM), Evening Ganga Aarti at Shipra (7:00 PM). Next major surge predicted during ${selectedTime} in ${Math.floor(Math.random() * 120) + 30} minutes. Historical pattern: Amavasya (new moon) and Purnima (full moon) see 300% increase in footfall. Today's auspicious activities include darshan, holy bath in Shipra, pradakshina around Mahakaleshwar temple, and evening participation in collective prayers. Plan crowd management considering these spiritual peaks when devotion intensity naturally increases.`;
    }
    
    if (msg.includes('route') || msg.includes('path') || msg.includes('road')) {
      const ujjainRoutes = [
        'Mahakal Road (main temple corridor)',
        'Dewas Road (NH-52 highway access)', 
        'University Road (via Vikram University)',
        'Shipra Bypass (river parallel route)',
        'Sandipani Marg (ashram route)',
        'Bhartrihari Cave Road (historical path)'
      ];
      const selectedRoute = ujjainRoutes[Math.floor(Math.random() * ujjainRoutes.length)];
      return `🛣️ Optimal route for Ujjain Simhastha navigation: ${selectedRoute}. Current traffic density: ${Math.random() > 0.5 ? 'Light to Moderate' : 'Moderate to Heavy'}. ETA to major temples: ${randomWaitTime} minutes. Important route considerations: (1) Mahakal Road experiences maximum congestion during aarti times, (2) Shipra Bypass offers scenic river views but narrow sections near ghats, (3) University Road provides modern amenities but longer distance to temples, (4) Traditional walking paths (Parikrama Marg) around temples maintain spiritual ambiance. Historical context: These routes follow ancient paths used by King Vikramaditya's court and sage Sandipani's disciples including Lord Krishna. Modern traffic management must respect these sacred pathways while ensuring pilgrim safety.`;
    }
    
    if (msg.includes('food') || msg.includes('prasad') || msg.includes('meal')) {
      return `🍽️ Food & Prasad Management for Ujjain Simhastha: Annapurna Temple (free meal distribution) currently serving ${randomFlow} pilgrims/hour. Traditional Ujjain prasad includes: Mahakaleshwar's sacred bhasma, Ram Ghat's panchamrit, and Chintaman Ganesh's modak. Massive langars (community kitchens) operational at: (1) ISKCON Temple - international vegetarian cuisine, (2) Sikh Gurudwara near Railway Station, (3) Jain community centers. Local Ujjain specialties for pilgrims: Poha-Jalebi breakfast, Dal-Baati-Churma, and cooling drinks like Thandai and Lassi. Food safety protocols: Regular quality checks, proper refrigeration in extreme weather, cultural dietary preferences (Jain, Vaishnav, regional). Establish 24x7 food courts near major ghats with traditional seating arrangements (floor mats maintaining cultural authenticity).`;
    }
    
    if (msg.includes('accommodation') || msg.includes('stay') || msg.includes('dharamshala')) {
      return `🏠 Accommodation Analysis for Simhastha Pilgrims: Current occupancy across Ujjain: ${randomCapacity}%. Major facilities: (1) Government dharamshalas near Mahakaleshwar (₹50-100/day), (2) Private guest houses around Ram Ghat (₹200-500), (3) Ashram stays at Sandipani & ISKCON (donation-based), (4) Tent cities established by administration (free for registered pilgrims). Traditional options: Many locals open homes during Simhastha following ancient hospitality traditions. The concept of 'Atithi Devo Bhava' (guest is god) is deeply rooted in Ujjain culture. Booking recommendations: Priority to elderly, families with children, and those traveling from distant states. Emergency accommodation at Vikram University hostels and school buildings converted temporarily. Unique feature: Some accommodations offer early morning transport for Mahakaleshwar Bhasma Aarti darshan.`;
    }
    
    // Generate elaborate contextual responses for other queries with Ujjain cultural context
    const elaborateContextualResponses = [
      `🔍 Comprehensive Analysis: Based on real-time patterns at Ujjain's sacred sites, monitoring high-density zones around the 12th Jyotirlinga. Live capacity: ${randomCapacity}%. The spiritual magnetism of Mahakaleshwar, combined with Simhastha's 12-year cycle, creates unique crowd dynamics. King Vikramaditya's ancient city planning with wide roads and multiple temple access points helps, but modern pilgrim numbers exceed historical capacity. Implementing AI-driven crowd intelligence with traditional crowd management wisdom from ancient texts.`,
      
      `📈 Advanced Crowd Flow Intelligence: Analysis indicates ${Math.random() > 0.5 ? 'smooth spiritual flow' : 'dense devotional gathering'} movement patterns. Ujjain's unique position as both education hub (Vikram University) and spiritual center creates mixed demographics - students, locals, pilgrims, tourists. Current hotspot management strategy: Directing overflow from Mahakaleshwar to equally sacred but less crowded sites like Mangalnath (Mars birthplace), Chintaman Ganesh (obstacle remover), and Gadkalika Temple (divine protection). Cultural sensitivity maintained while ensuring safety.`,
      
      `🎯 Strategic Pilgrim Management: Current hotspots requiring immediate attention around ${ujjainPlaces[Math.floor(Math.random() * ujjainPlaces.length)]} with ${randomFlow} pilgrims/hour flow rate. Deploying specialized teams trained in crowd psychology during religious gatherings. The emotional and spiritual intensity of Simhastha pilgrims differs from regular tourism - they come seeking divine blessings, moksha, and spiritual purification. Management approach: Respectful guidance, spiritual announcements, traditional music for crowd soothing, and maintaining sacred atmosphere while ensuring systematic movement.`,
      
      `💡 Smart Insights with Cultural Integration: Visitor pattern analysis suggests ${Math.random() > 0.5 ? 'traditional family pilgrim groups with elderly members requiring special care' : 'young devotees and spiritual seekers with high energy levels'}. Ujjain's rich heritage includes mathematical genius Brahmagupta, poet Bhartrhari, and astronomer Varahamihira - this intellectual tradition helps in systematic crowd management. Current recommendations: (1) Digital signage in multiple languages, (2) Traditional drum announcements (dhol-nagara), (3) Volunteer guides from local colleges, (4) Cultural programs at less crowded venues to distribute crowds while maintaining festive spirit.`,
      
      `⚡ Real-time Spiritual Traffic Management: Activating digital crowd guidance systems while maintaining traditional aesthetics. Current average wait times: Mahakaleshwar darshan ${randomWaitTime} minutes, Ram Ghat bathing ${Math.floor(randomWaitTime/2)} minutes, Triveni Ghat access ${randomWaitTime + 5} minutes. The 84 ghats of Ujjain provide distributed bathing opportunities - promoting lesser-known but equally sacred ghats like Chakratirth and Pitra Ghat. Integration of modern crowd science with ancient Vastu principles used in Ujjain's temple architecture ensures both efficiency and spiritual satisfaction for pilgrims.`
    ];
    
    return elaborateContextualResponses[Math.floor(Math.random() * elaborateContextualResponses.length)];
  };

  const handleSendMessage = () => {
    if (inputValue.trim()) {
      sendMessageToLLM(inputValue);
      setInputValue('');
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  return (
    <div className="bg-slate-800 rounded-lg overflow-hidden">
      <div className="flex items-center justify-between p-4 border-b border-slate-700">
        <div className="flex items-center space-x-2">
          <Bot className="text-blue-400 w-5 h-5" />
          <h3 className="text-white font-medium">AI Assistant</h3>
          <span className="text-xs text-green-400 bg-green-400/20 px-2 py-1 rounded">Llama2</span>
        </div>
        <button
          onClick={onToggle}
          className="p-1 rounded hover:bg-slate-700 transition-colors"
          title={isCollapsed ? "Expand AI Chat" : "Collapse AI Chat"}
        >
          {isCollapsed ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </button>
      </div>
      
      {!isCollapsed && (
        <div className="p-4">
          <div className="space-y-3 mb-4 max-h-48 overflow-y-auto">
            {messages.map((message, index) => (
              <div key={index} className={`text-sm ${
                message.type === 'assistant' 
                  ? 'text-gray-300 bg-slate-700/50 p-3 rounded-lg' 
                  : 'text-blue-300 bg-blue-900/20 p-2 rounded ml-4'
              }`}>
                {message.text}
              </div>
            ))}
            {isLoading && (
              <div className="text-gray-400 bg-slate-700/50 p-3 rounded-lg text-sm">
                <div className="flex items-center space-x-2">
                  <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-blue-400"></div>
                  <span>AI is thinking...</span>
                </div>
              </div>
            )}
          </div>
          
          <div className="flex space-x-2">
            <input 
              type="text" 
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="Ask about Mahakaleshwar crowds, Shipra ghats, temple status, routes..."
              className="flex-1 bg-slate-700 text-white px-3 py-2 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              disabled={isLoading}
            />
            <button 
              onClick={handleSendMessage}
              disabled={isLoading || !inputValue.trim()}
              className="bg-blue-600 hover:bg-blue-700 disabled:bg-slate-600 text-white px-3 py-2 rounded text-sm transition-colors"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
          
          <div className="mt-2 text-xs text-slate-400">
            Powered by Llama2 • Local AI • Privacy-First
          </div>
        </div>
      )}
    </div>
  );
};

// Main Dashboard Component
const SimhasthaMonitoringDashboard = () => {
  const [analyticsCollapsed, setAnalyticsCollapsed] = useState(false);
  const [aiCollapsed, setAiCollapsed] = useState(false);

  return (
    <div className="min-h-screen bg-slate-900 text-white">
      <Header />
      
      <div className="p-6">
        <StatsCards />
        
        <div className="grid grid-cols-12 gap-6">
          {/* Left Sidebar */}
          <div className="col-span-3">
            <LiveAlerts />
            <DataLayers />
            <EmergencyActions />
          </div>
          
          {/* Main Map Area */}
          <div className={`${analyticsCollapsed && aiCollapsed ? 'col-span-9' : analyticsCollapsed || aiCollapsed ? 'col-span-7' : 'col-span-6'} transition-all duration-300`}>
            <MapView />
          </div>
          
          {/* Right Sidebar */}
          <div className={`${analyticsCollapsed && aiCollapsed ? 'col-span-0 hidden' : analyticsCollapsed || aiCollapsed ? 'col-span-2' : 'col-span-3'} transition-all duration-300`}>
            <AreaInfo />
            <CrowdAnalytics 
              isCollapsed={analyticsCollapsed} 
              onToggle={() => setAnalyticsCollapsed(!analyticsCollapsed)} 
            />
            <AIAssistant 
              isCollapsed={aiCollapsed} 
              onToggle={() => setAiCollapsed(!aiCollapsed)} 
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default SimhasthaMonitoringDashboard;