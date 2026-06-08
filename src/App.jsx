import React, { useState, useEffect, useRef } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera } from '@react-three/drei';
import { MoveLeft, Thermometer, Droplets, LayoutGrid, Play, Pause, FastForward } from 'lucide-react';
import SensorCluster from './SensorCluster.jsx';
import { theme } from './theme.js';

export default function App() {
  const [telemetryHistory, setTelemetryHistory] = useState([]);
  const [globalBounds, setGlobalBounds] = useState({
    temperature: { min: 0, max: 1 },
    humidity: { min: 0, max: 1 },
    overview: { min: 0, max: 1 },
  });
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);
  const [playSpeed, setPlaySpeed] = useState(1); 
  const [viewMode, setViewMode] = useState('overview'); 
  const [selectedSensor, setSelectedSensor] = useState(null);

  const targetCameraPos = useRef([0, 30, 50]);
  const targetLookAt = useRef([0, 0, 0]);
  const playbackTimer = useRef(null);
  const [modeMenuOpen, setModeMenuOpen] = useState(false);
  const modeMenuRef = useRef(null);

  useEffect(() => {
    const onDocClick = (e) => {
      if (modeMenuOpen && modeMenuRef.current && !modeMenuRef.current.contains(e.target)) {
        setModeMenuOpen(false);
      }
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setModeMenuOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [modeMenuOpen]);

  // 1. Load simulation data from JSON file
  useEffect(() => {
    const loadSimulationData = async () => {
      try {
        const response = await fetch('/simulation_record.json');
        if (!response.ok) {
          throw new Error(`Failed to load simulation_record.json: ${response.statusText}`);
        }
        const data = await response.json();
        
        // Handle both array and object with frames property
        const frames = Array.isArray(data) ? data : data.frames || [];
        
        const processedFrames = frames.map((frame) => {
          const recvTs = Date.now();

          // Determine frame-level timestamp (prefer top-level fields)
          const frameTs = frame.timestamp ?? frame.time ?? frame.ts ?? frame.date ??
            // fallback to first node timestamp
            ((frame.nodes && frame.nodes[0]) ? (frame.nodes[0].timestamp ?? frame.nodes[0].time ?? frame.nodes[0].ts ?? frame.nodes[0].date) : null) ??
            // last-resort receive time
            recvTs;

          const nodes = (frame.nodes || []).map(n => {
            // keep original node timestamps if present; otherwise leave nodes untouched
            return { ...n };
          });

          console.debug('Processing frame timestamp (source):', frameTs);
          return { nodes, frameTs };
        });

        setTelemetryHistory(processedFrames);

        const bounds = processedFrames.reduce((acc, frame) => {
          frame.nodes.forEach((node) => {
            const tempValue = node.is_permanent ? node.actual_temp : node.pred_temp;
            const humValue = node.is_permanent ? node.actual_hum : node.pred_hum;
            const overviewValue = node.is_permanent
              ? (node.actual_temp + node.actual_hum) / 2
              : (node.pred_temp + node.pred_hum) / 2;

            acc.temperature.min = Math.min(acc.temperature.min, tempValue);
            acc.temperature.max = Math.max(acc.temperature.max, tempValue);
            acc.humidity.min = Math.min(acc.humidity.min, humValue);
            acc.humidity.max = Math.max(acc.humidity.max, humValue);
            acc.overview.min = Math.min(acc.overview.min, overviewValue);
            acc.overview.max = Math.max(acc.overview.max, overviewValue);
          });
          return acc;
        }, {
          temperature: { min: Infinity, max: -Infinity },
          humidity: { min: Infinity, max: -Infinity },
          overview: { min: Infinity, max: -Infinity },
        });

        setGlobalBounds({
          temperature: {
            min: bounds.temperature.min === Infinity ? 0 : bounds.temperature.min,
            max: bounds.temperature.max === -Infinity ? 1 : bounds.temperature.max,
          },
          humidity: {
            min: bounds.humidity.min === Infinity ? 0 : bounds.humidity.min,
            max: bounds.humidity.max === -Infinity ? 1 : bounds.humidity.max,
          },
          overview: {
            min: bounds.overview.min === Infinity ? 0 : bounds.overview.min,
            max: bounds.overview.max === -Infinity ? 1 : bounds.overview.max,
          },
        });

        if (processedFrames.length > 0) {
          setCurrentIndex(0);
        }
      } catch (error) {
        console.error('Error loading simulation data:', error);
      }
    };

    loadSimulationData();
  }, []);

  // 2. Playback tick interval controller
  useEffect(() => {
    if (playbackTimer.current) clearInterval(playbackTimer.current);

    if (isPlaying && telemetryHistory.length > 0) {
      playbackTimer.current = setInterval(() => {
        setCurrentIndex((prevIndex) => {
          if (prevIndex >= telemetryHistory.length - 1) {
            return prevIndex; 
          }
          return prevIndex + 1;
        });
      }, 1000 / playSpeed);
    }

    return () => clearInterval(playbackTimer.current);
  }, [isPlaying, telemetryHistory.length, playSpeed]);

  const normalizeValueForMode = (value, mode) => {
    const bounds = globalBounds[mode] || { min: 0, max: 1 };
    const range = bounds.max - bounds.min || 1;
    return (value - bounds.min) / range;
  };

  const handleSensorSelect = (sensor) => {
    setSelectedSensor(sensor);
    if (viewMode === 'overview') setViewMode('temperature');
    const targetHeight = getSensorBallHeight(sensor, viewMode === 'overview' ? 'temperature' : viewMode);
    targetCameraPos.current = [sensor.x, targetHeight + 8, sensor.z + 12];
    targetLookAt.current = [sensor.x, targetHeight, sensor.z];
  };

  const handleResetView = () => {
    setSelectedSensor(null);
    setViewMode('overview');
    targetCameraPos.current = [0, 30, 50];
    targetLookAt.current = [0, 0, 0];
  };

  const getSensorBallHeight = (sensor, mode) => {
    if (!sensor) return 0;
    let rawValue = 0;

    if (mode === 'temperature') {
      rawValue = sensor.is_permanent ? sensor.actual_temp : sensor.pred_temp;
    } else if (mode === 'humidity') {
      rawValue = sensor.is_permanent ? sensor.actual_hum : sensor.pred_hum;
    } else {
      rawValue = sensor.is_permanent
        ? (sensor.actual_temp + sensor.actual_hum) / 2
        : (sensor.pred_temp + sensor.pred_hum) / 2;
    }

    const normalized = normalizeValueForMode(rawValue, mode);
    const heightScale = 3.2;
    return normalized * heightScale;
  };

  useEffect(() => {
    if (selectedSensor) {
      const targetHeight = getSensorBallHeight(selectedSensor, viewMode);
      targetCameraPos.current = [selectedSensor.x, targetHeight + 8, selectedSensor.z + 12];
      targetLookAt.current = [selectedSensor.x, targetHeight, selectedSensor.z];
    } else {
      targetCameraPos.current = [0, 30, 50];
      targetLookAt.current = [0, 0, 0];
    }
  }, [selectedSensor, viewMode]);

  const currentFrame = telemetryHistory[currentIndex] || { nodes: [], frameTs: null };
  const currentNodes = currentFrame.nodes || [];

  // --- NEW: DYNAMIC AVERAGE ERROR ENGINE CALCULATION ---
  const calculateAverageError = () => {
    const virtualNodes = currentNodes.filter(node => !node.is_permanent);
    if (virtualNodes.length === 0) return "0.0000";

    let totalError = 0;
    
    if (viewMode === 'overview') {
      // For overview: normalize errors by their respective data ranges in the current frame
      const tempValues = virtualNodes.map(n => n.actual_temp);
      const humValues = virtualNodes.map(n => n.actual_hum);
      
      const minTemp = Math.min(...tempValues);
      const maxTemp = Math.max(...tempValues);
      const minHum = Math.min(...humValues);
      const maxHum = Math.max(...humValues);
      
      const tempRange = maxTemp - minTemp || 1; // Prevent division by zero
      const humRange = maxHum - minHum || 1;
      
      virtualNodes.forEach(node => {
        const normalizedTempError = node.error_temp / tempRange;
        const normalizedHumError = node.error_hum / humRange;
        totalError += (normalizedTempError + normalizedHumError) / 2;
      });
    } else {
      virtualNodes.forEach(node => {
        if (viewMode === 'temperature') {
          totalError += node.error_temp;
        } else if (viewMode === 'humidity') {
          totalError += node.error_hum;
        }
      });
    }

    return (totalError / virtualNodes.length).toFixed(4);
  };

  const currentAvgError = calculateAverageError();
  const errorUnit = viewMode === 'temperature' ? '°C' : viewMode === 'humidity' ? '%' : 'Units';

  const currentFrameTime = (() => {
    // Prefer frame-level timestamp from the message stream
    const frameTs = currentFrame.frameTs ?? (currentNodes[0] ? (currentNodes[0].timestamp ?? currentNodes[0].time ?? currentNodes[0].ts ?? currentNodes[0].date ?? currentNodes[0].__recv_ts) : null);
    if (!frameTs) return '00:00:00';

    const date = typeof frameTs === 'number' ? new Date(frameTs) : new Date(frameTs);
    if (Number.isNaN(date.getTime())) return String(frameTs);
    const dateStr = date.toLocaleDateString();
    const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return `${dateStr} ${timeStr}`;
  })();

  return (
    <div style={{ minHeight: '100vh', width: '100vw', backgroundColor: theme.bg, color: theme.panelText, fontFamily: 'monospace', position: 'relative', overflow: 'hidden' }}>
      
      {/* HUD Header Readouts */}
      <div style={{ position: 'absolute', top: 20, left: 20, zIndex: 10, display: 'flex', flexDirection: 'column', gap: '6px', maxWidth: '50vw' }}>
        <h2 style={{ margin: 20, fontWeight: 500, letterSpacing: '1px', fontSize: '1rem', maxWidth: 'min(64ch, 100%)' }}>Greenhouse ML Hybrid Sensing System Simulation</h2>
      </div>

      {/* TIMELINE CONTROL DECK */}
      <div style={{ position: 'absolute', bottom: 110, left: '50%', transform: 'translateX(-50%)', zIndex: 10, width: 'min(92vw, 840px)', minWidth: '320px', background: theme.panel, padding: '16px 22px', borderRadius: '10px', border: `1px solid ${theme.panelBorder}`, backdropFilter: 'blur(14px)', boxShadow: '0 24px 50px rgba(0,0,0,0.35)' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '16px', marginBottom: '14px' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '14px', alignItems: 'center' }}>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', fontSize: '11px', color: theme.panelText }}>
              <span style={{ width: 12, height: 12, background: theme.predicted, borderRadius: '50%', display: 'inline-block', boxShadow: `0 0 0 1px ${theme.panelBorder}` }} />
              <span>Predicted</span>
            </div>

            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', fontSize: '12px', color: theme.panelText }}>
              <span style={{ width: 16, height: 16, borderRadius: '50%', border: `3px solid ${theme.reality}`, display: 'inline-block', boxSizing: 'border-box' }} />
              <span>Reality</span>
            </div>

            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', fontSize: '11px', color: theme.panelText }}>
              <span style={{ width: 12, height: 12, background: theme.physical, borderRadius: '50%', display: 'inline-block', boxShadow: `0 0 0 1px ${theme.panelBorder}` }} />
              <span>Physical</span>
            </div>
          </div>
          <div style={{ position: 'relative', display: 'inline-block' }} ref={modeMenuRef}>
            <button onClick={() => setModeMenuOpen(o => !o)} style={{ background: 'none', border: `1px solid ${theme.buttonBorder}`, color: theme.panelText, padding: '8px 12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '10px', borderRadius: '5px', minWidth: '130px', justifyContent: 'space-between' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                {viewMode === 'overview' && <LayoutGrid size={14} />}
                {viewMode === 'temperature' && <Thermometer size={14} />}
                {viewMode === 'humidity' && <Droplets size={14} />}
                <span style={{ fontSize: '11px', color: theme.panelText, textTransform: 'uppercase', letterSpacing: '0.75px' }}>{viewMode}</span>
              </span>
              <span style={{ fontSize: '12px', color: theme.accent }}>⌄</span>
            </button>

            {modeMenuOpen && (
              <div style={{ position: 'absolute', right: 0, bottom: 'calc(100% + 10px)', background: theme.panelSecondary, border: `1px solid ${theme.panelBorder}`, padding: '10px', borderRadius: '10px', display: 'flex', flexDirection: 'column', gap: '6px', minWidth: 160, boxShadow: '0 18px 32px rgba(0,0,0,0.35)' }}>
                <button onClick={() => { setViewMode('overview'); setModeMenuOpen(false); }} style={{ display: 'flex', gap: '10px', alignItems: 'center', background: 'none', border: 'none', color: viewMode === 'overview' ? theme.accent : theme.panelText, cursor: 'pointer', padding: '8px 6px', borderRadius: '6px', textAlign: 'left' }}><LayoutGrid size={14}/> Overview</button>
                <button onClick={() => { setViewMode('temperature'); setModeMenuOpen(false); }} style={{ display: 'flex', gap: '10px', alignItems: 'center', background: 'none', border: 'none', color: viewMode === 'temperature' ? theme.accent : theme.panelText, cursor: 'pointer', padding: '8px 6px', borderRadius: '6px', textAlign: 'left' }}><Thermometer size={14}/> Temp</button>
                <button onClick={() => { setViewMode('humidity'); setModeMenuOpen(false); }} style={{ display: 'flex', gap: '10px', alignItems: 'center', background: 'none', border: 'none', color: viewMode === 'humidity' ? theme.accent : theme.panelText, cursor: 'pointer', padding: '8px 6px', borderRadius: '6px', textAlign: 'left' }}><Droplets size={14}/> Humidity</button>
              </div>
            )}
          </div>
        </div>

        {/* Timeline Scrubbing Slider */}
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '15px', marginBottom: '12px' }}>
          <span style={{ fontSize: '12px', color: theme.mutedText }}>Frame</span>
          <input 
            type="range" 
            min={0} 
            max={telemetryHistory.length > 0 ? telemetryHistory.length - 1 : 0} 
            value={currentIndex} 
            onChange={(e) => {
              setIsPlaying(false); 
              setCurrentIndex(parseInt(e.target.value, 10));
            }}
            style={{ flex: 1, accentColor: theme.sliderAccent, cursor: 'pointer', minWidth: '160px' }}
          />
          <span style={{ fontSize: '12px', color: theme.accent }}>Frame {currentIndex + 1}/{telemetryHistory.length || 1}</span>
        </div>

        <div style={{ position: 'absolute', left: '20px', bottom: '18px', fontSize: '12px', color: theme.accent, fontFamily: 'monospace' }}>
          ERROR: {currentAvgError} {errorUnit}
        </div>
        <div style={{ position: 'absolute', right: '20px', bottom: '18px', fontSize: '12px', color: theme.accent, fontFamily: 'monospace' }}>
          TIME: {currentFrameTime}
        </div>

        {/* Playback Buttons */}
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '24px' }}>
          <button onClick={() => setIsPlaying(!isPlaying)} style={{ background: 'none', border: `1px solid ${theme.panelBorderLight}`, color: theme.panelText, padding: '8px 16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', borderRadius: '4px' }}>
            {isPlaying ? <Pause size={14}/> : <Play size={14}/>} {isPlaying ? 'PAUSE' : 'PLAY'}
          </button>

          <button 
            onClick={() => setPlaySpeed(prev => prev === 1 ? 2 : prev === 2 ? 4 : 1)} 
            style={{ background: 'none', border: `1px solid ${theme.panelBorderLight}`, color: playSpeed > 1 ? theme.accent : theme.panelText, padding: '8px 16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', borderRadius: '4px' }}
          >
            <FastForward size={14}/> {playSpeed}x Speed
          </button>
        </div>
      </div>

      

      {/* 3D WebGL Arena Canvas */}
      <div style={{ position: 'absolute', inset: 0, zIndex: 1 }}>
        <Canvas style={{ width: '100%', height: '100%' }} onPointerMissed={() => setSelectedSensor(null)}>
          <ambientLight intensity={0.5} />
          <pointLight position={[10, 50, 10]} intensity={0.6} />
          <PerspectiveCamera makeDefault position={targetCameraPos.current} fov={50} />
          <OrbitControls target={targetLookAt.current} maxPolarAngle={Math.PI / 2 - 0.05} />
          <SensorCluster telemetry={currentNodes} viewMode={viewMode} globalBounds={globalBounds} onSelectSensor={handleSensorSelect} selectedSensor={selectedSensor} />
        </Canvas>
      </div>
    </div>
  );
}