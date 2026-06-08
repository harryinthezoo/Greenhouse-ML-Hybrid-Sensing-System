import * as THREE from 'three';

// 1. Unified Shader for Beautiful Glowing points (Additive Blending)
export const BeautifulPointShader = {
  uniforms: {
    color: { value: new THREE.Color(1, 1, 1) },
    opacity: { value: 1.0 },
    glowInternal: { value: 1.0 }, // Basic brightness
    glowExternal: { value: 0.5 }, // Radiance brightness
  },
  vertexShader: `
    varying vec3 vNormal;
    void main() {
      vNormal = normalize(normalMatrix * normal);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform vec3 color;
    uniform float opacity;
    uniform float glowInternal;
    uniform float glowExternal;
    varying vec3 vNormal;
    void main() {
      // Basic silhouette glow logic
      float intensity = pow(glowInternal - dot(vNormal, vec3(0, 0, 1.0)), glowExternal);
      gl_FragColor = vec4(color, 1.0) * intensity;
      gl_FragColor.a = opacity; // Control overall opacity
    }
  `
};
