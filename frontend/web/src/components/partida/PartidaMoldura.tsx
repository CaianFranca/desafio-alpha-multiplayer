export function PartidaMoldura() {
  return (
    <div
      data-testid="partida-moldura"
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-20"
    >
      <div className="absolute inset-0 border-4 border-amber-500/20 md:border-8 lg:border-[12px]" />
      <div className="absolute left-0 top-0 h-8 w-8 border-l-4 border-t-4 border-amber-500/40 md:h-12 md:w-12" />
      <div className="absolute right-0 top-0 h-8 w-8 border-r-4 border-t-4 border-amber-500/40 md:h-12 md:w-12" />
      <div className="absolute bottom-0 left-0 h-8 w-8 border-b-4 border-l-4 border-amber-500/40 md:h-12 md:w-12" />
      <div className="absolute bottom-0 right-0 h-8 w-8 border-b-4 border-r-4 border-amber-500/40 md:h-12 md:w-12" />
    </div>
  )
}
