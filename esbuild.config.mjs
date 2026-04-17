import esbuild from "esbuild";

const watch = process.argv.includes("--watch");

const context = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  format: "cjs",
  outfile: "dist/main.js",
  platform: "node",
  target: "es2020",
  external: ["obsidian", "electron"],
  sourcemap: true,
  minify: false,
  legalComments: "none",
});

if (watch) {
  await context.watch();
  console.log("Watching for changes...");
} else {
  await context.rebuild();
  await context.dispose();
}
