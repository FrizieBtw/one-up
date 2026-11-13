import { notFound } from "next/navigation";
import { AnimSheet } from "./AnimSheet";

// Outil interne : avatars KayKit animés (repos, marche, emotes). Absent du build de production.
export default function AvatarAnimPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <AnimSheet />;
}
