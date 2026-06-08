import React, { useRef, useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { theme } from './theme.js';

// Surface mesh component that interpolates between sensor points
function InterpolatedSurface({ telemetry, viewMode }) {
  const meshRef = useRef();
  const positionAttributeRef = useRef();

  // Create geometry once based on sensor layout
  const geometry = useMemo(() => {
    if (telemetry.length === 0) return null;

    // Sort sensors by x and z to create a grid
    const sorted = [...telemetry].sort((a, b) => {
      if (Math.abs(a.x - b.x) > 0.01) return a.x - b.x;
      return a.z - b.z;
    });

    const uniqueX = [...new Set(sorted.map(s => s.x))];
    const uniqueZ = [...new Set(sorted.map(s => s.z))];

    const xCount = uniqueX.length;
    const zCount = uniqueZ.length;

    const vertices = [];
    const indices = [];

    // Create vertex grid
    for (let i = 0; i < xCount; i++) {
      for (let j = 0; j < zCount; j++) {
        vertices.push(uniqueX[i], 0, uniqueZ[j]);
      }
    }

    // Create triangles
    for (let i = 0; i < xCount - 1; i++) {
      for (let j = 0; j < zCount - 1; j++) {
        const a = i * zCount + j;
        const b = i * zCount + j + 1;
        const c = (i + 1) * zCount + j;
        const d = (i + 1) * zCount + j + 1;

        indices.push(a, c, b);
        indices.push(b, c, d);
      }
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(vertices), 3));
    geom.setIndex(new THREE.BufferAttribute(new Uint32Array(indices), 1));
    geom.computeVertexNormals();

    positionAttributeRef.current = geom.getAttribute('position');
    return geom;
  }, [telemetry.length]);

  // Update surface heights each frame
  useFrame(() => {
    if (!meshRef.current || !positionAttributeRef.current || telemetry.length === 0) return;

    const sorted = [...telemetry].sort((a, b) => {
      if (Math.abs(a.x - b.x) > 0.01) return a.x - b.x;
      return a.z - b.z;
    });

    const uniqueX = [...new Set(sorted.map(s => s.x))];
    const uniqueZ = [...new Set(sorted.map(s => s.z))];

    const xCount = uniqueX.length;
    const zCount = uniqueZ.length;

    const positions = positionAttributeRef.current.array;

    // Update vertex heights based on ball positions
    let vertexIdx = 0;
    for (let i = 0; i < xCount; i++) {
      for (let j = 0; j < zCount; j++) {
        const sensorIdx = sorted.findIndex(s => Math.abs(s.x - uniqueX[i]) < 0.01 && Math.abs(s.z - uniqueZ[j]) < 0.01);
        
        if (sensorIdx >= 0) {
          const sensor = sorted[sensorIdx];
          let height = 0;

          if (viewMode === 'temperature') {
            height = sensor.is_permanent ? sensor.actual_temp : sensor.pred_temp;
          } else if (viewMode === 'humidity') {
            height = sensor.is_permanent ? sensor.actual_hum : sensor.pred_hum;
          } else {
            height = sensor.is_permanent 
              ? (sensor.actual_temp + sensor.actual_hum) / 2 
              : (sensor.pred_temp + sensor.pred_hum) / 2;
          }

          positions[vertexIdx * 3 + 1] = height * 0.3;
        }
        vertexIdx++;
      }
    }

    positionAttributeRef.current.needsUpdate = true;
    meshRef.current.geometry.computeVertexNormals();
  });

  if (!geometry) return null;

  return (
    <mesh ref={meshRef} geometry={geometry}>
      <meshPhongMaterial 
        color={theme.canvasSurface} 
        wireframe={false}
        transparent
        opacity={0.45}
        side={THREE.DoubleSide}
        flatShading={false}
      />
    </mesh>
  );
}

// Sub-component to handle interpolation smooth motion per sensor point
function SmoothSensorNode({ node, viewMode, onSelectSensor, isFocused, isSelected }) {
  const ballMeshRef = useRef();
  const ringMeshRef = useRef();
  const pillarMeshRef = useRef();
  const lightRef = useRef();

  // Pick target values based on active mode configuration
  let actualValue = 0;
  let predictedValue = 0;

  if (viewMode === 'temperature') {
    actualValue = node.actual_temp;
    predictedValue = node.pred_temp;
  } else if (viewMode === 'humidity') {
    actualValue = node.actual_hum;
    predictedValue = node.pred_hum;
  } else {
    actualValue = (node.actual_temp + node.actual_hum) / 2;
    predictedValue = (node.pred_temp + node.pred_hum) / 2;
  }

  // Map data fields to visual height bounds
  const targetActualHeight = actualValue * 0.3;
  const targetPredictedHeight = predictedValue * 0.3;

  // Initialize positions instantly on first boot to prevent radical layout shifts
  useEffect(() => {
    const startBallY = node.is_permanent ? targetActualHeight : targetPredictedHeight;
    if (ballMeshRef.current) {
      ballMeshRef.current.position.y = startBallY;
    }
    if (ringMeshRef.current) {
      ringMeshRef.current.position.y = targetActualHeight;
    }
    if (lightRef.current) {
      lightRef.current.position.y = startBallY;
    }
  }, []);

  // Frame-by-frame interpolation clock loop (Smoothing Engine)
  useFrame((state, delta) => {
    // Tuning constant: higher numbers = faster snappier tracking, lower = smoother transitions
    const lerpSpeed = 10 * delta; 

    // 1. Permanent balls follow actual data. Virtual balls follow predicted targets.
    if (ballMeshRef.current) {
      const targetBallY = node.is_permanent ? targetActualHeight : targetPredictedHeight;
      ballMeshRef.current.position.y = THREE.MathUtils.lerp(ballMeshRef.current.position.y, targetBallY, lerpSpeed);
    }

    // 2. Rings track the actual reality data height line only for non-permanent nodes
    if (ringMeshRef.current) {
      ringMeshRef.current.position.y = THREE.MathUtils.lerp(ringMeshRef.current.position.y, targetActualHeight, lerpSpeed);
    }

    // 3. Stretch support pillars dynamically to match the active virtual ball height
    if (pillarMeshRef.current && !node.is_permanent) {
      const currentBallY = ballMeshRef.current ? ballMeshRef.current.position.y : 0;
      pillarMeshRef.current.scale.y = Math.max(0.001, currentBallY);
      pillarMeshRef.current.position.y = currentBallY / 2;
    }

    // Keep the glow light aligned with the ball's current Y position
    if (lightRef.current && ballMeshRef.current) {
      lightRef.current.position.y = ballMeshRef.current.position.y;
    }

  });

  const fixedSphereRadius = 0.22;
  const opac = isFocused ? 1 : 0.15;
  
  // Set distinct aesthetic schemes based on user intent
  // Permanent: Green Balls (no ring)
  // Virtual: White Balls + Green Tracking Ring
  const ballColor = node.is_permanent ? theme.physical : theme.predicted;
  const ringColor = theme.reality;

  const predictionValue = viewMode === 'temperature'
    ? `${predictedValue.toFixed(1)}°C`
    : `${predictedValue.toFixed(1)}%`;
  const realityValue = viewMode === 'temperature'
    ? `${actualValue.toFixed(1)}°C`
    : `${actualValue.toFixed(1)}%`;

  return (
    <group position={[node.x, 0, node.z]}>
      
      {/* 1. DYNAMIC DATA TRACKING SPHERE */}
      <mesh ref={ballMeshRef} onClick={() => onSelectSensor(node)}>
        <sphereGeometry args={[fixedSphereRadius, 32, 32]} />
        <meshStandardMaterial 
          color={ballColor} 
          transparent 
          opacity={opac}
          emissive={ballColor}
          emissiveIntensity={node.is_permanent ? 0.2 : 0.6}
          roughness={1}
        />
        {isSelected && node.is_permanent && (
          <Html position={[-1.3, 0.32, 0]} center style={{ pointerEvents: 'none', color: theme.panelText, fontSize: '0.8rem', fontFamily: 'monospace', background: 'rgba(0,0,0,0.68)', padding: '5px 8px', borderRadius: '6px', whiteSpace: 'nowrap', border: `1px solid ${theme.panelBorder}` }}>
            Reality: {realityValue}
          </Html>
        )}
        {isSelected && !node.is_permanent && (
          <Html position={[-1.3, 0.32, 0]} center style={{ pointerEvents: 'none', color: theme.panelText, fontSize: '0.8rem', fontFamily: 'monospace', background: 'rgba(0,0,0,0.68)', padding: '5px 8px', borderRadius: '6px', whiteSpace: 'nowrap', border: `1px solid ${theme.panelBorder}` }}>
            Prediction: {predictionValue}
          </Html>
        )}
      </mesh>

      {/* 2. INDEPENDENT ACTUAL DATA VALUE REALITY RING (only for virtual nodes) */}
      {!node.is_permanent && (
        <>
          <mesh ref={ringMeshRef} rotation={[Math.PI / 2, 0, 0]}>
            <ringGeometry args={[fixedSphereRadius + 0.12, fixedSphereRadius + 0.18, 32]} />
            <meshBasicMaterial 
              color={ringColor} 
              transparent 
              opacity={0.8 * opac} 
              side={THREE.DoubleSide} 
            />
            {isSelected && (
              <Html position={[1.3, 0.32, 0]} center style={{ pointerEvents: 'none', color: theme.panelText, fontSize: '0.8rem', fontFamily: 'monospace', background: 'rgba(0,0,0,0.68)', padding: '5px 8px', borderRadius: '6px', whiteSpace: 'nowrap', border: `1px solid ${theme.panelBorder}` }}>
                Reality: {realityValue}
              </Html>
            )}
          </mesh>
        </>
      )}

      {/* 3. HARDWARE BASELINE STRUCTURAL ANCHOR PILLARS */}
      {!node.is_permanent && (
        <>
          <pointLight ref={lightRef} color={ringColor} intensity={10} distance={100} decay={2} />
          <mesh ref={pillarMeshRef} position={[0, 0, 0]}>
            <cylinderGeometry args={[0.01, 0.01, 1, 8]} />
            <meshBasicMaterial color={theme.panelText} transparent opacity={1 * opac} />
          </mesh>
        </>
      )}
    </group>
  );
}

export default function SensorCluster({ telemetry, viewMode, onSelectSensor, selectedSensor }) {
  const basePlate = useMemo(() => {
    if (telemetry.length === 0) return null;

    const uniqueX = [...new Set(telemetry.map((node) => node.x))].sort((a, b) => a - b);
    const uniqueZ = [...new Set(telemetry.map((node) => node.z))].sort((a, b) => a - b);

    const minX = uniqueX[0];
    const maxX = uniqueX[uniqueX.length - 1];
    const minZ = uniqueZ[0];
    const maxZ = uniqueZ[uniqueZ.length - 1];

    const width = Math.max(0.5, maxX - minX);
    const depth = Math.max(0.5, maxZ - minZ);
    const margin = Math.max(width, depth) * 0.1 + 0.5;

    return {
      centerX: (minX + maxX) / 2,
      centerZ: (minZ + maxZ) / 2,
      width: width + margin * 2,
      depth: depth + margin * 2,
      y: -0.03,
    };
  }, [telemetry]);

  return (
    <group>
      {basePlate && (
        <mesh position={[basePlate.centerX, basePlate.y, basePlate.centerZ]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[basePlate.width, basePlate.depth]} />
          <meshStandardMaterial
            color={theme.panelText}
            transparent
            opacity={0.18}
            side={THREE.DoubleSide}
          />
        </mesh>
      )}
      <InterpolatedSurface telemetry={telemetry} viewMode={viewMode} />
      {telemetry.map((node) => {
        const isFocused = selectedSensor === null || selectedSensor.id === node.id;
        const isSelected = selectedSensor?.id === node.id;
        return (
          <SmoothSensorNode 
            key={node.id}
            node={node}
            viewMode={viewMode}
            onSelectSensor={onSelectSensor}
            isFocused={isFocused}
            isSelected={isSelected}
          />
        );
      })}
    </group>
  );
}