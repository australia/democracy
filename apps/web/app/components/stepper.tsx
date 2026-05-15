type Step = "address" | "reps" | "message";
const ORDER: Step[] = ["address", "reps", "message"];
const LABELS: Record<Step, string> = {
  address: "ENTER YOUR ADDRESS",
  reps: "CHOOSE YOUR REPRESENTATIVES",
  message: "WRITE YOUR MESSAGE",
};

export function Stepper({
  current,
  onJump,
}: {
  current: Step;
  onJump?: (s: Step) => void;
}) {
  const idx = ORDER.indexOf(current);
  return (
    <div className="mx-auto w-full max-w-2xl select-none px-4">
      <div className="relative flex items-center justify-between">
        <div className="absolute left-[5%] right-[5%] top-1/2 -translate-y-1/2 border-t border-neutral-300" />
        {ORDER.map((s, i) => {
          const active = i === idx;
          const done = i < idx;
          const clickable = onJump && (done || active);
          return (
            <button
              key={s}
              type="button"
              disabled={!clickable}
              onClick={() => clickable && onJump(s)}
              className="relative z-10 flex flex-col items-center gap-2"
            >
              <span
                className={
                  "block size-5 rounded-full border-2 transition-colors " +
                  (active
                    ? "border-pink-500 bg-white"
                    : done
                      ? "border-pink-500 bg-pink-500"
                      : "border-neutral-300 bg-white")
                }
              >
                {active && (
                  <span className="block size-2 translate-x-1/2 translate-y-1/2 rounded-full bg-pink-500" />
                )}
              </span>
              <span
                className={
                  "text-[11px] font-semibold tracking-[0.12em] " +
                  (active ? "text-neutral-900" : "text-neutral-500")
                }
              >
                {LABELS[s]}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export type { Step };
