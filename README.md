<p align="center">
    <img src="./images/stacklyn/Gradient.png" height="120">
</p>

<h1 align="center">Stacklyn</h1>

<p align="center">
  Turn JavaScript stack traces into structured data.
  <br>
  <i>Supports V8, SpiderMonkey, JavaScriptCore, Carakan, Internet Explorer, and more.</i>
</p>

<p align="center"><code>npm install stacklyn</code></p>

<p align="center">Pretty cool, right? Well there's actually even more!</p>

---

## Getting Started

Live demo is at https://stacklynjs.github.io/demo.

First and foremost, `npm install stacklyn`.  
*(and/or use one of the direct import methods listed below)*  

Here's some example usage code so you don't feel lost while I finish writing the docs and demos:

```js
import Stacklyn from "stacklyn";

try {
    // some risky code here that might throw an error
} catch (error) {
    // array of objects
    const parsed = Stacklyn.parse(error);

    // still an array of objects
    const mapped = Stacklyn.map(parsed);

    mapped.forEach(frame => console.log(frame.raw)); // log the sourcemapped stack frames

    // i would've done a better guide but i've been working on this since may 26
    // and since i wanted to release it for so long this will do for now.
    //   - doctoon, sorry for inconvinence, docs are coming soon i promise
}
```

### What we offer:
- Stacktrace Parsing (for more info, see [`parse()`](https://stacklynjs.github.io/docs?p=api/parse))
- Turn a parsed stack back into a string (for more info, see [`stringify()`](https://stacklynjs.github.io/docs?p=api/stringify))
- Stacktrace Converting (for more info, see [`convert()`](https://stacklynjs.github.io/docs?p=api/convert))
- Support for V8 `CallSite` objects (for more info, see [`parseCS()`](https://stacklynjs.github.io/docs?p=api/parseCS) and [`getCallSites()`](https://stacklynjs.github.io/docs?p=api/getCallSites))
- Source Maps (for more info, see [`map()`](https://stacklynjs.github.io/docs?p=api/map))
- Enriching frames with context info (for more info, see [`enrich()`](https://stacklynjs.github.io/docs?p=api/enrich))
- Make error properties enumerable (for more info, see [`serializeError()`](https://stacklynjs.github.io/docs?p=api/serializeError))
- And best of all, supports most stack trace formats you'll come across!

<sub>*Stacklyn V2 will add even more cool stuff! See the [roadmap](https://stacklynjs.github.io/docs?p=stacklyn/roadmap) to know more.*</sub>

### Supported Formats
- <img height="24" src="./images/chrome.png" align="center">&nbsp; Chrome 3+ (V8)
- <img height="24" src="./images/node.svg" align="center">&nbsp; Node.js (V8)
- <img height="24" src="./images/electron.svg" align="center">&nbsp; Electron (V8)
- <img height="24" src="./images/deno.svg" align="center">&nbsp; Deno (V8)
- <img height="24" src="./images/firefox.png" align="center">&nbsp; Firefox 1+ (SpiderMonkey)
- <img height="24" src="./images/safari.png" align="center">&nbsp; Safari 6+ (JSC)
- <img height="24" src="./images/bun.svg" align="center">&nbsp; Bun (V8-JSC Hybrid)
- <img height="24" src="./images/ie.png" align="center">&nbsp; IE 10+ (ChakraCore)
- <img height="24" src="./images/edge.png" align="center">&nbsp; Edge Legacy (ChakraCore)
- <img height="24" src="./images/opera.png" align="center">&nbsp; Opera \<15 (Linear B, Futhark, Carakan)
- <img height="24" src="./images/netscape.png" align="center">&nbsp; Netscape 7+ (Mocha / SpiderMonkey)
- <img height="24" src="./images/espruino.png" align="center">&nbsp; Espruino (not kidding)

> [!NOTE]  
> > "Why do the logos look old?"
>  
> They show the *first* version that added stack trace support.  
> However, all versions after the ones marked with a + are supported too.

## <img src="./images/stacklyn/Red.png" height="32" align="center"> Import Stacklyn
Stacklyn supports all kinds of imports!
1. As an HTML script tag:  
  <sub>*(note: Stacklyn is automatically placed as `window.Stacklyn` or `globalThis.Stacklyn` in the global scope if you do this)*</sub>
    ```html
    <script src="https://cdn.jsdelivr.net/npm/stacklyn/stacklyn.js"><script>
    ```
   
1. For use in JavaScript code directly:
    ```js
    // 1. ES Modules
    import Stacklyn from 'stacklyn';
    
    // 2. CommonJS (Node only)
    const Stacklyn = require('stacklyn');
    
    // 3. RequireJS
    require(["stacklyn"], function(Stacklyn){
        // Your usage code here
    });
  
    // 4. Web Workers
    importScripts("https://cdn.jsdelivr.net/npm/stacklyn/stacklyn.js");

    // You can also refer to Stacklyn once imported as:
    Stacklyn; // Direct (works regardless of how you imported)
    window.Stacklyn; // Browsers
    globalThis.Stacklyn; // Modern JS runtimes (2020+)
    self.Stacklyn; // Web workers
    global.Stacklyn; // Node.js
    // And then use the methods as usual, for example: window.Stacklyn.parse(myError);
    ```
    
Note that with the way stacklyn is made, it works no matter what JS env you're running! 

This means even in CSP'd environments (e.g. file://), you can still parse stack traces :D  
<sub>*(you cannot fetch local file information, best to use localhost for that)*</sub>

## <img src="./images/stacklyn/Gold.png" height="32" align="center"> Contributing
We welcome contributors!
If you've found a bug, had a suggestion, etc. Feel free to submit an issue or PR!

# License
Stacklyn is licensed under the Apache-2.0 License, the full text is at [`LICENSE`](/LICENSE) and a portion is located under every file.