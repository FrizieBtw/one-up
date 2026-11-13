import { notFound } from "next/navigation";
import { AssemblySheet } from "./AssemblySheet";

// Outil interne : essai d'assemblage de pièces KayKit et de recoloration. Absent du build de production.
export default function AvatarAssemblyPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <AssemblySheet />;
}
