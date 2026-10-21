import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import type { TwinAsset, TwinZone } from './LiveAssetMap';

export interface TwinSensor { id: string; kind: string; location: string; x: number; y: number; status: 'OK' | 'WARN' | 'CRITICAL' | 'UNKNOWN'; lastValue: number | null; unit: string }

const STATUS_COLOR = { OK: 0x16a34a, WARN: 0xf59e0b, CRITICAL: 0xdc2626, UNKNOWN: 0x94a3b8 };

/**
 * Digital-twin 3D view. Geometry: zones as floor slabs, pallets as boxes at their live zone,
 * structural sensors as pulsing spheres coloured by threshold status. Rebuilds the scene from
 * props whenever twin state refreshes (live SSE events trigger a refetch upstream).
 */
export default function DigitalTwinViewer({ zones, assets, sensors }: { zones: TwinZone[]; assets: TwinAsset[]; sensors: TwinSensor[] }) {
  const host = useRef<HTMLDivElement>(null);
  const ctx = useRef<{ scene: THREE.Scene; group: THREE.Group; pulse: THREE.Mesh[] } | null>(null);

  useEffect(() => {
    const el = host.current!;
    const w = el.clientWidth, h = 360;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(w, h); el.appendChild(renderer.domElement);
    const scene = new THREE.Scene(); scene.background = new THREE.Color(0xf8fafc);
    const cam = new THREE.PerspectiveCamera(45, w / h, 0.1, 500);
    scene.add(new THREE.AmbientLight(0xffffff, 0.8));
    const sun = new THREE.DirectionalLight(0xffffff, 0.7); sun.position.set(40, 80, 30); scene.add(sun);
    const group = new THREE.Group(); scene.add(group);
    ctx.current = { scene, group, pulse: [] };

    let theta = 0.6, phi = 0.9, r = 120, drag = false, lx = 0, ly = 0, raf = 0;
    const place = () => { cam.position.set(50 + r * Math.sin(phi) * Math.cos(theta), r * Math.cos(phi), 30 + r * Math.sin(phi) * Math.sin(theta)); cam.lookAt(50, 0, 30); };
    const dn = (e: PointerEvent) => { drag = true; lx = e.clientX; ly = e.clientY; };
    const up = () => (drag = false);
    const mv = (e: PointerEvent) => { if (!drag) return; theta -= (e.clientX - lx) * 0.01; phi = Math.min(1.5, Math.max(0.2, phi - (e.clientY - ly) * 0.01)); lx = e.clientX; ly = e.clientY; };
    const wheel = (e: WheelEvent) => { e.preventDefault(); r = Math.min(220, Math.max(40, r + e.deltaY * 0.1)); };
    renderer.domElement.addEventListener('pointerdown', dn); window.addEventListener('pointerup', up);
    renderer.domElement.addEventListener('pointermove', mv); renderer.domElement.addEventListener('wheel', wheel, { passive: false });

    const loop = (t: number) => { raf = requestAnimationFrame(loop); place(); ctx.current!.pulse.forEach((m, i) => m.scale.setScalar(1 + 0.25 * Math.sin(t / 250 + i))); renderer.render(scene, cam); };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf); window.removeEventListener('pointerup', up); renderer.dispose(); el.removeChild(renderer.domElement);
    };
  }, []);

  useEffect(() => {
    const c = ctx.current; if (!c) return;
    c.group.clear(); c.pulse = [];
    for (const z of zones) {
      const util = z.usedMT / z.capacityMT;
      const slab = new THREE.Mesh(new THREE.BoxGeometry(z.w - 1, 0.5, z.h - 1), new THREE.MeshLambertMaterial({ color: util > 0.9 ? 0xfecaca : util > 0.75 ? 0xfde68a : 0xd1fae5 }));
      slab.position.set(z.x + z.w / 2, 0.25, z.y + z.h / 2); c.group.add(slab);
    }
    const count: Record<string, number> = {};
    for (const a of assets) {
      const z = zones.find((q) => q.code === a.zone); if (!z) continue;
      const n = (count[z.code] = (count[z.code] ?? 0) + 1) - 1;
      const box = new THREE.Mesh(new THREE.BoxGeometry(3, 2.4, 3), new THREE.MeshLambertMaterial({ color: (a.batteryV ?? 3) < 2.9 ? 0xdc2626 : 0x92400e }));
      box.position.set(z.x + 6 + (n % 4) * 10, 1.7, z.y + 7 + Math.floor(n / 4) * 8); c.group.add(box);
    }
    for (const s of sensors) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(1.1, 16, 16), new THREE.MeshBasicMaterial({ color: STATUS_COLOR[s.status] }));
      m.position.set(s.x, 6, s.y); c.group.add(m);
      if (s.status !== 'OK' && s.status !== 'UNKNOWN') c.pulse.push(m);
    }
  }, [zones, assets, sensors]);

  return <div ref={host} className="overflow-hidden rounded border border-slate-200" title="Drag to orbit, scroll to zoom" />;
}
