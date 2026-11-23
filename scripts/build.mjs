import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = file => readFile(path.join(root, file), "utf8");
const [template, css, source, app] = await Promise.all([
  read("index.html"), read("web/style.css"), read("data/questions.json"), read("web/app.js"),
]);

const bank = JSON.stringify(JSON.parse(source)).replaceAll("<", "\\u003c");
if (/<\/script/i.test(app) || /<\/style/i.test(css)) {
  throw new Error("Unexpected closing tag in embedded JavaScript or CSS");
}
const styleTag = '<link rel="stylesheet" href="./web/style.css">';
const scriptTag = '<script type="module" src="./web/app.js"></script>';
if (!template.includes(styleTag) || !template.includes(scriptTag)) {
  throw new Error("Missing webpage stylesheet or script tag");
}
const output = template
  .replace(styleTag, () => "<style>\n" + css + "\n</style>")
  .replace(scriptTag, () => [
    '<script type="application/json" id="bank">' + bank + "</script>",
    '<script type="module">\n' + app + "\n</script>",
  ].join("\n  "));

await mkdir(path.join(root, "dist"), { recursive: true });
await writeFile(path.join(root, "dist/index.html"), output);
