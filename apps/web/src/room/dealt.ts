import { create } from "zustand";

/** Nombre de cartes de la table arrivées à leur place : l'interface attend que toutes les cartes soient distribuées avant d'afficher les actions. */
export const useDealt = create<{ landed: number }>(() => ({ landed: 0 }));

/** Jetons en cours de composition dans le panneau de mise (pas encore misés) : la table les montre déjà devant la place du joueur. */
export const useBetPreview = create<{ chips: number[] }>(() => ({ chips: [] }));
