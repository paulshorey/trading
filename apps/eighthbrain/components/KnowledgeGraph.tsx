'use client'

import dynamic from 'next/dynamic'
import { useMemo, useEffect, useState } from 'react'

const ForceGraph3D = dynamic(() => import('react-force-graph-3d'), { ssr: false })

// Generate a knowledge web graph - nodes represent topics, links represent connections
function generateKnowledgeGraph() {
  const domains = [
    'Quantum Computing',
    'Machine Learning',
    'Climate Science',
    'Bioengineering',
    'Financial Markets',
    'Startup Funding',
    'Supply Chain',
    'Energy Transition',
    'Cryptography',
    'Neuroscience',
    'Economics',
    'Product Design',
    'Data Science',
    'Blockchain',
    'Space Technology',
    'Material Science',
  ]

  const nodes = domains.map((name, i) => ({
    id: name,
    name,
    val: 5 + Math.random() * 6,
    color: i % 3 === 0 ? '#6366f1' : i % 3 === 1 ? '#8b5cf6' : '#a78bfa',
  }))

  const links: { source: string; target: string }[] = []
  for (let i = 0; i < nodes.length; i++) {
    const numLinks = 2 + Math.floor(Math.random() * 3)
    for (let j = 0; j < numLinks; j++) {
      const target = Math.floor(Math.random() * nodes.length)
      const sourceNode = nodes[i]
      const targetNode = nodes[target]
      if (
        target !== i &&
        sourceNode &&
        targetNode &&
        !links.some((l) => l.source === sourceNode.id && l.target === targetNode.id)
      ) {
        links.push({ source: sourceNode.id, target: targetNode.id })
      }
    }
  }

  return { nodes, links }
}

export function KnowledgeGraph() {
  const [mounted, setMounted] = useState(false)
  const [dimensions, setDimensions] = useState({ width: 1200, height: 800 })
  const graphData = useMemo(generateKnowledgeGraph, [])

  useEffect(() => {
    setMounted(true)
    const updateSize = () => setDimensions({ width: window.innerWidth, height: window.innerHeight })
    updateSize()
    window.addEventListener('resize', updateSize)
    return () => window.removeEventListener('resize', updateSize)
  }, [])

  if (!mounted) {
    return (
      <div className="absolute inset-0 animate-pulse bg-gradient-to-br from-indigo-900/20 to-purple-900/20" />
    )
  }

  return (
    <div className="absolute inset-0 overflow-hidden opacity-30">
      <ForceGraph3D
        graphData={graphData}
        backgroundColor="#0a0a0f"
        nodeColor={(node: unknown) => {
          const c = (node as { color?: string }).color
          return (typeof c === 'string' && c.startsWith('#')) ? c : '#6366f1'
        }}
        linkColor={() => '#4a4a6a'}
        linkWidth={0.5}
        nodeOpacity={0.85}
        enableNodeDrag={false}
        showNavInfo={false}
        width={dimensions.width}
        height={dimensions.height}
        onEngineStop={() => {}}
      />
    </div>
  )
}
