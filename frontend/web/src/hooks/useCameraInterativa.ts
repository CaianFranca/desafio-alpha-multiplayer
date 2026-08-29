import { useEffect, useLayoutEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import {
  atingiuLimiar,
  panDeltaToWorld,
  clampAlvo,
  calcularDistanciaAfastada,
  calcularDistanciaProxima,
  clampDistancia,
  aspectoVisivel,
  resolverAltura,
  calcularFatorPinch,
  distanciaPinch,
  poseCamera,
  SENSIBILIDADE_WHEEL,
  criarDragInicial,
  criarPinchInicial,
} from '../game/ambiente/cameraLimites'
import type { AlvoXZ, EstadoDrag, EstadoPinch } from '../game/ambiente/cameraLimites'
import { FOV_CAMERA } from '../game/ambiente/contrato'

interface UseCameraInterativaOptions {
  /** Largura da borda da moldura em px (medida via PartidaMoldura). */
  bordaPx?: number
}

/**
 * Hook de câmera interativa: arrasto (pan), zoom (wheel/pinch) e correção de aspect.
 * Recebe bordaPx desacoplado (sem querySelector) para cálculo de aspecto visível.
 */
export function useCameraInterativa({ bordaPx = 0 }: UseCameraInterativaOptions = {}): void {
  const { camera, gl, size, invalidate } = useThree()
  const { width, height } = size

  const alvoRef = useRef<AlvoXZ>({ x: 0, z: 0 })
  const distanciaRef = useRef(calcularDistanciaAfastada())
  const suprimirCliqueAposArrastoRef = useRef(false)

  const dragRef = useRef<EstadoDrag>(criarDragInicial())
  const pinchRef = useRef<EstadoPinch>(criarPinchInicial())

  const ponteirosRef = useRef<Map<number, { x: number; y: number }>>(new Map())

  function getAspectVis(): number {
    return aspectoVisivel({ width, height }, bordaPx)
  }

  function aplicarAlvoClampado(alvo: AlvoXZ, dist: number): void {
    const aspect = getAspectVis()
    alvoRef.current = clampAlvo(alvo, dist, FOV_CAMERA, aspect)
    invalidate()
  }

  const distanciaAfastadaInicial = calcularDistanciaAfastada()
  const distanciaAfastadaRef = useRef(distanciaAfastadaInicial)
  const distanciaProximaTeoricaRef = useRef(calcularDistanciaProxima(distanciaAfastadaInicial))

  useLayoutEffect(() => {
    const nextAfastada = calcularDistanciaAfastada(getAspectVis())
    const nextProxima = calcularDistanciaProxima(nextAfastada)
    distanciaAfastadaRef.current = nextAfastada
    distanciaProximaTeoricaRef.current = nextProxima
    const clampedDist = clampDistancia(distanciaRef.current, nextAfastada, nextProxima)
    if (clampedDist !== distanciaRef.current) distanciaRef.current = clampedDist
    const reClamped = clampAlvo(alvoRef.current, clampedDist, FOV_CAMERA, getAspectVis())
    if (reClamped.x !== alvoRef.current.x || reClamped.z !== alvoRef.current.z) {
      alvoRef.current = reClamped
      invalidate()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, height, bordaPx, invalidate])

  /* eslint-disable react-hooks/immutability -- mutação de câmera R3F é intencional */
  useFrame(() => {
    const persp = camera as THREE.PerspectiveCamera
    const aspect = getAspectVis()
    if (persp.isPerspectiveCamera) {
      if (Math.abs(persp.aspect - aspect) > 1e-4) {
        persp.aspect = aspect
        persp.updateProjectionMatrix()
      }
      if (Math.abs(persp.fov - FOV_CAMERA) > 1e-4) {
        persp.fov = FOV_CAMERA
        persp.updateProjectionMatrix()
      }
    }
    const { pos, alvo: alvoVec } = poseCamera(alvoRef.current, distanciaRef.current)
    persp.position.set(pos[0], pos[1], pos[2])
    persp.lookAt(alvoVec[0], alvoVec[1], alvoVec[2])
  })
  /* eslint-enable react-hooks/immutability */

  useEffect(() => {
    const canvas = gl.domElement
    const alvoEl = (canvas.parentElement ?? canvas) as HTMLElement

    function aplicarZoom(novaDistancia: number): void {
      const clamped = clampDistancia(
        novaDistancia,
        distanciaAfastadaRef.current,
        distanciaProximaTeoricaRef.current,
      )
      if (clamped === distanciaRef.current) return
      distanciaRef.current = clamped
      aplicarAlvoClampado(alvoRef.current, clamped)
    }

    function onPointerDown(e: PointerEvent): void {
      ponteirosRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })

      if (ponteirosRef.current.size === 2) {
        const d = distanciaPinch(ponteirosRef.current)
        pinchRef.current = {
          ativo: true,
          distanciaInicial: d > 0 ? d : 1,
        }
        dragRef.current.ativo = false
        dragRef.current.engatado = false
        try {
          alvoEl.setPointerCapture(e.pointerId)
        } catch {
          // ignore
        }
        return
      }

      if (ponteirosRef.current.size > 2) return

      dragRef.current.ativo = true
      dragRef.current.pointerId = e.pointerId
      dragRef.current.inicioX = e.clientX
      dragRef.current.inicioY = e.clientY
      dragRef.current.ultimoX = e.clientX
      dragRef.current.ultimoY = e.clientY
      dragRef.current.engatado = false
      try {
        alvoEl.setPointerCapture(e.pointerId)
      } catch {
        // ignore se não suportado
      }
    }

    function onPointerMove(e: PointerEvent): void {
      if (!ponteirosRef.current.has(e.pointerId)) return
      ponteirosRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })

      if (ponteirosRef.current.size === 2 && pinchRef.current.ativo) {
        const distAtual = distanciaPinch(ponteirosRef.current) || 1
        const fator = calcularFatorPinch(pinchRef.current.distanciaInicial, distAtual)
        const novaDist = pinchRef.current.distanciaInicial * fator
        const clamped = clampDistancia(
          novaDist,
          distanciaAfastadaRef.current,
          distanciaProximaTeoricaRef.current,
        )
        distanciaRef.current = clamped
        aplicarAlvoClampado(alvoRef.current, clamped)
        return
      }

      if (!dragRef.current.ativo || dragRef.current.pointerId !== e.pointerId) return

      const totalDx = e.clientX - dragRef.current.inicioX
      const totalDy = e.clientY - dragRef.current.inicioY

      if (!dragRef.current.engatado) {
        if (!atingiuLimiar(totalDx, totalDy)) return
        dragRef.current.engatado = true
        suprimirCliqueAposArrastoRef.current = true
      }

      const dx = e.clientX - dragRef.current.ultimoX
      const dy = e.clientY - dragRef.current.ultimoY
      dragRef.current.ultimoX = e.clientX
      dragRef.current.ultimoY = e.clientY

      const h = resolverAltura(height, gl.domElement.clientHeight)
      const delta = panDeltaToWorld(dx, dy, FOV_CAMERA, distanciaRef.current, h)
      const alvoNovo = {
        x: alvoRef.current.x + delta.x,
        z: alvoRef.current.z + delta.z,
      }
      aplicarAlvoClampado(alvoNovo, distanciaRef.current)
    }

    function onPointerUp(e: PointerEvent): void {
      ponteirosRef.current.delete(e.pointerId)

      if (pinchRef.current.ativo && ponteirosRef.current.size < 2) {
        pinchRef.current = criarPinchInicial()
        // Re-arme drag com o ponteiro restante, se houver
        if (ponteirosRef.current.size === 1) {
          const [[restId, pos]] = Array.from(ponteirosRef.current.entries())
          dragRef.current = {
            ativo: true,
            pointerId: restId,
            inicioX: pos.x,
            inicioY: pos.y,
            ultimoX: pos.x,
            ultimoY: pos.y,
            engatado: false,
          }
        }
      }

      if (dragRef.current.pointerId === e.pointerId) {
        const engatado = dragRef.current.engatado
        dragRef.current.ativo = false
        dragRef.current.pointerId = null
        dragRef.current.engatado = false
        try {
          alvoEl.releasePointerCapture(e.pointerId)
        } catch {
          // ignore
        }
        if (!engatado) {
          suprimirCliqueAposArrastoRef.current = false
        }
      } else {
        try {
          alvoEl.releasePointerCapture(e.pointerId)
        } catch {
          // ignore
        }
      }
    }

    function onPointerCancel(e: PointerEvent): void {
      onPointerUp(e)
    }

    function onWheel(e: WheelEvent): void {
      e.preventDefault()
      const delta = e.deltaY
      const fator = 1 + delta * SENSIBILIDADE_WHEEL
      const novaDist = distanciaRef.current * fator
      aplicarZoom(novaDist)
    }

    function onClickCapture(e: MouseEvent): void {
      if (suprimirCliqueAposArrastoRef.current) {
        e.preventDefault()
        e.stopPropagation()
        suprimirCliqueAposArrastoRef.current = false
      }
    }

    function onBlur(): void {
      ponteirosRef.current.clear()
      dragRef.current = criarDragInicial()
      pinchRef.current = criarPinchInicial()
    }

    alvoEl.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerCancel)
    window.addEventListener('blur', onBlur)
    alvoEl.addEventListener('wheel', onWheel, { passive: false })
    alvoEl.addEventListener('click', onClickCapture, true)

    return () => {
      alvoEl.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerCancel)
      window.removeEventListener('blur', onBlur)
      alvoEl.removeEventListener('wheel', onWheel)
      alvoEl.removeEventListener('click', onClickCapture, true)
    }
    // getAspectVis e aplicarAlvoClampado são estáveis via width/height/bordaPx já listados
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera, gl, invalidate, width, height, bordaPx])
}
