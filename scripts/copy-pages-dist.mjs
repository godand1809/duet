import { cpSync, existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const staticDir = ".vercel/output/static";
if (!existsSync(staticDir)) {
  console.log("[pages] no .vercel/output/static — skipping dist copy");
  process.exit(0);
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, name.name);
    if (name.isDirectory()) walk(path, out);
    else out.push(path);
  }
  return out;
}

const manifest = walk(".vercel/output/functions").find((path) => path.includes("_tanstack-start-manifest"));
if (!manifest) {
  console.log("[pages] client manifest missing — skipping dist copy");
  process.exit(0);
}

const manifestText = readFileSync(manifest, "utf8");
const rawAssets = [...manifestText.matchAll(/\/\.\/assets\/[^"'\\]+/g)].map((match) => match[0].slice(3));
const assets = [...new Set(rawAssets)];
const entry = assets.find((path) => /\/index-/.test(path));
const routes = assets.find((path) => /\/routes-/.test(path));
const runtime = assets.find((path) => /rolldown-runtime/.test(path));
const css = readdirSync(join(staticDir, "assets")).find((name) => name.startsWith("styles-") && name.endsWith(".css"));
if (!entry || !routes || !runtime || !css) {
  console.log("[pages] could not resolve client assets", { entry, routes, runtime, css });
  process.exit(0);
}

const rel = (path) => (path.startsWith("/") ? `.${path}` : `./${path}`);
const entryUrl = rel(entry);
const runtimeUrl = rel(runtime);
const routesUrl = rel(routes);
const stamp = Date.now();

const html = `<!DOCTYPE html><html lang="en"><head><meta charSet="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover"/><link rel="stylesheet" href="./assets/${css}" data-precedence="default"/><title>DUET</title><meta name="description" content="A private two-player table for darts, spades, hold&#x27;em, 8-ball, and battleship."/><meta name="theme-color" content="#101614"/><meta name="mobile-web-app-capable" content="yes"/><meta name="apple-mobile-web-app-capable" content="yes"/><meta name="apple-mobile-web-app-status-bar-style" content="black-translucent"/><meta name="apple-mobile-web-app-title" content="DUET"/><link rel="modulepreload" href="${entryUrl}"/><link rel="modulepreload" href="${runtimeUrl}"/><link rel="modulepreload" href="${routesUrl}"/><link rel="icon" type="image/svg+xml" href="./favicon.svg"/><link rel="manifest" href="./manifest.json"/><link rel="apple-touch-icon" href="./favicon.svg"/><script src="https://grok.com/grok-app-builder/extensions.js" defer></script></head><body><!--$--><main class="splash"><div><p class="eyebrow">Two chairs</p><h1 class="display mt-2 text-6xl">DUET</h1><p class="mt-3 text-muted">A private table for two.</p></div></main><!--/$--><script data-tsr-stream-part="">(self.$R=self.$R||{})["tsr"]=[];self.$_TSR={h(){this.hydrated=!0,this.c()},e(){this.streamEnded=!0,this.c()},c(){this.hydrated&&this.streamEnded&&(delete self.$_TSR,delete self.$R.tsr)},p(e){this.initialized?e():this.buffer.push(e)},buffer:[]};$_TSR.router=($R=>$R[0]={manifest:$R[1]={routes:$R[2]={__root__:$R[3]={preloads:$R[4]=["${entryUrl}","${runtimeUrl}"],scripts:$R[5]=[$R[6]={attrs:$R[7]={type:"module",async:!0,src:"${entryUrl}"}}]},"/":$R[8]={preloads:$R[9]=["${routesUrl}"]}}},matches:$R[10]=[$R[11]={i:"__root__\u0000",u:${stamp},s:"success",ssr:!0},$R[12]={i:"\u0000\u0000",u:${stamp},s:"success",ssr:!0}]})($R["tsr"]);$_TSR.e();{let s=document.currentScript,p;while((p=s.previousElementSibling)&&p.hasAttribute('data-tsr-stream-part'))p.remove();s.remove()}</script><script type="module" async="" src="${entryUrl}"></script><script>document.currentScript.remove();/*$tsr-stream-boundary*/</script></body></html>
`;

rmSync("dist", { recursive: true, force: true });
cpSync(staticDir, "dist", { recursive: true });
writeFileSync("dist/index.html", html);
console.log("[pages] wrote static site to ./dist");
