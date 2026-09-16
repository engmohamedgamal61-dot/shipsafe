"use server";

import { redirect } from "next/navigation";
import { getAuth } from "@/server/container";

export async function signOutAction() {
  await getAuth().signOut();
  redirect("/");
}
