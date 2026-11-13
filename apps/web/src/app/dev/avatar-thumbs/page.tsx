import { notFound } from "next/navigation";
import { ThumbsSheet } from "./ThumbsSheet";

// Outil interne : génère les vignettes de l'éditeur d'avatar (visages et tenues) à partir des modèles KayKit. Absent du build de production.
export default function AvatarThumbsPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <ThumbsSheet />;
}
