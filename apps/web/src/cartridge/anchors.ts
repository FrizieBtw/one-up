// Les cartouches 3D vivent dans un canvas plein écran et suivent des éléments DOM (« ancres ») :
// cellule de la grille, centre de l'écran, coin supérieur droit. Le DOM garde ainsi la mise en page,
// le défilement et l'accessibilité ; la 3D ne fait que s'y aligner.
const anchors = new Map<string, HTMLElement>();

/** Ref React qui enregistre l'élément comme ancre. */
export const anchor = (id: string) => (element: HTMLElement | null) => {
  if (element) anchors.set(id, element);
  else anchors.delete(id);
};

export const anchorRect = (id: string) => anchors.get(id)?.getBoundingClientRect();

export const cellAnchor = (gameId: string) => `cell:${gameId}`;
export const CENTER_ANCHOR = "center";
export const MINI_ANCHOR = "mini";

/** Taille de la cartouche agrandie ; partagée par l'ancre centrale et le panneau du dos. */
export const BIG_CARTRIDGE_CLASS =
  "fixed left-1/2 top-1/2 aspect-[1/1.25] h-[min(92dvh,760px)] -translate-x-1/2 -translate-y-1/2";
