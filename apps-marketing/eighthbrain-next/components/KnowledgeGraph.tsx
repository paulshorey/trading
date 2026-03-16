'use client'

import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { WebGPURenderer } from 'three/webgpu'
import WebGPU from 'three/addons/capabilities/WebGPU.js'

type SpaceNode = {
  id: string
  val: number
  color: string
  x: number
  y: number
  z: number
}

type SpaceLink = {
  source: string
  target: string
  color: string
  width: number
  curvature: number
  particles: number
  speed: number
}

const rand = (min: number, max: number) => min + Math.random() * (max - min)

function generateKnowledgeGraph() {
  const coreColors = ['#f59e0b', '#fbbf24', '#84cc16', '#22c55e']
  const planetColors = ['#f97316', '#fb923c', '#facc15', '#a3e635', '#4ade80']

  const nodes: SpaceNode[] = []
  const links: SpaceLink[] = []
  const seenLinks = new Set<string>()
  const topNodeIds: string[] = []

  const addLink = (source: string, target: string, config?: Partial<SpaceLink>) => {
    if (source === target) return
    const key = [source, target].sort().join('::')
    if (seenLinks.has(key)) return
    seenLinks.add(key)

    links.push({
      source,
      target,
      color: config?.color ?? 'rgba(163, 230, 53, 0.28)',
      width: config?.width ?? rand(0.4, 1.3),
      curvature: config?.curvature ?? rand(-0.2, 0.2),
      particles: config?.particles ?? (Math.random() > 0.6 ? 2 : 1),
      speed: config?.speed ?? rand(0.002, 0.01),
    })
  }

  const topLevelCount = 7
  for (let top = 0; top < topLevelCount; top++) {
    const topAngle = (top / topLevelCount) * Math.PI * 2 + rand(-0.2, 0.2)
    const topRadius = rand(260, 460)
    const topCenter = {
      x: Math.cos(topAngle) * topRadius,
      y: rand(-140, 140),
      z: Math.sin(topAngle) * topRadius,
    }

    const coreId = `top-${top}`
    topNodeIds.push(coreId)
    nodes.push({
      id: coreId,
      val: rand(14, 20),
      color: coreColors[top % coreColors.length] ?? '#f59e0b',
      ...topCenter,
    })

    const secondLevelCount = Math.floor(rand(6, 11))
    const secondLevelIds: string[] = []
    for (let second = 0; second < secondLevelCount; second++) {
      const secondId = `second-${top}-${second}`
      secondLevelIds.push(secondId)
      const orbit = rand(120, 290)
      const theta = rand(0, Math.PI * 2)
      const phi = rand(0.25, Math.PI - 0.25)
      const x = topCenter.x + orbit * Math.sin(phi) * Math.cos(theta)
      const y = topCenter.y + orbit * Math.cos(phi)
      const z = topCenter.z + orbit * Math.sin(phi) * Math.sin(theta)

      nodes.push({
        id: secondId,
        val: rand(5.6, 9.5),
        color: planetColors[(top + second) % planetColors.length] ?? '#fb923c',
        x,
        y,
        z,
      })

      addLink(coreId, secondId, {
        color: 'rgba(251, 191, 36, 0.44)',
        width: rand(0.7, 1.5),
        particles: 2,
        speed: rand(0.004, 0.013),
      })

      if (second > 1 && Math.random() > 0.5) {
        const siblingSecond = secondLevelIds[Math.floor(Math.random() * second)]
        if (siblingSecond) {
          addLink(siblingSecond, secondId, {
            color: 'rgba(249, 115, 22, 0.24)',
            width: rand(0.2, 0.6),
            particles: 1,
            speed: rand(0.002, 0.008),
          })
        }
      }

      const thirdLevelCount = Math.floor(rand(4, 9))
      const thirdLevelIds: string[] = []
      for (let third = 0; third < thirdLevelCount; third++) {
        const thirdId = `third-${top}-${second}-${third}`
        thirdLevelIds.push(thirdId)
        const thirdOrbit = rand(58, 170)
        const thirdTheta = rand(0, Math.PI * 2)
        const thirdPhi = rand(0.28, Math.PI - 0.28)
        const tx = x + thirdOrbit * Math.sin(thirdPhi) * Math.cos(thirdTheta)
        const ty = y + thirdOrbit * Math.cos(thirdPhi)
        const tz = z + thirdOrbit * Math.sin(thirdPhi) * Math.sin(thirdTheta)

        nodes.push({
          id: thirdId,
          val: rand(1.8, 4.3),
          color: planetColors[(top + second + third + 2) % planetColors.length] ?? '#a3e635',
          x: tx,
          y: ty,
          z: tz,
        })

        addLink(secondId, thirdId, {
          color: 'rgba(163, 230, 53, 0.34)',
          width: rand(0.25, 0.8),
          particles: 1,
          speed: rand(0.003, 0.011),
        })

        if (third > 1 && Math.random() > 0.72) {
          const siblingThird = thirdLevelIds[Math.floor(Math.random() * third)]
          if (siblingThird) {
            addLink(siblingThird, thirdId, {
              color: 'rgba(132, 204, 22, 0.2)',
              width: rand(0.15, 0.4),
              particles: 1,
              speed: rand(0.002, 0.007),
            })
          }
        }
      }

      if (Math.random() > 0.82) {
        addLink(secondId, coreId, {
          color: 'rgba(249, 115, 22, 0.3)',
          width: rand(0.2, 0.5),
          particles: 1,
          speed: rand(0.002, 0.008),
        })
      }
    }
  }

  for (let i = 0; i < topNodeIds.length; i++) {
    const next = topNodeIds[(i + 1) % topNodeIds.length]
    const current = topNodeIds[i]
    if (!next || !current) continue

    addLink(current, next, {
      color: 'rgba(253, 224, 71, 0.36)',
      width: rand(1.2, 2.1),
      curvature: rand(-0.33, 0.33),
      particles: 3,
      speed: rand(0.003, 0.01),
    })

    if (Math.random() > 0.35) {
      const skip = topNodeIds[(i + 2) % topNodeIds.length]
      if (skip) {
        addLink(current, skip, {
          color: 'rgba(34, 197, 94, 0.24)',
          width: rand(0.45, 1.05),
          curvature: rand(-0.45, 0.45),
          particles: 2,
          speed: rand(0.002, 0.008),
        })
      }
    }
  }

  return { nodes, links }
}

export function KnowledgeGraph() {
  const mountRef = useRef<HTMLDivElement | null>(null)
  const graphData = useMemo(generateKnowledgeGraph, [])

  useEffect(() => {
    const mountEl = mountRef.current
    if (!mountEl) return
    if (!WebGPU.isAvailable()) return

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(58, 1, 0.1, 9000)
    camera.position.set(0, 160, 2100)

    const renderer = new WebGPURenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    })
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.08
    const maxPixelRatio = Math.min(window.devicePixelRatio || 1, 2)
    let currentPixelRatio = maxPixelRatio
    renderer.setPixelRatio(currentPixelRatio)
    renderer.setSize(mountEl.clientWidth, mountEl.clientHeight)
    renderer.domElement.style.pointerEvents = 'none'
    renderer.domElement.style.width = '100%'
    renderer.domElement.style.height = '100%'
    mountEl.appendChild(renderer.domElement)

    const ambient = new THREE.AmbientLight(0x403318, 0.95)
    const key = new THREE.DirectionalLight(0xfff2bf, 0.9)
    key.position.set(230, 250, 180)
    scene.add(ambient, key)

    const starsGeometry = new THREE.BufferGeometry()
    const starCount = 3000
    const starPos = new Float32Array(starCount * 3)
    for (let i = 0; i < starCount; i++) {
      const i3 = i * 3
      starPos[i3] = rand(-2600, 2600)
      starPos[i3 + 1] = rand(-1700, 1700)
      starPos[i3 + 2] = rand(-2600, 2600)
    }
    starsGeometry.setAttribute('position', new THREE.BufferAttribute(starPos, 3))
    const starsMaterial = new THREE.PointsMaterial({
      size: 2.1,
      sizeAttenuation: true,
      color: new THREE.Color('#fef3c7'),
      transparent: true,
      opacity: 0.62,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
    const stars = new THREE.Points(starsGeometry, starsMaterial)
    scene.add(stars)

    const sphereGeometry = new THREE.SphereGeometry(1, 16, 16)
    const nodeMaterial = new THREE.MeshStandardMaterial({
      roughness: 0.34,
      metalness: 0.1,
      emissive: new THREE.Color('#2a1a00'),
      emissiveIntensity: 0.45,
      vertexColors: true,
      transparent: true,
      opacity: 0.98,
    })
    const nodeMesh = new THREE.InstancedMesh(sphereGeometry, nodeMaterial, graphData.nodes.length)
    const nodeDummy = new THREE.Object3D()
    const nodePosById = new Map<string, THREE.Vector3>()
    graphData.nodes.forEach((node, i) => {
      const pos = new THREE.Vector3(node.x, node.y, node.z)
      nodePosById.set(node.id, pos)
      nodeDummy.position.copy(pos)
      const scale = Math.max(2.2, node.val * 1.35)
      nodeDummy.scale.setScalar(scale)
      nodeDummy.updateMatrix()
      nodeMesh.setMatrixAt(i, nodeDummy.matrix)
      nodeMesh.setColorAt(i, new THREE.Color(node.color))
    })
    nodeMesh.instanceMatrix.needsUpdate = true
    if (nodeMesh.instanceColor) nodeMesh.instanceColor.needsUpdate = true
    scene.add(nodeMesh)

    const linePositions: number[] = []
    const lineColors: number[] = []

    type LinkSegment = {
      start: THREE.Vector3
      end: THREE.Vector3
      color: THREE.Color
      speed: number
    }
    const segments: LinkSegment[] = []

    graphData.links.forEach((link) => {
      const start = nodePosById.get(link.source)
      const end = nodePosById.get(link.target)
      if (!start || !end) return

      const c = new THREE.Color(link.color)
      linePositions.push(start.x, start.y, start.z, end.x, end.y, end.z)
      lineColors.push(c.r, c.g, c.b, c.r, c.g, c.b)
      segments.push({ start, end, color: c, speed: link.speed })
    })

    const lineGeometry = new THREE.BufferGeometry()
    lineGeometry.setAttribute('position', new THREE.Float32BufferAttribute(linePositions, 3))
    lineGeometry.setAttribute('color', new THREE.Float32BufferAttribute(lineColors, 3))
    const lineMaterial = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
      depthTest: false,
    })
    const lineMesh = new THREE.LineSegments(lineGeometry, lineMaterial)
    lineMesh.frustumCulled = false
    scene.add(lineMesh)

    const flowCount = Math.min(260, segments.length * 2)
    const flowGeometry = new THREE.SphereGeometry(0.95, 10, 10)
    const flowMaterial = new THREE.MeshBasicMaterial({
      color: new THREE.Color('#bef264'),
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
    const flowMesh = new THREE.InstancedMesh(flowGeometry, flowMaterial, flowCount)
    const flowDummy = new THREE.Object3D()
    const flowState = Array.from({ length: flowCount }, (_, i) => {
      const seg = segments[i % segments.length]
      return {
        seg,
        offset: Math.random(),
        speedMul: rand(0.55, 1.45),
      }
    })
    scene.add(flowMesh)

    const startDistance = 2300
    const endDistance = 240
    const startHeight = 180
    const endHeight = 20
    const startAngle = -0.32
    const endAngle = 0.12
    const zoomDelayMs = 1200
    const zoomDurationMs = 28000
    const easeOutExpo = (t: number) => (t >= 1 ? 1 : 1 - 2 ** (-10 * t))

    let destroyed = false
    let startTs = 0
    let previousTs = 0
    let emaFrameMs = 16
    let frameCounter = 0
    let hiddenStartedAt = 0
    let pausedDuration = 0

    const resize = (pixelRatio = currentPixelRatio) => {
      const width = mountEl.clientWidth || window.innerWidth
      const height = mountEl.clientHeight || window.innerHeight
      camera.aspect = width / height
      camera.updateProjectionMatrix()
      renderer.setPixelRatio(pixelRatio)
      renderer.setSize(width, height)
    }
    resize()

    const resizeObserver = new ResizeObserver(() => {
      resize()
    })
    resizeObserver.observe(mountEl)

    const onVisibilityChange = () => {
      if (document.hidden) {
        hiddenStartedAt = performance.now()
      } else if (hiddenStartedAt) {
        pausedDuration += performance.now() - hiddenStartedAt
        hiddenStartedAt = 0
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange)

    const webGpuDeviceLossPromise = (renderer as unknown as { backend?: { device?: { lost?: Promise<unknown> } } })
      .backend?.device?.lost
    if (webGpuDeviceLossPromise) {
      webGpuDeviceLossPromise.then(() => {
        if (!destroyed) {
          destroyed = true
          renderer.setAnimationLoop(null)
        }
      })
    }

    const adjustPixelRatio = () => {
      const highLoad = emaFrameMs > 19.5
      const lowLoad = emaFrameMs < 14.5
      let next = currentPixelRatio
      if (highLoad && currentPixelRatio > 1) {
        next = Math.max(1, currentPixelRatio - 0.1)
      } else if (lowLoad && currentPixelRatio < maxPixelRatio) {
        next = Math.min(maxPixelRatio, currentPixelRatio + 0.1)
      }
      if (next !== currentPixelRatio) {
        currentPixelRatio = Number(next.toFixed(2))
        resize(currentPixelRatio)
      }
    }

    const animate = (ts: number) => {
      if (destroyed) return
      if (document.hidden) return
      if (startTs === 0) startTs = ts
      if (previousTs === 0) previousTs = ts

      const rawFrameMs = Math.min(100, Math.max(1, ts - previousTs))
      previousTs = ts
      emaFrameMs = emaFrameMs * 0.92 + rawFrameMs * 0.08
      frameCounter += 1
      if (frameCounter % 45 === 0) adjustPixelRatio()

      const elapsed = ts - startTs - pausedDuration
      const zoomElapsed = Math.max(0, elapsed - zoomDelayMs)
      const zoomT = Math.min(zoomElapsed / zoomDurationMs, 1)
      const eased = easeOutExpo(zoomT)

      const angle = startAngle + (endAngle - startAngle) * eased + elapsed * 0.00002
      const distance = startDistance + (endDistance - startDistance) * eased
      const y = startHeight + (endHeight - startHeight) * eased + Math.sin(elapsed * 0.00055) * 9
      camera.position.set(Math.cos(angle) * distance, y, Math.sin(angle) * distance)
      camera.lookAt(0, 0, 0)

      const time = elapsed * 0.001
      stars.rotation.y = time * 0.008
      stars.rotation.x = Math.sin(time * 0.13) * 0.015

      for (let i = 0; i < flowState.length; i++) {
        const flow = flowState[i]
        if (!flow) continue
        const seg = flow.seg
        if (!seg) continue

        const t = (time * (seg.speed * 22) * flow.speedMul + flow.offset) % 1
        flowDummy.position.lerpVectors(seg.start, seg.end, t)
        const pulse = 0.8 + Math.sin((t + i * 0.073) * Math.PI * 2) * 0.25
        flowDummy.scale.setScalar(pulse)
        flowDummy.updateMatrix()
        flowMesh.setMatrixAt(i, flowDummy.matrix)
      }
      flowMesh.instanceMatrix.needsUpdate = true

      renderer.render(scene, camera)
    }

    renderer.setAnimationLoop(animate)

    renderer.init().catch(() => {
      if (!destroyed) {
        destroyed = true
        renderer.setAnimationLoop(null)
      }
    })

    return () => {
      destroyed = true
      document.removeEventListener('visibilitychange', onVisibilityChange)
      resizeObserver.disconnect()
      renderer.setAnimationLoop(null)

      starsGeometry.dispose()
      starsMaterial.dispose()
      sphereGeometry.dispose()
      nodeMaterial.dispose()
      lineGeometry.dispose()
      lineMaterial.dispose()
      flowGeometry.dispose()
      flowMaterial.dispose()

      renderer.dispose()
      if (mountEl.contains(renderer.domElement)) {
        mountEl.removeChild(renderer.domElement)
      }
    }
  }, [graphData])

  return (
    <div className="absolute inset-0 overflow-hidden">
      <div className="absolute inset-0 bg-[#02030b]" />
      <div
        className="absolute inset-0 opacity-80"
        style={{
          backgroundImage: `
            radial-gradient(2px 2px at 12% 22%, rgba(255,255,255,0.85), transparent 70%),
            radial-gradient(1.7px 1.7px at 26% 78%, rgba(219,234,254,0.78), transparent 70%),
            radial-gradient(2px 2px at 42% 12%, rgba(196,181,253,0.72), transparent 70%),
            radial-gradient(1.5px 1.5px at 64% 26%, rgba(253,224,71,0.62), transparent 70%),
            radial-gradient(2.2px 2.2px at 81% 61%, rgba(167,139,250,0.75), transparent 70%),
            radial-gradient(1.6px 1.6px at 89% 17%, rgba(255,255,255,0.65), transparent 70%),
            radial-gradient(1.4px 1.4px at 72% 88%, rgba(56,189,248,0.62), transparent 70%),
            radial-gradient(1.8px 1.8px at 17% 58%, rgba(244,114,182,0.58), transparent 70%),
            radial-gradient(ellipse at 16% 26%, rgba(67,56,202,0.24), transparent 55%),
            radial-gradient(ellipse at 84% 74%, rgba(14,165,233,0.2), transparent 58%),
            radial-gradient(ellipse at 66% 18%, rgba(147,51,234,0.18), transparent 52%)
          `,
        }}
      />
      <div className="absolute top-[12%] right-[9%] h-44 w-44 rounded-full bg-indigo-500/25 blur-3xl" />
      <div className="absolute bottom-[14%] left-[8%] h-56 w-56 rounded-full bg-fuchsia-500/18 blur-3xl" />
      <div className="absolute top-[42%] left-[40%] h-36 w-36 rounded-full bg-cyan-500/16 blur-3xl" />

      <div ref={mountRef} className="pointer-events-none absolute inset-0 opacity-[0.7]" />
    </div>
  )
}
