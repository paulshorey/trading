declare module 'three/webgpu' {
  export class WebGPURenderer {
    constructor(parameters?: Record<string, unknown>)
    domElement: HTMLCanvasElement
    outputColorSpace: string
    toneMapping: number
    toneMappingExposure: number
    setPixelRatio(value: number): void
    setSize(width: number, height: number): void
    setAnimationLoop(callback: ((time: number) => void) | null): void
    render(scene: unknown, camera: unknown): void
    init(): Promise<void>
    dispose(): void
  }

  export class Line2NodeMaterial {
    constructor(parameters?: Record<string, unknown>)
    worldUnits: boolean
    dispose(): void
  }
}

declare module 'three/addons/capabilities/WebGPU.js' {
  const WebGPU: {
    isAvailable: () => boolean
    getErrorMessage: () => HTMLDivElement
  }
  export default WebGPU
}

declare module 'three/addons/lines/webgpu/LineSegments2.js' {
  import type { Object3D } from 'three'
  export class LineSegments2 extends Object3D {
    constructor(geometry: any, material: any)
    frustumCulled: boolean
  }
}

declare module 'three/addons/lines/LineSegmentsGeometry.js' {
  export class LineSegmentsGeometry {
    setPositions(array: number[] | Float32Array): void
    setColors(array: number[] | Float32Array): void
    dispose(): void
  }
}
