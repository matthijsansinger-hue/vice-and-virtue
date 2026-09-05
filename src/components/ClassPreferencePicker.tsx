"use client";

import { ROLES, ROLE_CLASSES, type ViceClass, type VirtueClass } from "@/lib/roles";
import { VICE_CLASSES, VIRTUE_CLASSES, type ClassPreference } from "@/lib/matchmaking";
import { heading } from "@/components/ui/royal";

// Pick one class per camp before queueing (migration 117). You choose for BOTH
// camps because you don't know which one you'll be dealt — the matchmaker uses
// whichever applies once it decides your side.
//
// Layout is camps across, classes down, as requested: Vice on the left, Virtue
// on the right, four rows each, exactly one checked per column.
export function ClassPreferencePicker({
  value,
  onChange,
  disabled,
}: {
  value: ClassPreference;
  onChange: (next: ClassPreference) => void;
  disabled?: boolean;
}) {
  // The roles inside a class, so you know what you're actually signing up for —
  // "Exterminators" means nothing until you see it's Murder and Vengeance.
  function rolesIn(roleClass: string) {
    return Object.values(ROLES)
      .filter((r) => r.roleClass === roleClass)
      .map((r) => r.name);
  }

  function column(
    camp: "vice" | "virtue",
    classes: (ViceClass | VirtueClass)[],
    selected: string
  ) {
    const isVice = camp === "vice";
    return (
      <div className="flex-1">
        <h3
          className={`mb-2 text-center text-lg font-bold tracking-wide ${heading}`}
          style={{ color: isVice ? "#e6889a" : "#9a9ce0" }}
        >
          {isVice ? "Vice" : "Virtue"}
        </h3>
        <ul className="flex flex-col gap-2">
          {classes.map((c) => {
            const on = selected === c;
            const members = rolesIn(c);
            return (
              <li key={c}>
                <button
                  type="button"
                  disabled={disabled}
                  aria-pressed={on}
                  onClick={() =>
                    onChange(
                      isVice
                        ? { ...value, vice: c as ViceClass }
                        : { ...value, virtue: c as VirtueClass }
                    )
                  }
                  className={
                    "flex w-full items-start gap-2.5 rounded-lg border px-3 py-2 text-left transition-colors disabled:opacity-50 " +
                    (on
                      ? "border-gold bg-gold/15"
                      : "border-cream/20 bg-black/20 hover:bg-cream/10")
                  }
                >
                  <span
                    aria-hidden
                    className={
                      "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] font-bold " +
                      (on
                        ? "border-gold bg-gold text-home-bg"
                        : "border-cream/40 text-transparent")
                    }
                  >
                    ✓
                  </span>
                  <span className="min-w-0">
                    <span
                      className={`block text-sm font-semibold ${on ? "text-gold" : "text-cream"}`}
                    >
                      {ROLE_CLASSES[c].label}
                    </span>
                    <span className="block text-[11px] leading-snug text-cream/55">
                      {members.length ? members.join(", ") : "—"}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-col gap-4 sm:flex-row sm:gap-3">
        {column("vice", VICE_CLASSES, value.vice)}
        <div className="hidden w-px shrink-0 self-stretch bg-gold/25 sm:block" />
        {column("virtue", VIRTUE_CLASSES, value.virtue)}
      </div>
      <p className="mt-3 text-center text-xs text-cream/55">
        You&rsquo;ll be dealt one camp &mdash; we try to give you the class you
        picked for whichever side you land on.
      </p>
    </div>
  );
}
