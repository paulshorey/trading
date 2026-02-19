'use client'

import dynamic from 'next/dynamic'
import { useMemo, useEffect, useRef, useState } from 'react'

const ForceGraph3D = dynamic(() => import('react-force-graph-3d'), { ssr: false })

type SpaceNode = {
  id: string
  name: string
  val: number
  color: string
  cluster: number
  kind: 'core' | 'cluster' | 'rogue'
  x?: number
  y?: number
  z?: number
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

// Generate a denser "knowledge cosmos" with clustered constellations and sporadic outliers.
function generateKnowledgeGraph() {
  const coreColors = ['#f59e0b', '#fbbf24', '#84cc16', '#22c55e']
  const planetColors = ['#f97316', '#fb923c', '#facc15', '#a3e635', '#4ade80']
  const rogueColors = ['#fde047', '#facc15', '#bef264']

  const nodes: SpaceNode[] = []
  const links: SpaceLink[] = []
  const seenLinks = new Set<string>()
  const clusterNodeIds: string[][] = []
  const coreNodeIds: string[] = []

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

  const clusterCount = 8
  for (let c = 0; c < clusterCount; c++) {
    const armAngle = (c / clusterCount) * Math.PI * 2 + rand(-0.25, 0.25)
    const armRadius = rand(190, 360)
    const center = {
      x: Math.cos(armAngle) * armRadius,
      y: rand(-120, 120),
      z: Math.sin(armAngle) * armRadius,
    }

    const coreId = `core-${c}`
    coreNodeIds.push(coreId)
    clusterNodeIds[c] = [coreId]
    nodes.push({
      id: coreId,
      name: `Cluster Core ${c + 1}`,
      val: rand(12, 18),
      color: coreColors[c % coreColors.length] ?? '#dbeafe',
      cluster: c,
      kind: 'core',
      ...center,
    })

    const satellites = Math.floor(rand(11, 17))
    for (let i = 0; i < satellites; i++) {
      const nodeId = `cluster-${c}-${i}`
      clusterNodeIds[c]?.push(nodeId)
      const orbit = rand(60, 170)
      const theta = rand(0, Math.PI * 2)
      const phi = rand(0.2, Math.PI - 0.2)
      const x = center.x + orbit * Math.sin(phi) * Math.cos(theta)
      const y = center.y + orbit * Math.cos(phi)
      const z = center.z + orbit * Math.sin(phi) * Math.sin(theta)

      nodes.push({
        id: nodeId,
        name: `Node ${c + 1}.${i + 1}`,
        val: rand(2.2, 7.2),
        color: planetColors[(c + i) % planetColors.length] ?? '#818cf8',
        cluster: c,
        kind: 'cluster',
        x,
        y,
        z,
      })

      addLink(coreId, nodeId, {
        color: 'rgba(251, 191, 36, 0.44)',
        width: rand(0.6, 1.6),
        particles: 2,
        speed: rand(0.004, 0.013),
      })

      if (i > 1 && Math.random() > 0.35) {
        addLink(`cluster-${c}-${Math.floor(Math.random() * i)}`, nodeId, {
          color: 'rgba(249, 115, 22, 0.3)',
          width: rand(0.3, 0.95),
          particles: 1,
        })
      }

      if (i > 2 && Math.random() > 0.7) {
        addLink(`cluster-${c}-${i - 1}`, nodeId, {
          color: 'rgba(163, 230, 53, 0.34)',
          width: rand(0.4, 1.1),
          particles: 2,
          speed: rand(0.005, 0.016),
        })
      }
    }
  }

  for (let i = 0; i < coreNodeIds.length; i++) {
    const next = coreNodeIds[(i + 1) % coreNodeIds.length]
    const current = coreNodeIds[i]
    if (!next || !current) continue

    addLink(current, next, {
      color: 'rgba(253, 224, 71, 0.36)',
      width: rand(1.2, 2.1),
      curvature: rand(-0.33, 0.33),
      particles: 3,
      speed: rand(0.003, 0.01),
    })

    if (Math.random() > 0.28) {
      const skip = coreNodeIds[(i + 2) % coreNodeIds.length]
      if (skip) {
        addLink(current, skip, {
          color: 'rgba(34, 197, 94, 0.3)',
          width: rand(0.6, 1.3),
          curvature: rand(-0.45, 0.45),
          particles: 2,
        })
      }
    }
  }

  const rogueCount = 26
  for (let i = 0; i < rogueCount; i++) {
    const rogueId = `rogue-${i}`
    nodes.push({
      id: rogueId,
      name: `Rogue Signal ${i + 1}`,
      val: rand(1.3, 4.2),
      color: rogueColors[i % rogueColors.length] ?? '#fde68a',
      cluster: -1,
      kind: 'rogue',
      x: rand(-460, 460),
      y: rand(-280, 280),
      z: rand(-460, 460),
    })

    const anchorCluster = Math.floor(rand(0, clusterCount))
    const anchorNodes = clusterNodeIds[anchorCluster] ?? []
    for (let j = 0; j < Math.floor(rand(1, 3)); j++) {
      const anchor = anchorNodes[Math.floor(Math.random() * anchorNodes.length)]
      if (anchor) {
        addLink(rogueId, anchor, {
          color: 'rgba(132, 204, 22, 0.28)',
          width: rand(0.25, 0.9),
          curvature: rand(-0.55, 0.55),
          particles: 1,
          speed: rand(0.003, 0.009),
        })
      }
    }
  }

  return { nodes, links }
}

export function KnowledgeGraph() {
  const [mounted, setMounted] = useState(false)
  const [dimensions, setDimensions] = useState({ width: 1200, height: 800 })
  const graphRef = useRef<any>()
  const graphData = useMemo(generateKnowledgeGraph, [])

  useEffect(() => {
    setMounted(true)
    const updateSize = () => setDimensions({ width: window.innerWidth, height: window.innerHeight })
    updateSize()
    window.addEventListener('resize', updateSize)
    return () => window.removeEventListener('resize', updateSize)
  }, [])

  useEffect(() => {
    if (!mounted || !graphRef.current) return
    let frame = 0
    let rafId = 0

    const animateCamera = () => {
      frame += 0.0014
      const distance = 600 + Math.sin(frame * 2.1) * 40
      graphRef.current?.cameraPosition(
        {
          x: Math.cos(frame) * distance,
          y: Math.sin(frame * 0.8) * 90,
          z: Math.sin(frame) * distance,
        },
        { x: 0, y: 0, z: 0 },
        0
      )
      rafId = window.requestAnimationFrame(animateCamera)
    }

    const startId = window.setTimeout(() => {
      animateCamera()
    }, 900)

    return () => {
      window.clearTimeout(startId)
      window.cancelAnimationFrame(rafId)
    }
  }, [mounted])

  if (!mounted) {
    return (
      <div className="absolute inset-0 animate-pulse bg-gradient-to-br from-indigo-900/20 to-purple-900/20" />
    )
  }

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

      <div className="absolute inset-0 opacity-[0.58]">
        <ForceGraph3D
          ref={graphRef}
          graphData={graphData}
          rendererConfig={{ antialias: true, alpha: true }}
          backgroundColor="rgba(0,0,0,0)"
          nodeColor={(node: unknown) => {
            const c = (node as { color?: string }).color
            return typeof c === 'string' && c.startsWith('#') ? c : '#f59e0b'
          }}
          linkColor={(link: unknown) => {
            const c = (link as { color?: string }).color
            return typeof c === 'string' ? c : 'rgba(250, 204, 21, 0.3)'
          }}
          linkWidth={(link: unknown) => (link as SpaceLink).width ?? 0.8}
          linkCurvature={(link: unknown) => (link as SpaceLink).curvature ?? 0.12}
          linkDirectionalParticles={(link: unknown) => (link as SpaceLink).particles ?? 1}
          linkDirectionalParticleColor={(link: unknown) => (link as SpaceLink).color ?? '#bef264'}
          linkDirectionalParticleWidth={(link: unknown) => {
            const width = (link as SpaceLink).width ?? 1
            return Math.max(0.6, width * 0.85)
          }}
          linkDirectionalParticleSpeed={(link: unknown) => (link as SpaceLink).speed ?? 0.008}
          nodeOpacity={0.93}
          nodeResolution={10}
          d3AlphaDecay={0.026}
          d3VelocityDecay={0.21}
          warmupTicks={120}
          enableNodeDrag={false}
          enablePointerInteraction={false}
          showNavInfo={false}
          width={dimensions.width}
          height={dimensions.height}
        />
      </div>
    </div>
  )
}
