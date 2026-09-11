interface ModalDeExpulsaoProps {
  onOk: () => void
}

/**
 * Popup de auto-expulsão: o jogador foi removido da sala pelo Anfitrião e
 * notificado via MEMBRO_EXPULSO no próprio socket. Aviso claro + botão OK
 * que navega de volta à tela de criar/entrar sala.
 */
export function ModalDeExpulsao({ onOk }: ModalDeExpulsaoProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="presentation">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label="Você foi expulso da sala"
        className="max-w-sm w-full bg-[#1e1e1e] border border-white/30 p-8 flex flex-col items-start gap-4"
      >
        <h2 className="text-xl font-bold text-white">Você foi expulso da sala</h2>
        <p className="text-base text-white/85 leading-relaxed">
          O Anfitrião encerrou sua participação nesta sala. Você pode criar uma nova sala ou entrar em outra pelo código.
        </p>
        <button
          type="button"
          onClick={onOk}
          autoFocus
          className="self-end border border-[#c9a86a] bg-[#c9a86a]/10 text-[#c9a86a] px-6 py-2 text-sm font-bold tracking-wider uppercase hover:bg-[#c9a86a] hover:text-black transition-colors"
        >
          OK
        </button>
      </div>
    </div>
  )
}
