import {InlineMathText} from "../../markdown/inline-math-text.js";
import React, {useLayoutEffect, useRef} from 'react';
import {AmbientLight, BoxGeometry, Color, ConeGeometry, CylinderGeometry, DirectionalLight, Group, Mesh, MeshLambertMaterial, OrthographicCamera, Scene, SphereGeometry, Vector3} from 'three';
import {SVGRenderer} from 'three/addons/renderers/SVGRenderer.js';
import type {RemotionSpatialAssemblyComponent} from "./types.js";
import type {LessonMotion} from './lesson-motion.js';
import {THEME as T} from './theme.js';

const colors = {primary: T.accent, secondary: T.compare, accent: T.caution, muted: T.tertiary};
export function spatialPosition(layout: RemotionSpatialAssemblyComponent['props']['layout'], index: number, count: number, separation: number): [number, number, number] {
  const centered = index - (count - 1) / 2;
  if (layout === 'stack') return [0, centered * (.84 + separation * .58), 0];
  if (layout === 'row') return [centered * (1.16 + separation * .48), 0, 0];
  const angle = index / count * Math.PI * 2;
  return [Math.cos(angle) * (1.6 + separation * .7), Math.sin(angle) * .45, Math.sin(angle) * (1.6 + separation * .7)];
}

/** Real Three geometry, lighting and camera projection. SVG output makes capture
 * deterministic in Electron and keeps small instructional diagrams crisp. */
export function SpatialAssembly({props, motion}: {props: RemotionSpatialAssemblyComponent['props']; motion: LessonMotion}) {
  const host = useRef<HTMLDivElement>(null);
  const labels = useRef<HTMLDivElement>(null);
  const world = useRef<{scene: Scene; camera: OrthographicCamera; renderer: SVGRenderer; group: Group; meshes: Mesh[]} | null>(null);
  useLayoutEffect(() => {
    const renderer = new SVGRenderer(); renderer.setSize(930, 620); renderer.setPrecision(3); renderer.setClearColor(new Color(T.surface), 1);
    renderer.domElement.setAttribute('aria-label', props.caption);
    const scene = new Scene(), group = new Group(); scene.add(group);
    scene.add(new AmbientLight(0xffffff, .65));
    const light = new DirectionalLight(0xffffff, .95); light.position.set(-3, 6, 5); scene.add(light);
    const meshes = props.parts.map(part => {
      const geometry = part.primitive === 'sphere' ? new SphereGeometry(.58, 16, 12) : part.primitive === 'cylinder' ? new CylinderGeometry(.55, .55, .76, 20) : part.primitive === 'cone' ? new ConeGeometry(.65, 1.1, 20) : new BoxGeometry(.96, .72, .92);
      const mesh = new Mesh(geometry, new MeshLambertMaterial({color: colors[part.tone], transparent: true}));
      group.add(mesh); return mesh;
    });
    // Fit the largest permitted separation once, so focus/assembly never rescales
    // labels or crops end pieces. The camera's slow orbit shares this fixed frame.
    const halfHeight = Math.max(2.1, ((props.parts.length - 1) * 1.42 / 2 + .9) * 1.16);
    const halfWidth = props.layout === 'stack' ? halfHeight * 1.5 : props.layout === 'row' ? Math.max(2.6, ((props.parts.length - 1) * 1.64 / 2 + .9) * 1.12) : 4.9;
    const camera = new OrthographicCamera(-halfWidth, halfWidth, halfWidth / 1.5, -halfWidth / 1.5, .1, 100);
    world.current = {scene, camera, renderer, group, meshes}; host.current?.appendChild(renderer.domElement);
    return () => {world.current = null; renderer.domElement.remove(); meshes.forEach(mesh => {mesh.geometry.dispose(); (mesh.material as MeshLambertMaterial).dispose();});};
  }, [props]);
  useLayoutEffect(() => {
    const w = world.current; if (!w) return;
    const turn = -.28 + Math.min(motion.seconds, 8) * .055;
    w.camera.position.set(Math.sin(turn) * 7 + 2, 3.1, Math.cos(turn) * 8);
    w.camera.lookAt(0, 0, 0); w.camera.updateMatrixWorld();
    w.meshes.forEach((mesh, i) => {
      mesh.position.set(...spatialPosition(props.layout, i, props.parts.length, motion.separation));
      const focus = motion.opacity(props.parts[i].id);
      (mesh.material as MeshLambertMaterial).opacity = Math.max(.12, focus);
      mesh.scale.setScalar(.7 + motion.entrance * .3);
    });
    w.renderer.render(w.scene, w.camera);
    w.meshes.forEach((mesh, i) => {
      const point = mesh.getWorldPosition(new Vector3()).project(w.camera);
      const label = labels.current?.children[i] as HTMLElement | undefined;
      if (label) {label.style.left = `${(point.x + 1) * 465}px`; label.style.top = `${(1 - point.y) * 310 + (props.layout === 'orbit' ? (i < props.parts.length / 2 ? -64 : 60) : 56)}px`; label.style.opacity = String(motion.opacity(props.parts[i].id));}
    });
  }, [motion, props]);
  return <div className="rm-spatial rm-panel" data-animation-component="spatial-assembly.v1">
    <div className="rm-spatial-stage"><div className="rm-spatial-grid"/><div ref={host}/><div className="rm-spatial-labels" ref={labels}>{props.parts.map((part, i) => <span key={part.id}>{String(i + 1).padStart(2, '0')}</span>)}</div></div>
    <div className="rm-spatial-legend">{props.parts.map((part, i) => <div key={part.id} style={{opacity: motion.opacity(part.id)}}><b style={{background: colors[part.tone]}}>{String(i + 1).padStart(2, '0')}</b><span><InlineMathText text={part.label}/></span></div>)}</div><p className="rm-spatial-caption"><InlineMathText text={props.caption}/></p>
  </div>;
}
