/**
 * Runs in <head> before the page paints, so a theme pinned in Settings never
 * flashes the other one first. Reads the same localStorage entry as
 * displayPrefs.ts ("app.display").
 */
export const THEME_BOOT_SCRIPT = `try{var t=JSON.parse(localStorage.getItem("app.display")||"{}").theme;if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}`;
