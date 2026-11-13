import { notFound } from "next/navigation";
import { PartsSheet } from "./PartsSheet";

// Outil interne : planche de contrôle du découpage des têtes KayKit. Absent du build de production.
export default function AvatarPartsPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <PartsSheet />;
}
