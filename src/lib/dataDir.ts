import path from "path";

/*
 * Where the app keeps everything it saves: the library database, caches and
 * logs. `.cache/` in the project by default; SGH_DATA_DIR moves it, which an
 * installed copy uses to keep data in the user's app-data folder instead of
 * next to the program.
 */
export const DATA_DIR = process.env.SGH_DATA_DIR || path.join(process.cwd(), ".cache");
