"""Gera o asset de aviso de tempo de turno (issue #430, spec #405).

3 bipes senoidais curtos num único arquivo — o ponto de som
(`somDoAvisoDoTurno.ts`) toca o arquivo uma única vez na chegada de
`TURNO_AVISO_30S` (one-shot; a unicidade vem do evento).

Formato: WAV 44.1kHz mono 16-bit (mesmo duto `/media/` do `card-flick.wav`).
Sem dependências além de numpy+scipy. O volume final é aplicado no
playback (`master × VOLUME_BASE_SOM_DE_AVISO_DO_TURNO`, ADR-0007), então o
arquivo é normalizado com pico em -6dBFS.

Uso: python3 gerar-aviso-turno.py  (escreve aviso-turno.wav ao lado)
"""

import numpy as np
from scipy.io import wavfile

TAXA = 44100
FREQUENCIA = 880.0  # bipe agudo, distinto do THUD de recusa
DURACAO_BIPE_S = 0.15
SILENCIO_ENTRE_S = 0.10
FADE_S = 0.010
PICO = 0.5  # -6dBFS


def bipe() -> np.ndarray:
    n = int(TAXA * DURACAO_BIPE_S)
    t = np.arange(n) / TAXA
    onda = np.sin(2 * np.pi * FREQUENCIA * t)
    fade = int(TAXA * FADE_S)
    rampa = np.linspace(0.0, 1.0, fade)
    onda[:fade] *= rampa
    onda[-fade:] *= rampa[::-1]
    return onda


def main() -> None:
    silencio = np.zeros(int(TAXA * SILENCIO_ENTRE_S))
    sinal = np.concatenate([bipe(), silencio, bipe(), silencio, bipe()])
    sinal = sinal / np.max(np.abs(sinal)) * PICO
    wavfile.write("aviso-turno.wav", TAXA, (sinal * 32767).astype(np.int16))
    print(f"aviso-turno.wav: {len(sinal) / TAXA:.2f}s, {len(sinal)} amostras")


if __name__ == "__main__":
    main()
