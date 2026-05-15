export function WizardCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-2xl">
      <div className="rounded-md bg-white shadow-[0_4px_30px_rgba(0,0,0,0.06)] ring-1 ring-neutral-200/60">
        <div className="brand-bar h-1 rounded-t-md" />
        <div className="px-8 py-8 md:px-10">{children}</div>
      </div>
    </div>
  );
}

export function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <label className="block text-[11px] font-semibold uppercase tracking-[0.14em] text-neutral-500">
      {children}
    </label>
  );
}
