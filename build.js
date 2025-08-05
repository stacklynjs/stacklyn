// some funcs
const run = require("child_process").execSync;

const fs = require("fs");
const [remove, write, exists, rename] = [fs.rmSync, fs.writeFileSync, fs.existsSync, fs.renameSync];

// timer
const START = Date.now();

// modules to install
const MODULES = [
    "@babel/cli@latest",
    "@babel/core@latest",
    "@babel/plugin-transform-optional-chaining@latest",
    "@babel/plugin-transform-nullish-coalescing-operator@latest",
    "@babel/plugin-transform-object-rest-spread@latest",
    "terser@latest"
];

// ======= actual build process ======= \\

// make temp folder and go to it
console.log("creating /temp directory...");

run("mkdir temp");
if (exists("node_modules")) rename("node_modules", "temp/node_modules");

process.chdir("temp");
write("package.json", JSON.stringify({ name: "stacklyn_build_process" }));

console.log("finished creating temp");

// install dependencies
let start = Date.now();
console.log("installing build dependencies...");
if (!exists("node_modules")) run(`npm install ${MODULES.join(" ")}`);

let end = Date.now();

console.log(`installed ${MODULES.length} dependencies in ${((end - start) / 1000).toFixed(2)} seconds.`);

// transpile
start = Date.now();
run("npx babel ../stacklyn.js --out-file stacklyn.trans.js --plugins @babel/plugin-transform-optional-chaining,@babel/plugin-transform-nullish-coalescing-operator,@babel/plugin-transform-object-rest-spread");
end = Date.now();
console.log(`code transpilation finished in ${((end - start) / 1000).toFixed(2)} seconds.`);

// minify
start = Date.now();
run("npx terser stacklyn.trans.js -o ../dist/stacklyn.min.js -c -m");
end = Date.now();
console.log(`code successfully minified in ${((end - start) / 1000).toFixed(2)} seconds.`);

// remove everything else
process.chdir("..");

if (exists("temp/node_modules")) rename("temp/node_modules", "node_modules");
remove("temp", { recursive: true, force: true });

const END = Date.now();
console.log(`build process finished, time taken: ${((END - START) / 1000).toFixed(2)} seconds.`);