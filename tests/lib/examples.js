/**
 * What every suite that exercises `examples/` needs: how to find the committed
 * bands, and how to build a checkout their generators can write into.
 *
 * Discovery is a walk rather than a list, so adding a band enrols it in every
 * suite at once instead of leaving three literals to forget.
 */
import { copyFileSync, readdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";

/** Every committed `.excalidraw` and `.svg` under `dir`, at any depth, relative to `root`. */
export const artifacts = (root, dir = "examples") =>
  readdirSync(join(root, dir), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? artifacts(root, `${dir}/${e.name}`)
      : /\.(excalidraw|svg)$/.test(e.name) ? [`${dir}/${e.name}`]
      : [],
  );

/**
 * Every band under `examples/` as `{ generator, artifact }`, both relative to
 * the plugin root and `artifact` without its extension.
 *
 * A generator is named `gen-<slug>.js` and writes `<slug>.excalidraw` beside
 * itself, which is what lets one walk find both halves. A band that breaks the
 * convention goes missing from the suites, so the caller checks the walk found
 * something before trusting a green run.
 */
export const bands = (root, dir = "examples") =>
  readdirSync(join(root, dir), { withFileTypes: true }).flatMap((e) => {
    if (e.isDirectory()) return bands(root, `${dir}/${e.name}`);
    const slug = /^gen-(.+)\.js$/.exec(e.name)?.[1];
    return slug ? [{ generator: `${dir}/${e.name}`, artifact: `${dir}/${slug}` }] : [];
  });

/**
 * Make `dir` a plugin root the example generators can run inside: `tools/` and
 * `brand/` are linked rather than copied, so the run exercises the real modules.
 *
 * "junction" is the one directory link Windows creates without elevation, and
 * the type is ignored on POSIX. `package.json` is copied because it carries
 * `"type": "module"`: without it the copied generators are only ESM by Node's
 * syntax detection, a different resolution path than a real checkout takes.
 */
export function linkPluginRoot(root, dir) {
  for (const name of ["tools", "brand"]) symlinkSync(join(root, name), join(dir, name), "junction");
  copyFileSync(join(root, "package.json"), join(dir, "package.json"));
  return dir;
}
