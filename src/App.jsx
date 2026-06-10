import React, { useState, useEffect, useRef } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera } from '@react-three/drei';
import { MoveLeft, Thermometer, Droplets, LayoutGrid, Play, Pause, FastForward } from 'lucide-react';
import SensorCluster from './SensorCluster.jsx';
import { theme } from './theme.js';

export default function App() {
  const [telemetryHistory, setTelemetryHistory] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);
  const [playSpeed, setPlaySpeed] = useState(1); 
  const [viewMode, setViewMode] = useState('overview'); 
  const [selectedSensor, setSelectedSensor] = useState(null);

  const targetCameraPos = useRef([0, 30, 50]);
  const targetLookAt = useRef([0, 0, 0]);
  const playbackTimer = useRef(null);
  const [modeMenuOpen, setModeMenuOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const modeMenuRef = useRef(null);
  const infoRef = useRef(null);

  useEffect(() => {
    const onDocClick = (e) => {
      if (modeMenuOpen && modeMenuRef.current && !modeMenuRef.current.contains(e.target)) {
        setModeMenuOpen(false);
      }
      if (infoOpen && infoRef.current && !infoRef.current.contains(e.target)) {
        setInfoOpen(false);
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
        const response = await fetch(`${import.meta.env.BASE_URL}simulation_record.json`);
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
    if (mode === 'temperature') {
      return (sensor.is_permanent ? sensor.actual_temp : sensor.pred_temp) * 0.3;
    }
    if (mode === 'humidity') {
      return (sensor.is_permanent ? sensor.actual_hum : sensor.pred_hum) * 0.3;
    }
    const value = sensor.is_permanent
      ? (sensor.actual_temp + sensor.actual_hum) / 2
      : (sensor.pred_temp + sensor.pred_hum) / 2;
    return value * 0.3;
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
      <div style={{ position: 'absolute', top: 20, left: 20, zIndex: 10, display: 'flex', flexDirection: 'column', gap: '10px', maxWidth: '50vw' }} ref={infoRef}>
        <button onClick={() => setInfoOpen((open) => !open)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', padding: '16px 20px', borderRadius: '16px', border: `1px solid ${theme.panelBorder}`, background: theme.panel, color: theme.panelText, fontSize: '1rem', fontWeight: 600, cursor: 'pointer', textAlign: 'left', boxShadow: '0 18px 40px rgba(0,0,0,0.18)' }}>
          <span>Greenhouse ML Hybrid Sensing System Simulation</span>
          <span style={{ transform: infoOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 180ms ease' }}>⌄</span>
        </button>

        {infoOpen && (
          <div style={{ width: 'min(100%, 680px)', background: theme.panelSecondary, border: `1px solid ${theme.panelBorder}`, borderRadius: '18px', padding: '22px', color: theme.panelText, boxShadow: '0 24px 60px rgba(0,0,0,0.2)', minHeight: '140px', maxHeight: 'calc(100vh - 360px)', overflowY: 'auto', textAlign: 'left', marginBottom: '32px' }}>
            <p style={{ margin: 0, fontSize: '0.98rem', lineHeight: 1.7, color: theme.panelText, textAlign: 'left' }}>
              Welcome to the interactive playback demo of Fovea, a next-generation greenhouse hybrid sensing system that combines physical sensors, machine learning, and virtual sensing to achieve high-resolution environmental awareness with reduced sensing infrastructure.
            </p>

            <p style={{ margin: '18px 0 0', fontSize: '0.98rem', lineHeight: 1.7, color: theme.panelText }}>
              This demo showcases a high-fidelity greenhouse digital twin powered by a custom-trained GNN-LSTM (Graph Neural Network + Long Short-Term Memory) deep learning model. By learning spatial and temporal relationships between sensor locations, the system can accurately reconstruct microclimate conditions at locations where no physical sensor is present.
            </p>

            <h3 style={{ margin: '24px 0 10px', fontSize: '1rem', fontWeight: 700, letterSpacing: '0.7px' }}>Controls</h3>
            <ul style={{ paddingLeft: '20px', margin: 0, lineHeight: 1.7, textAlign: 'left' }}>
              <li>Left Mouse Button (LMB) — Rotate</li>
              <li>Right Mouse Button (RMB) — Pan</li>
              <li>Scroll Wheel — Zoom</li>
            </ul>

            <div style={{ margin: '22px 0', borderTop: `1px solid ${theme.panelBorder}`, opacity: 0.55 }} />

            <h3 style={{ margin: '0 0 12px', fontSize: '1rem', fontWeight: 700, letterSpacing: '0.7px' }}>How the System Works</h3>
            <div style={{ display: 'grid', gap: '16px' }}>
              <div>
                <h4 style={{ margin: '0 0 8px', fontSize: '0.95rem', fontWeight: 700 }}>1. Deploy</h4>
                <p style={{ margin: 0, lineHeight: 1.7 }}>A dense sensor network is temporarily installed throughout the greenhouse to collect high-resolution environmental data.</p>
              </div>
              <div>
                <h4 style={{ margin: '0 0 8px', fontSize: '0.95rem', fontWeight: 700 }}>2. Learn</h4>
                <p style={{ margin: 0, lineHeight: 1.7 }}>Using continuous sensor measurements, the machine learning model learns relationships between environmental conditions across both space and time.</p>
                <p style={{ margin: '10px 0 0', lineHeight: 1.7 }}>
                  During training, the model predicts values at selected sensor locations and continuously compares these predictions against real sensor measurements. Prediction errors are used to iteratively improve the model until sufficient accuracy is achieved.
                </p>
              </div>
              <div>
                <h4 style={{ margin: '0 0 8px', fontSize: '0.95rem', fontWeight: 700 }}>3. Reduce</h4>
                <p style={{ margin: 0, lineHeight: 1.7 }}>Once the model has demonstrated reliable performance on previously unseen data, the temporary sensor nodes are no longer required.</p>
                <p style={{ margin: '10px 0 0', lineHeight: 1.7 }}>
                  These sensors can be removed or redeployed elsewhere, reducing hardware, installation, calibration, and maintenance costs while retaining much of the original sensing resolution through virtual sensing.
                </p>
              </div>
              <div>
                <h4 style={{ margin: '0 0 8px', fontSize: '0.95rem', fontWeight: 700 }}>4. Infer</h4>
                <p style={{ margin: 0, lineHeight: 1.7 }}>The remaining permanent sensors continue providing real-time measurements.</p>
                <p style={{ margin: '10px 0 0', lineHeight: 1.7 }}>
                  Using these inputs, the trained model reconstructs environmental conditions throughout the greenhouse, generating a high-resolution digital climate map that includes both physical and virtual sensing locations.
                </p>
              </div>
              <div>
                <h4 style={{ margin: '0 0 8px', fontSize: '0.95rem', fontWeight: 700 }}>5. Validate</h4>
                <p style={{ margin: 0, lineHeight: 1.7 }}>In a future operational deployment, uncertain predictions, anomalies, or elevated disease-risk regions can trigger targeted validation using mobile sensing platforms, creating a hierarchical sensing architecture that combines sparse permanent sensing with adaptive high-resolution inspection.</p>
              </div>
              <div>
                <h4 style={{ margin: '0 0 8px', fontSize: '0.95rem', fontWeight: 700 }}>6. Control</h4>
                <p style={{ margin: 0, lineHeight: 1.7 }}>The reconstructed climate data can be integrated into greenhouse control systems, such as KUBO's AutoPylot, enabling climate control decisions to be based on a richer and more detailed understanding of greenhouse conditions.</p>
              </div>
            </div>

            <div style={{ margin: '22px 0', borderTop: `1px solid ${theme.panelBorder}`, opacity: 0.55 }} />

            <h3 style={{ margin: '0 0 12px', fontSize: '1rem', fontWeight: 700, letterSpacing: '0.7px' }}>Simulation Method</h3>
            <div style={{ display: 'grid', gap: '16px' }}>
              <div>
                <h4 style={{ margin: '0 0 8px', fontSize: '0.95rem', fontWeight: 700 }}>Machine Learning Architecture</h4>
                <ul style={{ paddingLeft: '20px', margin: 0, lineHeight: 1.7 }}>
                  <li>Custom GNN-LSTM deep learning model</li>
                  <li>Graph Neural Network (GNN) layer for spatial relationship learning</li>
                  <li>Long Short-Term Memory (LSTM) layer for temporal pattern learning</li>
                  <li>Genetic Algorithm for permanent sensor selection optimization</li>
                </ul>
              </div>
              <div>
                <h4 style={{ margin: '0 0 8px', fontSize: '0.95rem', fontWeight: 700 }}>Dataset</h4>
                <p style={{ margin: 0, lineHeight: 1.7 }}>
                  Training and validation data are based on the open-source greenhouse monitoring dataset:
                </p>
                <p style={{ margin: '10px 0 0 0.5rem', lineHeight: 1.7 }}>
                  Singh, R. K., Rahmani, M. H., Weyn, M., & Berkvens, R. (2022). Joint Communication and Sensing: A Proof of Concept and Datasets for Greenhouse Monitoring Using LoRaWAN. Sensors, 22(4), 1326.
                </p>
                <p style={{ margin: 0, lineHeight: 1.7 }}>
                  DOI: <a href="https://doi.org/10.3390/s22041326" target="_blank" rel="noreferrer noopener" style={{ color: theme.accent, textDecoration: 'underline' }}>https://doi.org/10.3390/s22041326</a>
                </p>
              </div>
              <div>
                <h4 style={{ margin: '0 0 8px', fontSize: '0.95rem', fontWeight: 700 }}>Dataset Specifications</h4>
                <ul style={{ paddingLeft: '20px', margin: 0, lineHeight: 1.7 }}>
                  <li>9 months of continuous greenhouse measurements</li>
                  <li>10-minute sampling interval</li>
                  <li>Temperature and relative humidity data</li>
                  <li>27 sensor locations in total</li>
                  <li>14 permanent sensor locations</li>
                  <li>13 virtual sensor locations</li>
                  <li>80/20 training-validation split</li>
                  <li>Global Z-score normalization applied across all sensors and features</li>
                </ul>
              </div>
            </div>

            <div style={{ margin: '22px 0', borderTop: `1px solid ${theme.panelBorder}`, opacity: 0.55 }} />

            <h3 style={{ margin: '0 0 12px', fontSize: '1rem', fontWeight: 700, letterSpacing: '0.7px' }}>Disclaimer</h3>
            <p style={{ margin: 0, lineHeight: 1.7 }}>
              This demonstrator is intended as a proof-of-concept for exploring the feasibility of hybrid physical-virtual sensing systems in greenhouse environments. The presented model and dataset are used to demonstrate the underlying sensing architecture and should not be interpreted as a production-ready greenhouse control solution.
            </p>
          </div>
        )}
      </div>

      {/* TIMELINE CONTROL DECK */}
      <div style={{ position: 'absolute', bottom: 78, left: '50%', transform: 'translateX(-50%)', zIndex: 10, width: 'min(92vw, 840px)', minWidth: '320px', background: theme.panel, padding: '14px 20px', borderRadius: '10px', border: `1px solid ${theme.panelBorder}`, backdropFilter: 'blur(14px)', boxShadow: '0 24px 50px rgba(0,0,0,0.35)' }}>
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
          <SensorCluster telemetry={currentNodes} viewMode={viewMode} onSelectSensor={handleSensorSelect} selectedSensor={selectedSensor} />
        </Canvas>
      </div>
    </div>
  );
}