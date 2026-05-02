import axios from "axios";
import { API_BASE } from "../config";

const DEFAULT_THEME = {
  primary_color: "#0097A7",
  secondary_color: "#E0F7FA",
  sidebar_color: "#004D5F",
  bg_color: "#F0F5F6",
  font_family: "Inter",
  brand_name: "КлиникСеть",
};

let cachedTheme = null;

export async function loadTheme() {
  try {
    const res = await axios.get(`${API_BASE}/cms/theme`);
    cachedTheme = { ...DEFAULT_THEME, ...res.data };
  } catch {
    cachedTheme = DEFAULT_THEME;
  }
  applyTheme(cachedTheme);
  return cachedTheme;
}

export function applyTheme(theme) {
  const root = document.documentElement;
  root.style.setProperty("--color-primary", theme.primary_color || DEFAULT_THEME.primary_color);
  root.style.setProperty("--color-secondary", theme.secondary_color || DEFAULT_THEME.secondary_color);
  root.style.setProperty("--color-sidebar", theme.sidebar_color || DEFAULT_THEME.sidebar_color);
  root.style.setProperty("--color-bg", theme.bg_color || DEFAULT_THEME.bg_color);
  root.style.setProperty("--font-family", `"${theme.font_family || "Inter"}", sans-serif`);

  if (theme.favicon_url) {
    let link = document.querySelector("link[rel~=\"icon\"]");
    if (!link) { link = document.createElement("link"); link.rel = "icon"; document.head.appendChild(link); }
    link.href = theme.favicon_url;
  }
  if (theme.meta_title) document.title = theme.meta_title;
  if (theme.brand_name && !theme.meta_title) document.title = theme.brand_name;
}

export function getTheme() {
  return cachedTheme || DEFAULT_THEME;
}
