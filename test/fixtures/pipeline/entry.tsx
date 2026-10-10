import { useState } from "react";
import { Widget } from "@/widget";
import meta from "./meta.json";
import dot from "./dot.svg?url";
import { invoke } from "@tauri-apps/api/core";

export const MARKER = "pipeline-entry";
export const DEV = import.meta.env.DEV;
export const ICON = dot;

export function App() {
  const [n] = useState(0);
  return <Widget label={meta.label} n={n} />;
}

export function load() {
  return invoke("get_providers", { app: "claude" });
}
