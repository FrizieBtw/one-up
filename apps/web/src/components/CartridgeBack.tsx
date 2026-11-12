"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { BIG_CARTRIDGE_CLASS } from "@/cartridge/anchors";
import { useNav } from "@/lib/nav";

/**
 * Interface affichée au dos de la cartouche agrandie. Le panneau DOM est aligné sur la plaque
 * claire du modèle 3D (mêmes proportions que dans CartridgeScene).
 */
export function CartridgeBack({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const back = useNav((s) => s.back);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => panel.current?.focus(), []);

  return (
    <>
      <div className="fixed inset-0 z-10 bg-ink/45" onClick={onClose} aria-hidden />
      <div className={`${BIG_CARTRIDGE_CLASS} pointer-events-none z-30`}>
        <div
          ref={panel}
          role="dialog"
          aria-modal="true"
          aria-label={title}
          tabIndex={-1}
          className="back-panel-in pointer-events-auto absolute inset-x-[6%] top-[24.4%] bottom-[3.6%] flex flex-col gap-3 overflow-y-auto rounded-2xl p-4 outline-none"
        >
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-2xl">{title}</h2>
            <button type="button" className="rounded-full border-2 border-ink bg-white px-3 py-0.5 text-sm font-extrabold" onClick={back}>
              Retour
            </button>
          </div>
          {children}
        </div>
      </div>
    </>
  );
}
