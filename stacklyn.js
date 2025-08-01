/* Copyright 2025 DocToon. Licensed under Apache 2.0,
 * you may not use this file except in compliance with the License.
 * You may obtain a copy at: https://apache.org/licenses/LICENSE-2.0 */
// ==================================================================

/* ------------------------------------------ *\
                   WARNING:
        code quality is not the best,
   this is a v1 tho and i wrote it by myself
\* ------------------------------------------ */
class Stacklyn {
    "use strict";
    // ====== PUBLIC API - PARSING ====== \\

    /** Parses an error into an array of structured stack frames
     * @param {Error} error The error object
     * @param {{ ALLOW_CALLSITES: boolean; FULL_ERROR: boolean; }} [opts={ ALLOW_CALLSITES: false, FULL_ERROR: false }]
     * Optional options object (see docs for more info)
     * @returns {object[]} Array of parsed stack frames (see docs for more info)
     */
    static parse(error, opts = { ALLOW_CALLSITES: false, FULL_ERROR: false }) {
        if (!Stacklyn._isValidError(error)) { return; }

        let frames, out;
        error.toString = Error.prototype.toString;

        // filter out v8-style stacktrace headers
        function removeV8Header(error, serialize = false) {
            if (serialize || !error.stack) {
                return { name: error.name, message: error.message, header: error.toString() };
            }

            return error.stack?.replace(error.toString()+"\n", "");
        }

        // some flags to make sure it parses correctly
        const isV8Env = !!(navigator?.userAgent?.includes("Chrome") || typeof process !== "undefined" || window?.chrome);
        const canGetCallSites = !!(isV8Env && opts.ALLOW_CALLSITES === true && error instanceof Error);

        if (canGetCallSites) {
            out = Stacklyn.parseCS(error);
        } else {
            frames = error.stack?.split("\n").filter(Boolean) || [];
            
            if (frames.includes(error.toString())) {
                frames = removeV8Header(error).split("\n").filter(Boolean);
            }

            const isV8 = frames?.some(frame => frame.startsWith("    at "));
            const isIE = frames?.some(frame => frame.startsWith("   at "));
            const isEspruino = frames?.some(frame => frame.includes("     ^"));
            const isFirefox = frames?.some(frame => /^.*?@.+?(:\d+)?(?::\d+)?$/.test(frame));

            if (Stacklyn._detectOperaMode(error) !== "failed") { // one of the most ancient browsers
                out = Stacklyn.parseOpera(error).filter(Boolean);
            } else if (isEspruino) { // yes... JS for microcontrollers
                out = Stacklyn.parseEspruino(error).filter(Boolean);
            } else if (isV8) { // oh my god its chrome, node, and... bun?
                frames = removeV8Header(error, false).split("\n").filter(Boolean);
                out = frames.map(frame => Stacklyn.parseV8(frame, null)).filter(Boolean);
            } else if (isIE) { // IE/legacy edge parser
                frames = removeV8Header(error, false).split("\n").filter(Boolean);
                out = frames.map(frame => Stacklyn.parseIE(frame)).filter(Boolean);
            } else if (isFirefox) { // safari or firefox
                out = frames.map(frame => Stacklyn.parseSpiderMonkey(frame)).filter(Boolean);
            } else {
                throw new Stacklyn.Error("unsupported stacktrace format:", error, { cause: error });
            }
        }

        out = Stacklyn._filterUndefined(out);

        if (opts.FULL_ERROR) { 
            out = { ...Stacklyn.serializeError(error), parsedStack: Array.from(out) };
        }

        return out;
    }

    /** Parses a locally thrown V8 error with CallSite info
     * @param {Error} error The V8 error to parse
     * @param {{ FULL_ERROR: boolean; }} [opts={ FULL_ERROR: false }] Optional options object
     * @returns {object[]} An array of parsed V8 frames with CallSite info
     */
    static parseCS(error, opts = { FULL_ERROR: false }) {
        if (!Stacklyn._isValidError(error)) { return; }

        let frameIndex = 0;
        const { stack, callSites } = Stacklyn.getCallSites(error);

        let out = Stacklyn._filterUndefined(
            stack.split("\n").slice(1).map(frame => Stacklyn.parseV8(frame, callSites[frameIndex++]))
        );

        if (opts.FULL_ERROR) { 
            out = { ...Stacklyn.serializeError(error), parsedStack: Array.from(out), callSites };
        }

        return out;
    }

    /** Parse a V8 (chromium, chrome, nodejs...) stack frame
     * @param {String} frame The stack frame string
     * @param {Array} callSite The callsite (this should never be added manually)
     * @returns {Object} Stack frame object
    */
    static parseV8(frame, callSite = undefined) {
        if (!frame.startsWith("    at")) { return; }

        let parsedLocation, callerFunc;
        const env = { host: "Chromium", format: "V8", type: "browser" };

        let rawName, alias, sourceURL;
        const V8_PARENS_REGEXP = /^ {4}at (.+?)(?: \[as ([^\]]+)\])?\s*\((.+)\)\s*$/;
        const V8_REGEXP = /^ {4}at (.+)$/;

        if (frame.includes("(") && frame.includes(")")) {
            const match = frame.match(V8_PARENS_REGEXP);

            if (match) { 
                [, rawName, alias, sourceURL ] = match; 
            }
        } else {
            const match = frame.match(V8_REGEXP);

            if (match) { 
                [, sourceURL ] = match; 
            }
        }

        function parseEvalChain(path) {
            let result = null, trailingLoc = null, index = 0;
            const match = path.match(/, ([^,]+:\d+:\d+)$/);
            
            if (match) { 
                trailingLoc = match[1];
                path = path.slice(0, path.lastIndexOf(", ")); 
            }

            const parts = [];
            while (path.startsWith("eval at ", index)) {
                index += 8;
                const nameEnd = path.indexOf(" (", index), name = path.slice(index, nameEnd);

                let depth = 1, subIndex = nameEnd + 2;
                index = subIndex;

                while (subIndex < path.length && depth > 0) {
                    if (path[subIndex] === "(") { 
                        depth++; 
                    } else if (path[subIndex] === ")") { 
                        depth--; 
                    }
                    subIndex++;
                }

                const inner = path.slice(index, subIndex - 1);
                parts.push({ name, location: null, inner });
                path = inner; index = 0;
            }

            if (parts.length && path.match(/:\d+:\d+$/)) { 
                parts[parts.length - 1].location = path;
            }

            if (trailingLoc && parts.length) { 
                parts[0].location = trailingLoc;
            }

            for (let i = parts.length - 1; i >= 0; i--) {
                let sourceURL = null, line = null, column = null;
                const { name, location } = parts[i], match = location?.match(/^(.*):(\d+):(\d+)$/);

                if (match) { 
                    [, sourceURL, line, column] = match; 
                } else if (location) { 
                    sourceURL = location; 
                }

                result = {
                    name, sourceURL: sourceURL || null,
                    fileName: sourceURL?.includes("://") ? Stacklyn._getFilename(sourceURL) : null,
                    line: line ? Number(line) : null,
                    column: column ? Number(column) : null,
                    eval: result
                };
            }
            return result;
        }

        const isAnonLoc = ["native", "unknown location", "<anonymous>"]
            .some(source => sourceURL === source);

        const isAnonWithLine = ["native:", "<anonymous>:"]
            .some(source => sourceURL.startsWith(source));

        if (isAnonLoc || !sourceURL) {
            parsedLocation = { sourceURL, anonymous: true };
        } else if (isAnonWithLine) { // sometimes they could have line info
            if (sourceURL.startsWith("native:")) { 
                env.host = "Bun"; env.type = "runtime"; 
            }

            const { line, column } = Stacklyn._extractLocation(sourceURL);

            parsedLocation = { 
                sourceURL: null,
                fileName: null,
                line, column,
                anonymous: true 
            };

        } else if (sourceURL === "unknown") { // bun
            env.host = "Bun";
            env.type = "runtime";

            parsedLocation = { sourceURL, anonymous: true };
        } else if (sourceURL.startsWith("eval at")) {
            parsedLocation = parseEvalChain(sourceURL);
        } else if (sourceURL){
            if (sourceURL.startsWith("node:")) { 
                env.host = "Node.js"; env.type = "runtime"; 
            }

            const { line, column } = Stacklyn._extractLocation(sourceURL);
            const cleanPath = Stacklyn._cleanPath(sourceURL);

            parsedLocation = {
                sourceURL: cleanPath,
                fileName: Stacklyn._getFilename(cleanPath),
                line, column,
                anonymous: !cleanPath
            };
        }

        if (rawName?.includes("<anonymous>")) {
            if (rawName.endsWith(".<anonymous>")) { // Object.<anonymous> is often seen
                callerFunc = { 
                    name: rawName.replace(".<anonymous>", ""),
                    method: null,
                    anonymous: true 
                };
            } else { // name is probably just "<anonymous>"
                callerFunc = { name: null, anonymous: true };
            }

        } else if (rawName) {
            const isSafariLoc = ["global code", "module code", "eval code"]
                .some(name => rawName === name);

            if (isSafariLoc) {
                env.host = "Bun";
                env.type = "runtime";
            }

            callerFunc = Stacklyn.parseFunctionName(rawName, {alias, rawName});
        } else if (!rawName) {
            callerFunc = { name: null, anonymous: true };
        }

        return Stacklyn._buildOutputObject({
            frameInfo: { 
                raw: frame,
                func: callerFunc,
                location: parsedLocation 
            },
            extra: { 
                callSite: callSite ?? undefined,
                environment: env 
            }
        });
    }

    /** Parse a SpiderMonkey (firefox, safari, netscape...) stack frame
     * (im not sure if netscape actually called it spidermonkey but whatever)
     * @param {String} frame The stack frame string
     * @returns {Object} Stack frame object
    */
    static parseSpiderMonkey(frame) {
        if (!frame || frame.length < 2) { return; }

        let parsedLocation, evalChain, callerFunc,
            env = { host: "Firefox", format: "SpiderMonkey", type: "browser" };

        // inferred function name, we split like this because people have @s in filenames.
        const at = frame.lastIndexOf("@");

        const [rawName, path] = at !== -1 
            ? [frame.slice(0, at), frame.slice(at + 1)]
            : [null, ""];

        function parseEvalChain(path) {
            // get location parts
            let result = null;
            const parts = path.split(" > ");

            // for each part, parse a node/chain of eval calls from the stack trace
            for (let i = parts.length - 1; i >= 0; i--) {

                // really cool regex
                const match = parts[i].match(/^(.*) line (\d+)$/)
                              || parts[i].match(/^(.*):(\d+):(\d+)$/);

                if (!match) { continue; }

                const chain = {
                    sourceURL: match[1].includes("://") ? match[1] : null,
                    fileName: match[1].includes("://") ? Stacklyn._getFilename(match[1]) : null,
                    line: Number(match[2]),
                    column: match[3] ? Number(match[3]) : null,
                    type: match[1].includes("://") ? "file" : match[1],
                    eval: result
                };

                result = chain;
            }

            return result;
        }

        const { line, column } = Stacklyn._extractLocation(path);

        const isWeirdSafariLocation = ["[native code]", "[wasm code]"]
            .some(p => path.includes(p));

        const isSafariFunc = ["global code", "module code", "eval code"]
            .some(name => rawName.includes(name));

        if (path.includes(" line ") && path.includes(" > ")) {
            evalChain = parseEvalChain(path);
        } else if (path.startsWith("javascript:")) {
            const inlineSource = Stacklyn._cleanPath(path.replace("javascript:", ""), "partial");
            parsedLocation = { inlineSource, line, column, type: "JSUrl" };
        } else if (isWeirdSafariLocation || !path.match(/:(\d+)(?::(\d+))?$/)) {
            // believe it or not,
            // safari's stack frames are so similar that this is the only way to detect them

            env = { host: "Safari", format: "JavaScriptCore", type: "browser" };
            parsedLocation = {
                sourceURL: path,
                line, column,
                type: path.includes("[native code]") ? "native" : "wasm"
            };
        } else {
            const cleanPath = Stacklyn._cleanPath(path); // file location if it took a shower

            parsedLocation = {
                sourceURL: cleanPath,
                fileName: Stacklyn._getFilename(cleanPath),
                line, column
            };
        }

        if (rawName) { // inferred function name by the engine
            if (rawName.includes("/")) { // nested functions, methods, or properties inside an object(s)
                const names = rawName.split("/"), parsedNames = [];

                names.forEach(name => {
                    let result;
                    if (name.includes("<")) {
                        // timeout/<@{LOCATION HERE}:LINE:COL
                        result = { 
                            name,
                            index: name.match(/\[(\d+)\]</) || undefined,
                            flags: ["NESTED_ANON"]
                        };
                    } else {
                        result = Stacklyn.parseFunctionName(name, {rawName});
                    }

                    parsedNames.push(result);
                });

                const out = { ...parsedNames[0] };
                let current = out;

                for (let i = 1; i < parsedNames.length; i++) { 
                    current.func = { ...parsedNames[i] };
                    current = current.func;
                }

                callerFunc = out;
            } else if (rawName.includes("*")) {
                /*  setTimeout handler*timeout@{LOCATION HERE}:LINE:COL
                   promise callback*promiseThen@{LOCATION HERE}:LINE:COL */

                const [type, name] = rawName.split("*");
                const result = Stacklyn._parseFunctionname(name, {rawName});

                if (type.includes("setTimeout handler")) {
                    result.flags.push("TIMEOUT_HANDLER");
                } else if (type.includes("promise callback")) {
                    result.flags.push("PROMISE_CALLBACK");
                }

                result.flags.push("ASYNC");
                callerFunc = result;
            } else if (isSafariFunc) {
                env = { host: "Safari", format: "JavaScriptCore", type: "browser" };

                const type = rawName.split(" ")[0];
                callerFunc = { name: null, anonymous: true, flags: [type.toUpperCase()] };
            } else {
                callerFunc = Stacklyn._parseFunctionname(rawName, {rawName});
            }
        } else { // no name
            callerFunc = { name: null, anonymous: true };
        }

        // new Function(...)(); calls always rename the function to "anonymous".
        // so this aims to properly flag them
        if (rawName === "anonymous" && parsedLocation?.eval.type === "Function") {
            callerFunc.anonymous = true;
        }

        return Stacklyn._buildOutputObject({
            frameInfo: { 
                raw: frame,
                func: callerFunc,
                location: evalChain ? evalChain : parsedLocation 
            },
            extra: { environment: env }
        });
    }

    /** Parse an IE / Edge (Legacy) stack frame
     * @param {String} frame The stack frame string
     * @returns {Object} Stack frame object
    */
    static parseIE(frame) {
        let callerFunc, parsedLocation;
        
        const match = frame.match(/^ {3}at\s+(.*?)\s+\((.*?)\)$/);
        if (!match) { return; }
        const [, rawName, sourceURL] = match;

        if (["Global code", "Anonymous function"].some(name => rawName.includes(name))) {
            callerFunc = { name: null, anonymous: true, flags: [(rawName.split(" ")[0]).toUpperCase()] };
        } else {
            callerFunc = Stacklyn.parseFunctionName(rawName, {rawName});
        }

        if (sourceURL === "native code") {
            parsedLocation = { sourceURL: null, fileName: null, anonymous: true, type: "native" };
        } else if (["eval code", "Function code", "Unknown script code"].some(path => sourceURL.includes(path))) {
            let type = sourceURL.split(" code")[0].toLowerCase();
            if (type === "unknown script") {
                type === "unknown";
            }

            const { line, column } = Stacklyn._extractLocation(sourceURL);
            parsedLocation = { 
                sourceURL: null, fileName: null,
                line, column,
                anonymous: true, type
            };
        } else {
            parsedLocation = Stacklyn._extractLocation(sourceURL);
        }

        return Stacklyn._buildOutputObject({
            frameInfo: { 
                raw: frame,
                func: callerFunc,
                location: parsedLocation
            },
            extra: { 
                environment: { 
                    host: "Internet Explorer", format: "IE", type: "browser" 
                } 
            }
        });
    }

    /** Parse an Opera Carakan stack frame
     * @param {String} frame The stack frame string
     * @param {String} context The specific line where the error occurred
     * @returns {Object} Stack frame object
    */
    static parseCarakan(frame, context) {
        let frameType = "thrown", callerFunc, rawName, otherSource;

        const prefixMap = {
            "Error thrown at ": "thrown",
            "Error created at ": "constructed",
            "Error initially occurred at ": "rethrown",
            "called via ToPrimitive() from ": "toPrimitive",
            "called via Function.prototype.apply() from ": "functionPrototypeApply",
            "called via Function.prototype.call() from ": "functionPrototypeCall",
            "called as bound function from ": "functionPrototypeBind",
            "called from ": "functionCall"
        };

        Object.keys(prefixMap).some(prefix => frame.startsWith(prefix) && (frameType = prefixMap[prefix], true));

        let [, rawNameTemp, sourceURL] = frame.match(/in (.+?) in (.+)/) || [null, null];
        const [, line, column] = frame.match(/line (\d+), column (\d+)/) || [null];

        if (!rawNameTemp) {
            [, otherSource, sourceURL] = frame.match(/[at|from] (.*?) in (.*)/);
        }

        if (rawNameTemp) {
            if (rawNameTemp.includes("<anonymous function:")) {
                rawName = rawNameTemp.replace("<anonymous function: ", "").replace(">", "");
            } else if (rawNameTemp.includes("<anonymous function>")) {
                rawName = "!";
            }

            callerFunc = rawName !== "!"  ? {
                ...Stacklyn.parseFunctionName(rawName ?? rawNameTemp, {rawName: rawNameTemp}),
                anonymous: rawNameTemp.startsWith("<a")
            } : { name: null, anonymous: true };
        }

        if (sourceURL.endsWith(":")) { sourceURL = sourceURL.slice(0,-1); }

        const parsedLocation = {
            context,
            sourceURL,
            fileName: sourceURL?.includes(" ") ? undefined : Stacklyn._getFilename(sourceURL),
            line: +line, column: +column,
            anonymous: !sourceURL || otherSource === "unknown location" || sourceURL.includes(" ")
        };

        return Stacklyn._buildOutputObject({
            frameInfo: { 
                raw: frame,
                func: callerFunc,
                location: parsedLocation 
            },
            extra: { 
                type: frameType,
                environment: { host: "Opera", format: "carakan", type: "browser" } 
            }
        });
    }

    /** Parse an Opera Linear-b stack frame
     * @param {String} frame The stack frame string
     * @param {String} context The specific line where the error occurred
     * @returns {Object} Stack frame object
    */
    static parseLinearB(frame, context) {
        // I am sincerely sorry for using regex here
        //   - doctoon
        const LINEARB_REGEXP = /^Line (\d+) of ([a-z]+)(?:#(\d+))? script(?: in (.*?))?(?:: In function (.*))?$/;
        const [, line, type, index, sourceURL, rawName] = frame.match(LINEARB_REGEXP);

        const parsedLocation = {
            context, sourceURL,
            fileName: Stacklyn._getFilename(sourceURL),
            line: +line, anonymous: !sourceURL,
            script: { type: type || "unknown", index: +index }
        };

        const callerFunc = rawName
            ? Stacklyn.parseFunctionName(rawName, {rawName})
            : { name: null, anonymous: !rawName };

        return Stacklyn._buildOutputObject({
            frameInfo: { raw: frame, func: callerFunc, location: parsedLocation },
            extra: { environment: { host: "Opera", format: "linear-b", type: "browser" } }
        });
    }

    /** Parse an Espruino error and return structured data
     * @param {Error} error The error to parse
     * @returns {Object} Stack frame object
    */
    static parseEspruino(error) {
        if (!Stacklyn._isValidError(error)) { return; }

        function parseEspruinoPair(frame, context, caret) {
            let parsedLocation, callerFunc, rawName, sourceURL;
            const ESPRUINO_PARENS_REGEXP = /^ {4}at (.*?) \((.+)\)$/;
            const ESPRUINO_REGEXP = /^ {4}at (.+)$/;

            if (frame.includes("(") && frame.includes(")")) {
                const match = frame.match(ESPRUINO_PARENS_REGEXP);
                if (match) { [, rawName, sourceURL] = match; }
            } else {
                const match = frame.match(ESPRUINO_REGEXP);
                if (match) { [, sourceURL] = match; }
            }

            if (sourceURL) {
                const { line, column } = Stacklyn._extractLocation(sourceURL);
                const cleanPath = Stacklyn._cleanPath(sourceURL);
                parsedLocation = {
                    sourceURL: cleanPath,
                    fileName: Stacklyn._getFilename(cleanPath),
                    line, column, anonymous: !cleanPath
                };
            }

            if (rawName) {
                callerFunc = Stacklyn.parseFunctionName(rawName, { rawName });
            } else { 
                callerFunc = { name: null, anonymous: true };
            }

            const l = parsedLocation;
            if (!l.fileName && l.line && l.column && callerFunc.name === "REPL") { callerFunc.flags.push("REPL"); }

            return Stacklyn._buildOutputObject({
                frameInfo: { 
                    raw: frame,
                    func: callerFunc,
                    location: { context, caret, ...parsedLocation } 
                },
                extra: { 
                    environment: { 
                        host: "Microcontroller Unit", format: "Espruino", type: "interpreter"
                    } 
                }
            });
        }

        return Stacklyn._getEspruinoPairs(error.stack).map(pair => parseEspruinoPair(pair.frame, pair.context, pair.caret));
    }

    /** Parse an Opera error and return structured data
     * @param {Error} error The error to parse
     * @returns {Object} Stack frame object
    */
    static parseOpera(error) {
        if (!Stacklyn._isValidError(error)) { return; }

        const out = [],
            mode = Stacklyn._detectOperaMode(error),
            pairs = Stacklyn._getOperaPairs(Stacklyn._getOperaStack(error));

        pairs.forEach(pair => {
            if (mode === "carakan") {
                out.push(Stacklyn.parseCarakan(pair.frame, pair.context));
            } else if (mode === "linear-b") {
                out.push(Stacklyn.parseLinearB(pair.frame, pair.context));
            } else {
                throw new Stacklyn.Error("Invalid Opera error provided for parsing");
            }
        });

        return out;
    }

    /** Parse a function name (meant for internal use but helpful)
     * @param {String} name Function name
     * @param {Object} options
     * @param {undefined} [options.alias=undefined] 
     * @param {undefined} [options.rawName=undefined] 
     * @returns {Object} Function metadata
    */
    static parseFunctionName(name, { alias = undefined, rawName = undefined }) {
        if (!name || !rawName) { return; }

        let parsed, args;

        // because bracket access is just unneccesary noise
        if (/\[.*?\]/.test(name)) { name = name.replace(/\[(.*?)\]/g, (_, inner) => "." + inner); }

        const match = name.match(/^(.+?)\((.*)\)$/);
        if (match) {
            try {
                args = new Function(`return [${match[2]}]`)();
            } catch {
                args = match[2].split(", ");
            }
        }

        // name cleaned of args
        const cleanName = match ? match[1] : name;

        if (cleanName.startsWith("./")) {
            // can someone PLEASE tell me where this comes from?
            parsed = { name: null, rawName, anonymous: true };
        } else if (cleanName.includes(".")) {
            // direct assignment (e.g. obj.a = b))
            const parts = cleanName.split("."), method = parts.pop(),
                name = parts.join(".");

            parsed = { name, rawName, method, alias, flags: ["DIRECT"], args, anonymous: !name };
        } else if (["get ", "set ", "new ", "async "].some(prefix => cleanName.startsWith(prefix))) {
            // function with a prefix (e.g. "get getter")
            let [prefix, tempName] = cleanName.split(" "), method;
            if (tempName.includes(".")) {
                const parts = tempName.split("."); method = parts.pop(); tempName = parts.join(".");
            }
            const prefixFlag = (prefix.endsWith("et") ? prefix + "ter" : prefix === "new" ? "constructor" : prefix).toUpperCase();
            parsed = { 
                name: tempName, rawName, method, alias, prefix,
                flags: ["PREFIX", prefixFlag], args, anonymous: !tempName 
            };
        } else {
            // probably just a regular function/class/etc
            parsed = { 
                name: cleanName,
                rawName, alias, flags: [], args,
                anonymous: !cleanName 
            };
        }

        if (parsed.name === rawName) { parsed.rawName = undefined; }
        if (args !== undefined) { parsed.flags.push("ARGS"); }
        if (cleanName === "eval") { parsed.flags.push("EVAL"); }

        return parsed;
    }

    // ====== END OF PARSING ====== \\


    // ====== USEFUL UTILITIES ====== \\

    /** Convert between stacktrace formats
     * @param {object[]} frames
     * @param {String} target
     * @returns {String} A string representing a stacktrace of the target format
    */
    static convert(frames, target) {
        const out = [];
        const engineMap = {
            Carakan: ["Carakan"],
            Chakra: ["Edge (Legacy)", "Internet Explorer", "IE"],
            Espruino: ["Espruino"],
            LinearB: ["LinearB", "linear-b", "Linear B"],
            SpiderMonkey: ["Firefox", "Netscape", "Tor", "SpiderMonkey", "Mocha"],
            V8: ["Brave", "Chrome", "Chromium", "Edge", "Opera", "Opera GX", "Vivaldi", "Node.js", "V8"]
        };

        const targetMap = {
            Carakan: { host: "Opera", format: "carakan", type: "browser" },
            Chakra: { host: "Internet Explorer", format: "IE", type: "browser" },
            Espruino: { host: "MCU Unit", format: "Espruino", type: "interpreter" },
            LinearB: { host: "Opera", format: "linear-b", type: "browser" },
            SpiderMonkey: { host: "Firefox", format: "SpiderMonkey", type: "browser" },
            V8: { host: "Chromium", format: "V8", type: "browser" }
        };

        const engine = Object.entries(engineMap).find(([, aliases]) => aliases.includes(target) )?.[0];

        if (!engine || !targetMap[engine]) {
            throw new Stacklyn.Error(`invalid .convert() target: '${target}'`);
        }

        frames.forEach(frame => { 
            frame.environment = targetMap[engine];
            out.push(Stacklyn.stringify(frame)); 
        });

        return out.filter(Boolean).join("\n");
    }

    /** Turn a parsed frame object into a stack string
     * @param {Object} frame
     * @returns {String} A string representing a stacktrace of the original format
    */
    static stringify(frame) {
        // safeguard for people who input the parsed output directly
        // (you WILL need to append the header yourself)
        if (Array.isArray(frame)) {
            // ah yes, frame.map(frame).
            return frame.map(f => Stacklyn.stringify(f));
        }

        let out = "";
        const args = frame.func.args 
            ? `(${frame.func.args.join(", ")})`
            : "";

        const functionName = (frame.func.name || frame.func.rawName || "")
                             + (frame.func.method ? "."+frame.func.method : "");

        function getLineCol(loc) {
            return loc.line 
                ? (":" + loc.line) + (loc.column ? (":" + loc.column) : "")
                : "";
        }
        const lineCol = getLineCol(frame.location);

        if (frame.environment.format === "V8") {
            // hello chromium my old friend

            const location = frame.location.eval
                ? formatEvalOrigin(frame.location)
                : (frame.location.sourceURL + lineCol);

            const alias = frame.func.alias ? ` [as ${frame.func.alias}]` : "";
            
            function formatEvalOrigin(location) {
                function recurse(evaloc) { // eval location but it sounds like some cool villain this way
                    if (!evaloc.eval) {
                        return `eval at ${evaloc.name} (${evaloc.sourceURL}${getLineCol(evaloc)})`;
                    }

                    return `eval at ${evaloc.name} (${recurse(evaloc.eval)})`;
                }

                return `${recurse(location)}, ${location.sourceURL}${getLineCol(location)}`;
            }

            out = "    at " + (functionName ? `${functionName}${args}${alias} (${location})` : location);
        } else if (frame.environment.format === "SpiderMonkey") {
            // THE LIZARD HAS BEEN PARSED, STRINGIFIED, AND ACKNOWLEDGED!

            if (frame.location.eval && frame.location.sourceURL.includes("<anonymous>")) {
                return "";
            }

            function formatEvalOrigin(location) {
                function recurse(evaloc) { // evaloc is back and he wants revenge
                    if (!evaloc.eval) {
                        return `${evaloc.sourceURL ?? evaloc.type}${getLineCol(evaloc)}`;
                    }

                    return `${evaloc.sourceURL ?? evaloc.type ?? "eval"} line ${evaloc.line} > ${recurse(evaloc.eval)}`;
                }

                return recurse(location);
            }

            const firstPart = (frame.func.name === "eval" ? "" : functionName) + args;

            let sourceURL;

            if (frame.location.type === "JSUrl") {
                sourceURL = "javascript:" + frame.location.inlineSource + lineCol;
            } else if (frame.location.eval) {
                sourceURL = formatEvalOrigin(frame.location);
            } else {
                sourceURL = (frame.location.sourceURL || "debugger eval code") + lineCol;
            }

            out += firstPart + "@" + sourceURL;
        } else if (frame.environment.format === "carakan") {
            // they really named an engine after ancient javascript

            const prefixMap = {
                thrown: "Error thrown at",
                constructed: "Error created at",
                rethrown: "Error initially occurred at",
                toPrimitive: "called via ToPrimitive() from",
                functionPrototypeApply: "called via Function.prototype.apply() from",
                functionPrototypeCall: "called via Function.prototype.call() from",
                functionPrototypeBind: "called as bound function from",
                functionCall: "called from"
            };

            const displayName = frame.func.name
                ? `<anonymous function: ${frame.func.name}>`
                : "<anonymous function>";

            const funcDisplay = (frame.func.anonymous ? displayName : functionName) + args;

            out = prefixMap[frame.type];

            if (frame.location.anonymous && !frame.location.line) {
                out += " unknown location";
            }

            if (frame.location.line) {
                out += ` line ${frame.location.line}, column ${frame.location.column}`;
            }

            out += ` in ${funcDisplay} in ${frame.location.sourceURL}:\n    ${frame.location.context}`;

        } else if (frame.environment.format === "linear-b") {
            // more ancient scripture

            let indexStr;
            if (frame.location.script.type === "inline") {
                indexStr = "#" + frame.location.script.index;
            }

            const isEval = ["unknown", "function", "eval"].some(type => frame.location.script.type === type);

            out = `  Line ${frame.location.line} of ${frame.location.script.type}${indexStr} script`;

            if (!isEval && !frame.location.anonymous) {
                out += ` in ${frame.location.sourceURL}`;
            }

            if (functionName) { out += `: In function ${functionName}${args}`; }

            out += `\n    ${frame.location.context || "/* no source available */"}`;
        } else if (frame.environment.format === "IE") {
            // me when i copy V8's homework but change it a little so it's not that obvious
            
            let loc = typeMap[frame.location.type];
            const typeMap = {
                eval: "eval code",
                function: "Function code",
                unknown: "Unknown script code"
            };

            if (!frame.location.type) { 
                loc = frame.location.sourceURL + lineCol;
            }

            out = `   at ${frame.func.rawName} (${loc})`;
        } else if (frame.environment.format === "Espruino") {
            // do i really have to do this

            const lineCol = `:${frame.location.line}:${frame.location.column}`;
            const sourceStr = `${frame.location.fileName || ""}${lineCol}`;

            out = `    at ${frame.func.name ? `${functionName} (${sourceStr})` : sourceStr}`;

            if (frame.location.context) {
                out += "\n    "+frame.location.context;

                if (frame.location.caret) { // ooh official caret
                    out += "\n"+frame.location.caret;
                } else { // make it up ourselves
                    out += `\n${" ".repeat(frame.location.context.length+1)}^`;
                }
            }
        }

        return out;
    }

    /** Get an error object in an accessible form
     * @param {Error} error The error object to get non enumerable properties of
     * @returns {Object} The error object with the properties attached
     */
    static serializeError(error) {
        // retain the prototype chain
        const prototype = error instanceof Error ? Object.getPrototypeOf(error) : Error.prototype;
        const out = Object.create(prototype);

        // explanation for each one is in the docs
        const props = [
            "name", "message", "stack", "cause", "errors", "error",
            "suppressed", "toString", "code", "errno", "syscall",
            "address", "port", "path", "dest", "spawnargs", "fileName",
            "lineNumber", "columnNumber", "sourceURL", "line", "column",
            "number", "description", "arguments", "stacktrace", "opera#sourceloc"
        ];

        props.forEach(propName => {
            const prop = error[propName];
            if (prop || prop === false || prop === null) {
                out[propName] = typeof prop === "function" ? prop.call(error) : prop;
            }
        });

        return out;
    }

    /** Get V8 call site info from an error
     * (call this before doing anything else with the error)
     * @param {Error} error The error object to get callsites of
     * @returns {Object} The callsite object with all properties directly accessible
     */
    static getCallSites(error) {
        const originalPrepare = Error.prepareStackTrace; // store the original formatter
        try {
            Error.prepareStackTrace = (_, stack) => stack; // bye bye v8 formatter! (for a few milliseconds)
            const callSites = error.stack; // yay an object instead of boring strings

            if (!Array.isArray(callSites)) {
                return null;
            }

            function exclude(cs) {
                // may add manual exclusions later when it becomes possible
                return cs.getPosition?.() !== 0;
            }

            // format the 'this'
            function formatThis(that) {
                const strThis = that.toString();
                const name = strThis.replace(/\[object (\w+)]/, "$1");
                return name.toLowerCase();
            }

            // build the output
            const out = callSites.filter(exclude).map(cs => ({
                scope: formatThis(cs.getThis?.()),
                func: {
                    name: cs.getFunctionName?.(),
                    typeName: cs.getTypeName?.(),
                    sourceCode: cs.getFunction?.()?.toString?.() || "",
                    reference: cs.getFunction?.(),
                    flags: {
                        native: cs.isNative?.(),
                        constructor: cs.isConstructor?.(),
                        async: cs.isAsync?.(),
                        topLevel: cs.isToplevel?.(),
                    },
                    eval: {
                        origin: cs.getEvalOrigin?.(),
                        isEval: cs.isEval?.()
                    },
                    promise: { 
                        all: cs.isPromiseAll?.(),
                        index: cs.getPromiseIndex?.()
                    }
                },
                location: {
                    sourceURL: cs.getScriptNameOrSourceURL?.(),
                    scriptHash: cs.getScriptHash?.(),
                    line: cs.getLineNumber?.(),
                    column: cs.getColumnNumber?.(),
                    position: cs.getPosition?.(),
                    enclosingLine: cs.getEnclosingLineNumber?.(),
                    enclosingColumn: cs.getEnclosingColumnNumber?.()
                }
            }));

            // pretty much what v8 actually does
            const stack = `${error.toString()}\n` + callSites.map(site => "    at " + site.toString()).join("\n");
            error.stack = stack;

            return { callSites: out, stack };
        } catch {
            return null;
        } finally {
            Error.prepareStackTrace = originalPrepare;
        }
    }

    // ====== ASYNC (use with caution) ======= \\
    /** Make a parsed frame into one with source mapped info
     * @param {Object} frames Array of parsed frame objects from the .parse method.
     * @returns {Object} An object with available data retrieved from the source map.
     * @example const res = await Stacklyn.map(parsedFrames), frames = [];
                res.forEach(frame => frames.push(frame.raw));
                console.log("Error: example toString header\n", frames.join("\n"));
     */
    static async map(frames) {
        const out = [];
        for (let frame of frames) {
            let map;
            const { sourceURL = null, fileName = null, line = null, column = null } = frame.location;

            try { map = await (await fetch(sourceURL + ".map")).json(); }
            catch (error) {
                if (typeof require !== "undefined") {
                    map = JSON.parse(require("fs").readFileSync(require("path").resolve(__dirname, sourceURL + ".map"), "utf8"));
                } else {
                    throw new Stacklyn.Error("Could not fetch source map "+sourceURL+".map:", error.toString());
                }
            }

            const location = new Stacklyn._SourceMapper(map).originalPositionFor({ line, column });

            // sadly this is the most amount of info we could map back
            frame.func.name = location.name || frame.func.name;
            frame.func.anonymous = !location.name;
            frame.location.sourceURL = location.source || sourceURL;
            frame.location.fileName = Stacklyn._getFilename(location.source) || fileName;
            frame.location.line = location.line || line;
            frame.location.column = location.column || column;
            frame.location.anonymous = !location.source || !sourceURL;
            frame.raw = Stacklyn.stringify(frame);

            frame = {...frame, sourcemapped: true};

            out.push(frame);
        }
        return out;
    }

    /**
     * @param {Object} frames Array of parsed frame objects from the .parse method.
     * @param {Number} context Amount of lines above and below the actual line (default is 5, can be 0 if you only want one line)
     * @returns {Object} An array of frames with context info (cannot be a minified file due to limitations of source mapping atm!)
     *                   In more detail, the frame becomes:
     *                   { contextabove: string[], context: string, contextbelow: string[],  ...frame }
     * @example const parsed = Stacklyn.parse(myError);
                const withContextInfo = await Stacklyn.enrich(parsed);
     */
    static async enrich(frames, context = 5) {
        return (await Promise.all(
            frames.map(frame => Stacklyn._prependContext(frame, context))
        )).filter(Boolean);
    }


    // ====== INTERNAL API ======= \\
    // WARNING: since this is not meant for use by regular users,
    // the code here will often not be readable or not useful.

    // == CLASSES
    static _SourceMapper = class {
        constructor(map) { this.sources = map.sources || []; this.names = map.names || []; this.mappings = this._parseMappings(map.mappings || ""); }

        // eslint-disable-next-line
        _parseMappings(e){function n(e,t){let n=0,r=0,l; var a={}; for(let e=0; e<64;)a["ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"[e]]=e++; for(;null==(l=a[e[t++]])?(()=>{throw new Stacklyn.Error("bad VLQ character");})():(n|=(31&l)<<r,r+=5,32&l););return{value:(n>>1)*(1&n?-1:1),nextOffset:t};}let r=0,l=0,a=0,f=0,u=0; var o=[],s=e.split(";"); for(let t=0; t<s.length; t++){let e=0; r=0; var v=s[t]; if(v)for(;e<v.length;){var c=n(v,e),g=(r+=c.value,e=c.nextOffset,{generatedLine:t+1,generatedColumn:r}); e<v.length&&","!==v[e]&&(c=n(v,e),l+=c.value,g.sourceIndex=l,c=n(v,e=c.nextOffset),a+=c.value,g.sourceLine=a,c=n(v,e=c.nextOffset),f+=c.value,g.sourceColumn=f,(e=c.nextOffset)<v.length)&&","!==v[e]&&(c=n(v,e),u+=c.value,g.nameIndex=u,e=c.nextOffset),o.push(g),e<v.length&&","===v[e]&&e++;}}return o;}

        originalPositionFor(position) {
            let match = null;
            const segments = this.mappings.filter(s => s.generatedLine === position.line);

            if (!segments.length) {return { source: null, line: null, column: null, name: null };}
            for (const s of segments) { if (s.generatedColumn <= position.column) {match = s;} else {break;} }
            if (!match || match.sourceIndex === null) {return { source: null, line: null, column: null, name: null };}

            return {
                source: this.sources[match.sourceIndex] || null, line: match.sourceLine + 1, column: match.sourceColumn,
                name: match.nameIndex !== null ? this.names[match.nameIndex] : null
            };
        }
    };

    static Error = class extends Error {
        constructor(message, options = {}) { 
            super(message, options); this.name = "StacklynError"; if (options.cause) { this.cause = options.cause; } 
        }
    };

    // == PARSING HELPERS
    static _getOperaStack(error) {
        const Backtrace = error.message?.split(/\n(?:\s+)?Backtrace:(?:\s+)?(?:\n)?/)[1] || null;
        const stacktrace = error.message?.split(/\n(?:\s+)?stacktrace:(?:\s+)?(?:\n)?/)[1] || null;

        if (error.stacktrace?.includes("opera:config#UserPrefs")) { return Backtrace; }
        if (error.stacktrace === false) {throw new Stacklyn.Error(
            "The specified error came from somewhere" +
            "with stack traces disabled, enable " +
            "'opera:config#UserPrefs|Exceptions Have Stacktrace' if this is your error."
        );};

        return error.stacktrace || stacktrace || Backtrace;
    }

    static _getOperaPairs(stack) {
        // BUG: if the context lines contain "\n", they get split incorrectly.
        // i have no idea how to make context aware context splitting
        // so this bug is staying for now
        const lines =  stack.split("\n"), out = [];
        for (let i = 0; i < lines.length; i++) {
            const maybeContext = lines[i], maybeFrame = lines[i-1];
            if (maybeContext?.startsWith("    ")) {
                const frame = maybeFrame?.startsWith("  Line ") ? maybeFrame.slice(2) : maybeFrame;
                const context = maybeContext.slice(4);
                out.push({ frame, context });
            }
        }
        return out;
    }

    static _detectOperaMode(error) {
        let mode = "failed";

        try {
            const operaStack = Stacklyn._getOperaStack(error);
            for (const line of operaStack.split("\n")) {
                const carakanPrefixes = ["called via ", "called from ", "Error thrown ", "Error created ", "Error initially "];

                const isCarakan = carakanPrefixes.some(prefix => line.includes(prefix));
                if (isCarakan) { mode = "carakan"; } else { mode = "linear-b"; }

                break;
            }
        } catch { return mode; }

        return mode;
    }

    // extract location from a path like https://example.com/file.js:1:2
    static _extractLocation(path, match = path.match(/:(\d+)(?::(\d+))?$/)) {
        return { line: match ? +match[1] : null, column: match ? +match[2] : null };
    }

    // extract the filename from a path (feels redundant ik but this was used too much times it was enough to have a helper)
    static _getFilename(path) { return decodeURIComponent(path.split("/").pop()); }

    // clean a sourceURL of any unneeded junk
    static _cleanPath(path, mode = "full") {
        if (mode === "full") { return path.replace(/:\d+:\d+$/, "").replace(/\\/g, "/"); } // for logical paths
        else if (mode === "partial") { return path.replace(/:\d+:\d+$/, ""); } // for virtual paths (e.g. <anonymous>:4:2)
    }

    // build the object seen in the results
    static _buildOutputObject({ frameInfo, extra = {} }) {
        const out = {
            raw: frameInfo.raw, func: frameInfo.func, location: frameInfo.location,
            ...extra || undefined
        };
        return out;
    }

    // async helper to prepend context to a frame
    static async _prependContext(frame, amount) {
        if (!frame.location || !frame.location.fileName || frame.location.anonymous) {
            return;
        }

        const fileContent = (await fetch(frame.location.sourceURL).then(res => res.text()));
        const lines = fileContent.split(/\r?\n/);
        const isMinified = (
            /^\s*\/\/#\s*sourceMappingURL=.+/m.test(fileContent) ||
            frame.location.fileName.includes(".min.") ||
            fileContent.length / lines.length > 100
        );

        if (isMinified || lines.length < amount*2+1) { return; }

        return {
            contextabove: lines.slice(Math.max(0, frame.location.line - 1 - amount), frame.location.line - 1),
            context: lines[frame.location.line - 1] ?? "",
            contextbelow: lines.slice(frame.location.line, frame.location.line + amount),
            ...frame
        };
    }

    static _getEspruinoPairs(stack) {
        const frames = [], contexts = [], carets = [];
        stack.split("\n").forEach(line => {
            if (line.startsWith("    at ")) { frames.push(line); } else { contexts.push(line); }
            if (line.includes("  ^")) { carets.push(line); }
        });
        return frames.map((frame, i) => ({
            frame, context: contexts[i]?.startsWith("    ") ? contexts[i].slice(4) : contexts[i], caret: carets[i]
        }));
    }

    static _isValidError(error) { return error && typeof error === "object" && ["stack", "message", "stacktrace"].some(prop => prop in error); }

    // filter out undefined from an array of objects
    static _filterUndefined(arr) { return arr.map(obj => JSON.parse(JSON.stringify(obj, (_, value) => value === undefined ? undefined : value))); }
}

// export stacklyn
if (typeof define === "function" && define.amd) {define("stacklyn", [], () => Stacklyn);} // AMD (RequireJS)
if (typeof global !== "undefined") {global.Stacklyn = Stacklyn;} // Node.js (global)
if (typeof module !== "undefined") {module.exports = Stacklyn;} // CommonJS
if (typeof exports !== "undefined") {exports.Stacklyn = Stacklyn;} // Node.js (CommonJS)
if (typeof window !== "undefined") {window.Stacklyn = Stacklyn;} // browsers
if (typeof self !== "undefined") {self.Stacklyn = Stacklyn;} // web workers
if (typeof globalThis !== "undefined") {globalThis.Stacklyn = Stacklyn;} // universal globalThis (2020+)