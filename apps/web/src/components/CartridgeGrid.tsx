"use client";

import { GAMES } from "@stepup/shared";
import { anchor, cellAnchor } from "@/cartridge/anchors";
import { playSfx } from "@/lib/audio";
import { useNav } from "@/lib/nav";

/** Grille des jeux. Chaque cellule est un bouton DOM que la cartouche 3D du jeu vient recouvrir. */
export function CartridgeGrid() {
  const select = useNav((s) => s.select);
  const setHovered = useNav((s) => s.setHovered);

  return (
    <ul aria-label="Jeux" className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-x-8 gap-y-10">
      {GAMES.map((game) => (
        <li key={game.id} className="flex flex-col items-center gap-2 text-center">
          <button
            ref={anchor(cellAnchor(game.id))}
            type="button"
            aria-label={`${game.title} : ouvrir la cartouche`}
            className="aspect-[1/1.25] w-full max-w-60 cursor-pointer rounded-chunk"
            onClick={() => {
              playSfx("select");
              select(game.id);
            }}
            onPointerEnter={() => setHovered(game.id)}
            onPointerLeave={() => setHovered(null)}
            onFocus={() => setHovered(game.id)}
            onBlur={() => setHovered(null)}
          />
          <h2 className="text-xl">{game.title}</h2>
          <p className="text-sm font-semibold text-ink/70">{game.tagline}</p>
        </li>
      ))}
    </ul>
  );
}
