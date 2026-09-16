import { Suspense } from 'react'
import {
  AJUSTE_DA_BANDEJA_DOS_PEOES,
  BANDEJA_PEOES_LARGURA,
  BANDEJA_PEOES_PROFUNDIDADE,
  FATOR_ESTICAR_BANDEJA_PEOES,
  POSICAO_BANDEJA_PEOES,
} from './contrato'
import { ModeloNormalizado } from './Caixa'
import {
  TEXTURA_OBSCURO_DA_CESTA,
  modeloDaCaixa,
} from './modelosDaCaixa'
import { LimiteDeErroDoModelo } from './LimiteDeErroDoModelo'

/**
 * Primitiva da bandeja dos peões enquanto o GLB carrega ou se falhar: a
 * cena nunca quebra. Calha baixa na pegada esticada da fileira.
 */
function CalhaDosPeoesFallback() {
  return (
    <mesh position={[0, 0.15, 0]} castShadow receiveShadow raycast={() => null}>
      <boxGeometry
        args={[
          BANDEJA_PEOES_LARGURA,
          0.3,
          BANDEJA_PEOES_PROFUNDIDADE * FATOR_ESTICAR_BANDEJA_PEOES,
        ]}
      />
      <meshStandardMaterial color="#241a12" />
    </mesh>
  )
}

/**
 * Bandeja dos peões: duplicata ESTICADA da cesta (`serving_tray` + albedo
 * `obscuro`) sob a fileira de peões não posicionados. O esticamento é
 * não-uniforme em Z (grupo com escala sobre a normalização uniforme) para
 * a calha cobrir a fileira N=2..4 — os peões repousam no topo dela
 * (`ALTURA_BASE_PEAO_NA_BANDEJA`). Sem clique, sem wire: só mobília da
 * fileira (o clique cai na Mesa e desseleciona, como antes).
 */
export function BandejaDosPeoes() {
  const url = modeloDaCaixa('cesta')
  return (
    <group
      position={[
        POSICAO_BANDEJA_PEOES[0],
        POSICAO_BANDEJA_PEOES[1],
        POSICAO_BANDEJA_PEOES[2],
      ]}
    >
      <LimiteDeErroDoModelo
        key={url}
        resetKey={url}
        fallback={<CalhaDosPeoesFallback />}
      >
        <Suspense fallback={<CalhaDosPeoesFallback />}>
          <group scale={[1, 1, FATOR_ESTICAR_BANDEJA_PEOES]}>
            <ModeloNormalizado
              largura={BANDEJA_PEOES_LARGURA}
              profundidade={BANDEJA_PEOES_PROFUNDIDADE}
              ajuste={AJUSTE_DA_BANDEJA_DOS_PEOES}
              url={url}
              mapUrl={TEXTURA_OBSCURO_DA_CESTA}
              semNormalMap
            />
          </group>
        </Suspense>
      </LimiteDeErroDoModelo>
    </group>
  )
}
